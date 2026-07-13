import {
  parseDuelCommand,
  type DuelCommand,
} from "../duel/contracts/duel-command.ts";
import type { DuelErrorCode } from "../duel/contracts/duel-error.ts";
import {
  parseDuelWorkerEvent,
  type DuelWorkerEvent,
} from "../duel/contracts/duel-worker-event.ts";
import type { ChoiceId, DuelId, PromptId } from "../duel/contracts/ids.ts";

const DEFAULT_DISPOSAL_TIMEOUT_MS = 1_000;
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface DuelWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  onexit?: ((event: Event) => void) | null;
  postMessage(command: DuelCommand): void;
  terminate(): void;
}

export type DuelWorkerFactory = () => DuelWorkerPort;

export interface DuelClientContext {
  readonly workerGeneration: number;
  readonly sessionGeneration: number;
}

export interface DuelClientEvent {
  readonly context: DuelClientContext;
  readonly event: DuelWorkerEvent;
}

export type DuelClientListener = (event: DuelClientEvent) => void;

export interface DuelClientLogEntry {
  readonly event: string;
  readonly [field: string]: unknown;
}

export interface DuelClientLogger {
  info(entry: DuelClientLogEntry): void;
  error(entry: DuelClientLogEntry): void;
}

export interface DuelWorkerClientOptions {
  readonly workerFactory?: DuelWorkerFactory;
  readonly disposalTimeoutMs?: number;
  readonly initializationTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly logger?: DuelClientLogger;
}

export interface DuelWorkerDisposalResult {
  readonly graceful: boolean;
}

export interface DuelClient {
  readonly context: DuelClientContext;
  subscribe(listener: DuelClientListener): () => void;
  initialize(): boolean;
  startDuel(duelId: DuelId): DuelClientContext | null;
  respond(promptId: PromptId, choiceIds: readonly ChoiceId[]): boolean;
  surrender(): boolean;
  requestDiagnostics(): boolean;
  replace(): Promise<DuelWorkerDisposalResult>;
  dispose(): Promise<DuelWorkerDisposalResult>;
}

type DisposalAcknowledgement = {
  readonly type: "acknowledged";
  readonly clean: boolean;
};

type DisposalOutcome =
  | DisposalAcknowledgement
  | { readonly type: "timeout" }
  | { readonly type: "send-failed"; readonly error: unknown };

const consoleLogger: DuelClientLogger = Object.freeze({
  info: () => undefined,
  error: (entry: DuelClientLogEntry) => console.error(entry),
});

export class DuelWorkerClient implements DuelClient {
  readonly #workerFactory: DuelWorkerFactory;
  readonly #disposalTimeoutMs: number;
  readonly #initializationTimeoutMs: number;
  readonly #commandTimeoutMs: number;
  readonly #logger: DuelClientLogger;
  readonly #listeners = new Set<DuelClientListener>();
  #worker: DuelWorkerPort | null = null;
  #workerGeneration = 0;
  #sessionGeneration = 0;
  #initializeSent = false;
  #ready = false;
  #active = false;
  #currentPromptId: PromptId | null = null;
  #lastResponsePromptId: PromptId | null = null;
  #respondedPromptIds = new Set<PromptId>();
  #diagnosticsPending = false;
  #disposalResolver:
    ((acknowledgement: DisposalAcknowledgement) => void) | null = null;
  #shutdown: Promise<DuelWorkerDisposalResult> | null = null;
  #replacement: Promise<DuelWorkerDisposalResult> | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #startupFailure: DuelClientEvent | null = null;
  #closed = false;

