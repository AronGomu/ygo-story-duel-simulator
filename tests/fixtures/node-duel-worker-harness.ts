import { Worker } from "node:worker_threads";
import type { DuelCommand } from "../../src/duel/contracts/duel-command.ts";

const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const MAX_RETAINED_MESSAGES = 256;
const MAX_OUTPUT_TAIL_LENGTH = 16_384;
const PRODUCTION_WORKER_ENTRY_URL = new URL(
  "../../src/worker/duel.worker-node.ts",
  import.meta.url,
);
const MISSING_RUNTIME_WORKER_ENTRY_URL = new URL(
  "./missing-runtime-duel-worker-node.ts",
  import.meta.url,
);
const UNRESPONSIVE_WORKER_ENTRY_URL = new URL(
  "./unresponsive-worker-node.ts",
  import.meta.url,
);
const CLEANUP_FAILURE_WORKER_ENTRY_URL = new URL(
  "./cleanup-failure-duel-worker-node.ts",
  import.meta.url,
);

type MessagePredicate = (message: unknown) => boolean;

interface RecordedMessage {
  readonly sequence: number;
  readonly value: unknown;
}

interface MessageWaiter {
  readonly afterSequence: number;
  readonly predicate: MessagePredicate;
  readonly resolve: (message: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ExitWaiter {
  readonly resolve: (code: number) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface MessageWaitOptions {
  readonly afterSequence?: number;
  readonly timeoutMs?: number;
}

export interface NodeDuelWorkerHarnessOptions {
  readonly fixture?: "missing-runtime" | "unresponsive" | "cleanup-failure";
}

export class NodeDuelWorkerHarness {
  readonly worker: Worker;
  readonly #messages: RecordedMessage[] = [];
  readonly #messageWaiters = new Set<MessageWaiter>();
  readonly #exitWaiters = new Set<ExitWaiter>();
  #nextMessageSequence = 0;
  #workerError: Error | null = null;
  #exitCode: number | undefined;
  #gracefulExitRequested = false;
  #terminationRequested = false;
  #stdoutTail = "";
  #stderrTail = "";

  constructor(options: NodeDuelWorkerHarnessOptions = {}) {
    const entry = workerEntryUrl(options.fixture);
    this.worker = new Worker(entry, { stdout: true, stderr: true });
    this.worker.stdout?.setEncoding("utf8");
    this.worker.stdout?.on("data", (chunk: string) => {
      this.#stdoutTail = appendTail(this.#stdoutTail, chunk);
    });
    this.worker.stderr?.setEncoding("utf8");
    this.worker.stderr?.on("data", (chunk: string) => {
      this.#stderrTail = appendTail(this.#stderrTail, chunk);
    });
    this.worker.on("message", (message: unknown) => {
      const recorded = {
        sequence: this.#nextMessageSequence,
        value: message,
      };
      this.#nextMessageSequence += 1;
      this.#messages.push(recorded);
      if (this.#messages.length > MAX_RETAINED_MESSAGES) this.#messages.shift();
      this.#resolveMessageWaiters(recorded);
    });
    this.worker.once("messageerror", (error) => {
      this.#recordWorkerFailure(
        new Error("Unable to deserialize a Duel Worker message", {
          cause: error,
        }),
      );
    });
    this.worker.once("error", (error) => {
      this.#recordWorkerFailure(error);
    });
    this.worker.once("exit", (code) => {
      this.#exitCode = code;
      this.#resolveExitWaiters(code);
      const expectedExit =
        (this.#gracefulExitRequested && code === 0) ||
        this.#terminationRequested;
      if (!expectedExit && this.#workerError === null) {
        this.#workerError = new Error(
          `Duel Worker exited unexpectedly with code ${code}${this.#outputContext()}`,
        );
      }
      this.#rejectMessageWaiters(
        this.#workerError ??
          new Error(
            `Duel Worker exited with code ${code} before the expected message${this.#outputContext()}`,
          ),
      );
    });
  }

  get threadId(): number {
    return this.worker.threadId;
  }

  get cursor(): number {
    return this.#nextMessageSequence;
  }

  get messages(): readonly unknown[] {
    return this.#messages.map(({ value }) => value);
  }

  post(command: DuelCommand): void {
    try {
      this.worker.postMessage(command);
    } catch (error) {
      throw new Error(
        `Unable to post ${command.type} to Duel Worker${this.#outputContext()}`,
        { cause: error },
      );
    }
  }

  waitForMessage(
    predicate: MessagePredicate,
    options: MessageWaitOptions = {},
  ): Promise<unknown> {
    if (this.#workerError !== null) return Promise.reject(this.#workerError);
    const afterSequence = options.afterSequence ?? 0;
    const existing = this.#messages.find(
      (message) =>
        message.sequence >= afterSequence && predicate(message.value),
    );
    if (existing !== undefined) return Promise.resolve(existing.value);
    if (this.#exitCode !== undefined) {
      return Promise.reject(
        new Error(
          `Duel Worker exited with code ${this.#exitCode} before the expected message${this.#outputContext()}`,
        ),
      );
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const waiter: MessageWaiter = {
        afterSequence,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#messageWaiters.delete(waiter);
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for a Duel Worker message; received: ${this.#messageTypes().join(", ") || "none"}${this.#outputContext()}`,
            ),
          );
        }, timeoutMs),
      };
      this.#messageWaiters.add(waiter);
    });
  }

  waitForExit(timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<number> {
    if (this.#exitCode !== undefined) return Promise.resolve(this.#exitCode);
    return new Promise((resolve, reject) => {
      const waiter: ExitWaiter = {
        resolve,
        timer: setTimeout(() => {
          this.#exitWaiters.delete(waiter);
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for Worker exit${this.#outputContext()}`,
            ),
          );
        }, timeoutMs),
      };
      this.#exitWaiters.add(waiter);
    });
  }

  async disposeGracefully(
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<number> {
    if (this.#workerError !== null) {
      return this.#terminateAfterFailure(this.#workerError, timeoutMs);
    }
    if (this.#exitCode !== undefined) return this.#exitCode;
    this.#gracefulExitRequested = true;
    const exited = this.waitForExit(timeoutMs);
    let code: number;
    try {
      this.post({ type: "dispose" });
      code = await exited;
    } catch (error) {
      return this.#terminateAfterFailure(error, timeoutMs);
    }
    if (this.#workerError !== null) throw this.#workerError;
    if (code !== 0) {
      throw new Error(
        `Duel Worker cleanup failed with exit code ${code}${this.#outputContext()}`,
      );
    }
    return code;
  }

  async terminate(timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<number> {
    const observedFailure = this.#workerError;
    if (this.#exitCode !== undefined) {
      if (observedFailure !== null) throw observedFailure;
      return this.#exitCode;
    }
    let code: number;
    try {
      code = await this.#forceTerminate(timeoutMs);
    } catch (terminationError) {
      if (observedFailure !== null) {
        throw new AggregateError(
          [observedFailure, terminationError],
          "Duel Worker failed and could not be terminated",
        );
      }
      throw terminationError;
    }
    if (observedFailure !== null) throw observedFailure;
    if (this.#workerError !== null) throw this.#workerError;
    return code;
  }

  #forceTerminate(timeoutMs: number): Promise<number> {
    this.#terminationRequested = true;
    return withTimeout(
      this.worker.terminate(),
      timeoutMs,
      `terminating Duel Worker${this.#outputContext()}`,
    );
  }

  async #terminateAfterFailure(
    failure: unknown,
    timeoutMs: number,
  ): Promise<never> {
    try {
      if (this.#exitCode === undefined) await this.#forceTerminate(timeoutMs);
    } catch (terminationError) {
      throw new AggregateError(
        [failure, terminationError],
        "Graceful and forced Duel Worker cleanup both failed",
      );
    }
    throw failure;
  }

  #resolveMessageWaiters(message: RecordedMessage): void {
    for (const waiter of this.#messageWaiters) {
      if (message.sequence < waiter.afterSequence) continue;
      let matches: boolean;
      try {
        matches = waiter.predicate(message.value);
      } catch (error) {
        clearTimeout(waiter.timer);
        this.#messageWaiters.delete(waiter);
        waiter.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
        continue;
      }
      if (!matches) continue;
      clearTimeout(waiter.timer);
      this.#messageWaiters.delete(waiter);
      waiter.resolve(message.value);
    }
  }

  #recordWorkerFailure(error: Error): void {
    this.#workerError = new Error(`${error.message}${this.#outputContext()}`, {
      cause: error,
    });
    this.#rejectMessageWaiters(this.#workerError);
  }

  #rejectMessageWaiters(error: Error): void {
    for (const waiter of this.#messageWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#messageWaiters.clear();
  }

  #resolveExitWaiters(code: number): void {
    for (const waiter of this.#exitWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(code);
    }
    this.#exitWaiters.clear();
  }

  #messageTypes(): string[] {
    return this.#messages.map(
      ({ value }) => workerEventType(value) ?? typeof value,
    );
  }

  #outputContext(): string {
    const output = [
      this.#stdoutTail.length === 0 ? "" : `stdout=${this.#stdoutTail}`,
      this.#stderrTail.length === 0 ? "" : `stderr=${this.#stderrTail}`,
    ]
      .filter((part) => part.length > 0)
      .join("; ");
    return output.length === 0 ? "" : `; ${output}`;
  }
}

export function hasWorkerEventType(
  expectedType: string,
): (message: unknown) => boolean {
  return (message) => workerEventType(message) === expectedType;
}

function workerEventType(message: unknown): string | undefined {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    typeof message.type !== "string"
  ) {
    return undefined;
  }
  return message.type;
}

function workerEntryUrl(fixture: NodeDuelWorkerHarnessOptions["fixture"]): URL {
  switch (fixture) {
    case "missing-runtime":
      return MISSING_RUNTIME_WORKER_ENTRY_URL;
    case "unresponsive":
      return UNRESPONSIVE_WORKER_ENTRY_URL;
    case "cleanup-failure":
      return CLEANUP_FAILURE_WORKER_ENTRY_URL;
    default:
      return PRODUCTION_WORKER_ENTRY_URL;
  }
}

function appendTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-MAX_OUTPUT_TAIL_LENGTH);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