  constructor(options: DuelWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory ?? createBrowserWorker;
    this.#disposalTimeoutMs = validateTimeout(
      options.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      "disposal",
    );
    this.#initializationTimeoutMs = validateTimeout(
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS,
      "initialization",
    );
    this.#commandTimeoutMs = validateTimeout(
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      "command",
    );
    this.#logger = options.logger ?? consoleLogger;
    this.#spawnWorker();
  }

  get context(): DuelClientContext {
    return this.#context();
  }

  subscribe(listener: DuelClientListener): () => void {
    this.#listeners.add(listener);
    if (this.#startupFailure !== null)
      this.#notify(listener, this.#startupFailure);
    return () => this.#listeners.delete(listener);
  }

  initialize(): boolean {
    if (
      this.#closed ||
      this.#worker === null ||
      this.#initializeSent ||
      this.#shutdown !== null
    ) {
      return false;
    }
    this.#initializeSent = true;
    if (!this.#post({ type: "initialize" })) {
      this.#initializeSent = false;
      return false;
    }
    this.#startWatchdog(
      this.#initializationTimeoutMs,
      `Duel Worker did not initialize within ${this.#initializationTimeoutMs}ms`,
    );
    return true;
  }

  startDuel(duelId: DuelId): DuelClientContext | null {
    if (
      this.#closed ||
      this.#worker === null ||
      !this.#ready ||
      this.#active ||
      this.#sessionGeneration !== 0 ||
      this.#shutdown !== null
    ) {
      return null;
    }
    const nextSessionGeneration = this.#sessionGeneration + 1;
    this.#active = true;
    this.#currentPromptId = null;
    this.#lastResponsePromptId = null;
    this.#respondedPromptIds = new Set();
    if (!this.#post({ type: "startDuel", duelId })) {
      this.#active = false;
      return null;
    }
    this.#sessionGeneration = nextSessionGeneration;
    this.#startWatchdog(
      this.#commandTimeoutMs,
      `Duel Worker did not start the duel within ${this.#commandTimeoutMs}ms`,
    );
    return this.#context();
  }

  respond(promptId: PromptId, choiceIds: readonly ChoiceId[]): boolean {
    if (
      this.#closed ||
      this.#worker === null ||
      !this.#active ||
      this.#currentPromptId !== promptId ||
      this.#respondedPromptIds.has(promptId) ||
      this.#shutdown !== null
    ) {
      return false;
    }
    this.#respondedPromptIds.add(promptId);
    this.#lastResponsePromptId = promptId;
    this.#currentPromptId = null;
    if (!this.#post({ type: "respond", promptId, choiceIds })) return false;
    this.#startWatchdog(
      this.#commandTimeoutMs,
      `Duel Worker did not resolve the response within ${this.#commandTimeoutMs}ms`,
    );
    return true;
  }

  requestDiagnostics(): boolean {
    return (
      !this.#closed &&
      this.#worker !== null &&
      this.#ready &&
      this.#sessionGeneration > 0 &&
      !this.#active &&
      !this.#diagnosticsPending &&
      this.#shutdown === null &&
      this.#sendDiagnosticsRequest()
    );
  }

  surrender(): boolean {
    if (
      this.#closed ||
      this.#worker === null ||
      !this.#active ||
      this.#shutdown !== null
    ) {
      return false;
    }
    this.#active = false;
    this.#currentPromptId = null;
    if (!this.#post({ type: "surrender" })) return false;
    this.#startWatchdog(
      this.#commandTimeoutMs,
      `Duel Worker did not resolve surrender within ${this.#commandTimeoutMs}ms`,
    );
    return true;
  }

  replace(): Promise<DuelWorkerDisposalResult> {
    if (this.#closed) return Promise.resolve({ graceful: true });
    if (this.#replacement !== null) return this.#replacement;
    this.#replacement = (async () => {
      const result = await this.#shutdownWorker();
      if (!this.#closed) this.#spawnWorker();
      return result;
    })().finally(() => {
      this.#replacement = null;
    });
    return this.#replacement;
  }

  async dispose(): Promise<DuelWorkerDisposalResult> {
    if (this.#closed && this.#worker === null) return { graceful: true };
    this.#closed = true;
    const result = await this.#shutdownWorker();
    this.#listeners.clear();
    return result;
  }

  #spawnWorker(): boolean {
    if (this.#closed) return false;
    this.#workerGeneration += 1;
    this.#sessionGeneration = 0;
    this.#initializeSent = false;
    this.#ready = false;
    this.#active = false;
    this.#currentPromptId = null;
    this.#lastResponsePromptId = null;
    this.#respondedPromptIds = new Set();
    this.#diagnosticsPending = false;
    this.#startupFailure = null;

    let worker: DuelWorkerPort;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      const message =
        error instanceof Error
          ? `Unable to create the Duel Worker: ${error.message}`
          : "Unable to create the Duel Worker";
      this.#recordStartupFailure(message, error);
      return false;
    }
    this.#worker = worker;
    const generation = this.#workerGeneration;
    worker.onmessage = (event) => this.#receive(generation, event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.#log("error", {
        event: "duel.client.worker.error",
        workerGeneration: generation,
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        err: event.error,
      });
      this.#failWorker(
        generation,
        "worker_error",
        event.message || "Duel Worker failed unexpectedly",
      );
    };
    worker.onmessageerror = (event) => {
      this.#log("error", {
        event: "duel.client.worker.message.failed",
        workerGeneration: generation,
        payloadType: typeof event.data,
      });
      this.#failWorker(
        generation,
        "worker_message_error",
        "Duel Worker sent a message that could not be deserialized",
      );
    };
    worker.onexit = () => {
      this.#failWorker(
        generation,
        "worker_unexpected_exit",
        "Duel Worker exited unexpectedly",
      );
    };
    this.#log("info", {
      event: "duel.client.worker.created",
      workerGeneration: generation,
    });
    return true;
  }

  #receive(generation: number, value: unknown): void {
    if (generation !== this.#workerGeneration || this.#worker === null) return;
    let event: DuelWorkerEvent;
    try {
      event = parseDuelWorkerEvent(value);
    } catch (error) {
      this.#log("error", {
        event: "duel.client.worker.event.rejected",
        workerGeneration: generation,
        err: error,
      });
      this.#failWorker(
        generation,
        "invalid_worker_event",
        error instanceof Error
          ? error.message
          : "Duel Worker emitted an invalid event",
      );
      return;
    }

    if (event.type === "disposed") {
      this.#disposalResolver?.({ type: "acknowledged", clean: event.clean });
      return;
    }
    if (event.type === "ready") {
      this.#ready = true;
      this.#clearWatchdog();
    }
    if (event.type === "prompt") {
      this.#clearWatchdog();
      this.#currentPromptId = event.prompt.id;
      this.#lastResponsePromptId = null;
    }
    if (event.type === "diagnostics") {
      this.#diagnosticsPending = false;
      this.#clearWatchdog();
    }
    if (event.type === "result") {
      this.#clearWatchdog();
      this.#active = false;
      this.#currentPromptId = null;
      this.#lastResponsePromptId = null;
    }
    if (event.type === "error") {
      this.#diagnosticsPending = false;
      this.#clearWatchdog();
      if (
        event.error.code === "invalid_response" &&
        this.#lastResponsePromptId !== null
      ) {
        this.#respondedPromptIds.delete(this.#lastResponsePromptId);
        this.#currentPromptId = this.#lastResponsePromptId;
        this.#lastResponsePromptId = null;
      } else {
        this.#active = false;
        this.#currentPromptId = null;
        this.#lastResponsePromptId = null;
      }
    }
    this.#emit({ context: this.#context(), event });
  }

  #sendDiagnosticsRequest(): boolean {
    this.#diagnosticsPending = true;
    if (this.#post({ type: "requestDiagnostics" })) {
      this.#startWatchdog(
        this.#commandTimeoutMs,
        `Duel Worker did not return diagnostics within ${this.#commandTimeoutMs}ms`,
      );
      return true;
    }
    this.#diagnosticsPending = false;
    return false;
  }

  #post(command: DuelCommand): boolean {
    const worker = this.#worker;
    if (worker === null) return false;
    try {
      worker.postMessage(parseDuelCommand(command));
      return true;
    } catch (error) {
      this.#failWorker(
        this.#workerGeneration,
        "worker_error",
        error instanceof Error
          ? `Unable to send a command to the Duel Worker: ${error.message}`
          : "Unable to send a command to the Duel Worker",
        { err: error, commandType: command.type },
      );
      return false;
    }
  }

  #failWorker(
    generation: number,
    code: DuelErrorCode,
    message: string,
    evidence?: { readonly err?: unknown; readonly commandType?: string },
  ): void {
    if (generation !== this.#workerGeneration || this.#worker === null) return;
    this.#clearWatchdog();
    const context = this.#context();
    this.#log("error", {
      event: "duel.client.worker.failed",
      workerGeneration: context.workerGeneration,
      sessionGeneration: context.sessionGeneration,
      code,
      message,
      ...(evidence?.commandType === undefined
        ? {}
        : { commandType: evidence.commandType }),
      ...(evidence?.err === undefined ? {} : { err: evidence.err }),
    });
    this.#emitError(context, code, message);
    this.#terminateCurrentWorker();
    if (!this.#closed && this.#shutdown === null) this.#spawnWorker();
  }

  #shutdownWorker(): Promise<DuelWorkerDisposalResult> {
    if (this.#shutdown !== null) return this.#shutdown;
    const worker = this.#worker;
    if (worker === null) return Promise.resolve({ graceful: true });
    const generation = this.#workerGeneration;
    const context = this.#context();
    this.#clearWatchdog();

    this.#shutdown = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const acknowledgement = new Promise<DisposalAcknowledgement>(
        (resolve) => {
          this.#disposalResolver = resolve;
        },
      );
      let outcome: DisposalOutcome;
      try {
        worker.postMessage(parseDuelCommand({ type: "dispose" }));
        outcome = await Promise.race([
          acknowledgement,
          new Promise<DisposalOutcome>((resolve) => {
            timeout = setTimeout(
              () => resolve({ type: "timeout" }),
              this.#disposalTimeoutMs,
            );
          }),
        ]);
      } catch (error) {
        outcome = { type: "send-failed", error };
      }
      if (timeout !== undefined) clearTimeout(timeout);
      this.#disposalResolver = null;

      if (outcome.type === "timeout") {
        this.#emitError(
          context,
          "worker_disposal_timeout",
          `Duel Worker did not acknowledge disposal within ${this.#disposalTimeoutMs}ms`,
        );
      } else if (outcome.type === "send-failed") {
        this.#log("error", {
          event: "duel.client.worker.dispose.send.failed",
          workerGeneration: context.workerGeneration,
          sessionGeneration: context.sessionGeneration,
          err: outcome.error,
        });
        this.#emitError(
          context,
          "worker_error",
          "Unable to request graceful Duel Worker disposal",
        );
      } else if (!outcome.clean) {
        this.#log("error", {
          event: "duel.client.worker.dispose.cleanup.failed",
          workerGeneration: context.workerGeneration,
          sessionGeneration: context.sessionGeneration,
        });
      }

      if (generation === this.#workerGeneration) this.#terminateCurrentWorker();
      const graceful = outcome.type === "acknowledged" && outcome.clean;
      this.#log("info", {
        event: "duel.client.worker.disposed",
        workerGeneration: context.workerGeneration,
        sessionGeneration: context.sessionGeneration,
        graceful,
        outcome: outcome.type,
      });
      return { graceful };
    })().finally(() => {
      this.#shutdown = null;
    });
    return this.#shutdown;
  }

  #terminateCurrentWorker(): void {
    this.#clearWatchdog();
    const worker = this.#worker;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.onexit = null;
    worker.terminate();
    this.#worker = null;
    this.#ready = false;
    this.#active = false;
    this.#currentPromptId = null;
  }

  #startWatchdog(timeoutMs: number, message: string): void {
    this.#clearWatchdog();
    const generation = this.#workerGeneration;
    this.#watchdog = setTimeout(() => {
      this.#watchdog = null;
      this.#failWorker(generation, "process_timeout", message);
    }, timeoutMs);
  }

  #clearWatchdog(): void {
    if (this.#watchdog === null) return;
    clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }

  #recordStartupFailure(message: string, error: unknown): void {
    const failure: DuelClientEvent = {
      context: this.#context(),
      event: {
        type: "error",
        error: { code: "worker_error", message, recoverable: false },
      },
    };
    this.#startupFailure = failure;
    this.#log("error", {
      event: "duel.client.worker.create.failed",
      workerGeneration: this.#workerGeneration,
      err: error,
    });
    this.#emit(failure);
  }

  #emitError(
    context: DuelClientContext,
    code: DuelErrorCode,
    message: string,
  ): void {
    this.#emit({
      context,
      event: {
        type: "error",
        error: { code, message, recoverable: false },
      },
    });
  }

  #emit(event: DuelClientEvent): void {
    for (const listener of this.#listeners) this.#notify(listener, event);
  }

  #notify(listener: DuelClientListener, event: DuelClientEvent): void {
    try {
      listener(event);
    } catch (error) {
      this.#log("error", {
        event: "duel.client.listener.failed",
        workerGeneration: event.context.workerGeneration,
        sessionGeneration: event.context.sessionGeneration,
        eventType: event.event.type,
        err: error,
      });
    }
  }

  #log(level: keyof DuelClientLogger, entry: DuelClientLogEntry): void {
    try {
      this.#logger[level](entry);
    } catch (error) {
      try {
        console.error({ event: "duel.client.logging.failed", level, error });
      } catch {
        // No secondary observation path remains when the host console fails.
      }
    }
  }

  #context(): DuelClientContext {
    return Object.freeze({
      workerGeneration: this.#workerGeneration,
      sessionGeneration: this.#sessionGeneration,
    });
  }
}

function createBrowserWorker(): DuelWorkerPort {
  return new Worker(
    new URL("../worker/duel.worker-browser.ts", import.meta.url),
    {
      type: "module",
      name: "ygo-duel-engine",
    },
  );
}

function validateTimeout(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Invalid Duel Worker ${label} timeout: ${value}`);
  return value;
}
