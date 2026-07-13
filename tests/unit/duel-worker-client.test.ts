import { describe, expect, it, vi } from "vitest";
import type { DuelCommand } from "../../src/duel/contracts/duel-command.ts";
import type { DuelWorkerEvent } from "../../src/duel/contracts/duel-worker-event.ts";
import {
  choiceId,
  duelId,
  promptId,
  snapshotId,
} from "../../src/duel/contracts/ids.ts";
import {
  DuelWorkerClient,
  type DuelWorkerPort,
} from "../../src/app/DuelWorkerClient.ts";

class FakeWorkerPort implements DuelWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onexit: ((event: Event) => void) | null = null;
  readonly commands: DuelCommand[] = [];
  terminated = false;
  postError: Error | null = null;

  postMessage(command: DuelCommand): void {
    if (this.postError !== null) throw this.postError;
    this.commands.push(command);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: DuelWorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<DuelWorkerEvent>);
  }

  emitRaw(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }

  emitError(message: string): void {
    this.onerror?.({
      message,
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: undefined } as MessageEvent<unknown>);
  }

  emitExit(): void {
    this.onexit?.({} as Event);
  }
}

function createHarness(disposalTimeoutMs = 50): {
  readonly client: DuelWorkerClient;
  readonly workers: FakeWorkerPort[];
} {
  const workers: FakeWorkerPort[] = [];
  const client = new DuelWorkerClient({
    workerFactory: () => {
      const worker = new FakeWorkerPort();
      workers.push(worker);
      return worker;
    },
    disposalTimeoutMs,
    logger: { info: vi.fn(), error: vi.fn() },
  });
  return { client, workers };
}

const promptEvent: DuelWorkerEvent = {
  type: "prompt",
  prompt: {
    id: promptId("worker-prompt-1"),
    kind: "yesNo",
    player: 0,
    title: "Confirm",
    choices: [
      { id: choiceId("yes"), label: "Yes", action: "yes" },
      { id: choiceId("no"), label: "No", action: "no" },
    ],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  },
};

describe("DuelWorkerClient", () => {
  it("sends initialize, start, and each prompt response at most once", () => {
    const { client, workers } = createHarness();
    const worker = workers[0]!;

    expect(client.initialize()).toBe(true);
    expect(client.initialize()).toBe(false);
    worker.emit({ type: "ready", coreVersion: [11, 0] });

    const session = client.startDuel(duelId("mvp-preset-v1"));
    expect(session).toMatchObject({
      workerGeneration: 1,
      sessionGeneration: 1,
    });
    expect(client.startDuel(duelId("mvp-preset-v1"))).toBeNull();

    worker.emit(promptEvent);
    expect(client.respond(promptEvent.prompt.id, [choiceId("yes")])).toBe(true);
    expect(client.respond(promptEvent.prompt.id, [choiceId("yes")])).toBe(
      false,
    );
    expect(client.respond(promptId("previous-prompt"), [choiceId("yes")])).toBe(
      false,
    );

    expect(worker.commands).toEqual([
      { type: "initialize" },
      { type: "startDuel", duelId: "mvp-preset-v1" },
      {
        type: "respond",
        promptId: "worker-prompt-1",
        choiceIds: ["yes"],
      },
    ]);
  });

  it("restores one response attempt after a recoverable Worker rejection", () => {
    const { client, workers } = createHarness();
    const worker = workers[0]!;
    client.initialize();
    worker.emit({ type: "ready", coreVersion: [11, 0] });
    client.startDuel(duelId("mvp-preset-v1"));
    worker.emit(promptEvent);

    expect(client.respond(promptEvent.prompt.id, [choiceId("yes")])).toBe(true);
    worker.emit({
      type: "error",
      error: {
        code: "invalid_response",
        message: "Try another selection",
        recoverable: true,
      },
    });
    expect(client.respond(promptEvent.prompt.id, [choiceId("no")])).toBe(true);
  });

  it("deduplicates diagnostic requests until the Worker responds", () => {
    const { client, workers } = createHarness();
    const worker = workers[0]!;
    client.initialize();
    worker.emit({ type: "ready", coreVersion: [11, 0] });
    client.startDuel(duelId("mvp-preset-v1"));
    worker.emit({
      type: "result",
      result: { type: "surrendered", winner: 1, loser: 0 },
    });

    expect(client.requestDiagnostics()).toBe(true);
    expect(client.requestDiagnostics()).toBe(false);
    worker.emit({
      type: "diagnostics",
      trace: {
        schemaVersion: 1,
        sensitivity: "contains-production-seed",
        presetId: "mvp-preset-v1",
        snapshotId: snapshotId("a".repeat(64)),
        seed: ["1", "2", "3", "4"],
        coreVersion: [11, 0],
        revisions: {
          enginePackage: "ocgcore-wasm",
          engineVersion: "0.1.2",
          babelCdb: "babel",
          cardScripts: "scripts",
          distribution: "strings",
          activeImageManifestSha256: "b".repeat(64),
        },
        entries: [],
      },
    });
    expect(client.requestDiagnostics()).toBe(true);
    expect(
      worker.commands.filter(({ type }) => type === "requestDiagnostics"),
    ).toHaveLength(2);
  });

  it("bounds a diagnostic request and replaces an unresponsive Worker", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorkerPort[] = [];
      const client = new DuelWorkerClient({
        workerFactory: () => {
          const worker = new FakeWorkerPort();
          workers.push(worker);
          return worker;
        },
        commandTimeoutMs: 25,
        logger: { info: vi.fn(), error: vi.fn() },
      });
      const received: DuelWorkerEvent[] = [];
      client.subscribe(({ event }) => received.push(event));
      client.initialize();
      workers[0]?.emit({ type: "ready", coreVersion: [11, 0] });
      client.startDuel(duelId("mvp-preset-v1"));
      workers[0]?.emit({
        type: "result",
        result: { type: "surrendered", winner: 1, loser: 0 },
      });

      expect(client.requestDiagnostics()).toBe(true);
      await vi.advanceTimersByTimeAsync(25);

      expect(workers[0]?.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      expect(received.at(-1)).toMatchObject({
        type: "error",
        error: { code: "process_timeout" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores late events from a replaced Worker generation", async () => {
    const { client, workers } = createHarness();
    const received: DuelWorkerEvent[] = [];
    client.subscribe(({ event }) => received.push(event));
    const first = workers[0]!;
    const staleHandler = first.onmessage;

    const replacement = client.replace();
    expect(first.commands.at(-1)).toEqual({ type: "dispose" });
    first.emit({ type: "disposed", clean: true });
    await expect(replacement).resolves.toEqual({ graceful: true });
    expect(first.terminated).toBe(true);
    expect(workers).toHaveLength(2);

    staleHandler?.({
      data: { type: "ready", coreVersion: [99, 99] },
    } as unknown as MessageEvent<DuelWorkerEvent>);
    expect(received).toEqual([]);
  });

  it("deduplicates concurrent replacement through one shutdown and one new Worker", async () => {
    const { client, workers } = createHarness();
    const first = workers[0]!;
    const firstReplacement = client.replace();
    const secondReplacement = client.replace();

    first.emit({ type: "disposed", clean: true });
    await expect(firstReplacement).resolves.toEqual({ graceful: true });
    await expect(secondReplacement).resolves.toEqual({ graceful: true });
    expect(
      first.commands.filter((command) => command.type === "dispose"),
    ).toHaveLength(1);
    expect(workers).toHaveLength(2);
  });

  it("distinguishes an acknowledged cleanup failure from a disposal timeout", async () => {
    const { client, workers } = createHarness();
    const received: DuelWorkerEvent[] = [];
    client.subscribe(({ event }) => received.push(event));
    const replacement = client.replace();
    workers[0]!.emit({ type: "disposed", clean: false });

    await expect(replacement).resolves.toEqual({ graceful: false });
    expect(received).not.toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "worker_disposal_timeout" }),
      }),
    );
  });

  it("bounds initialization when a Worker becomes unresponsive", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorkerPort[] = [];
      const client = new DuelWorkerClient({
        workerFactory: () => {
          const worker = new FakeWorkerPort();
          workers.push(worker);
          return worker;
        },
        initializationTimeoutMs: 25,
        logger: { info: vi.fn(), error: vi.fn() },
      });
      const received: DuelWorkerEvent[] = [];
      client.subscribe(({ event }) => received.push(event));
      expect(client.initialize()).toBe(true);

      await vi.advanceTimersByTimeAsync(25);
      expect(workers[0]?.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      expect(received).toContainEqual({
        type: "error",
        error: {
          code: "process_timeout",
          message: "Duel Worker did not initialize within 25ms",
          recoverable: false,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports Worker construction failure after a store subscribes", () => {
    const client = new DuelWorkerClient({
      workerFactory: () => {
        throw new Error("Workers are blocked");
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const received: DuelWorkerEvent[] = [];
    client.subscribe(({ event }) => received.push(event));

    expect(client.initialize()).toBe(false);
    expect(received).toEqual([
      {
        type: "error",
        error: {
          code: "worker_error",
          message: "Unable to create the Duel Worker: Workers are blocked",
          recoverable: false,
        },
      },
    ]);
  });

  it("emits a failed start command under the store's current context", () => {
    const { client, workers } = createHarness();
    const received: Array<{
      readonly sessionGeneration: number;
      readonly event: DuelWorkerEvent;
    }> = [];
    client.subscribe(({ context, event }) =>
      received.push({ sessionGeneration: context.sessionGeneration, event }),
    );
    const worker = workers[0]!;
    client.initialize();
    worker.emit({ type: "ready", coreVersion: [11, 0] });
    worker.postError = new Error("post failed");

    expect(client.startDuel(duelId("mvp-preset-v1"))).toBeNull();
    expect(received.at(-1)).toMatchObject({
      sessionGeneration: 0,
      event: { type: "error", error: { code: "worker_error" } },
    });
  });

  it("bounds graceful disposal, reports the timeout, and replaces the Worker", async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = createHarness(25);
      const received: DuelWorkerEvent[] = [];
      client.subscribe(({ event }) => received.push(event));
      const first = workers[0]!;

      const replacement = client.replace();
      await vi.advanceTimersByTimeAsync(25);
      await expect(replacement).resolves.toEqual({ graceful: false });
      expect(first.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      expect(received).toContainEqual({
        type: "error",
        error: {
          code: "worker_disposal_timeout",
          message: "Duel Worker did not acknowledge disposal within 25ms",
          recoverable: false,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["error", "worker_error"],
    ["messageerror", "worker_message_error"],
    ["exit", "worker_unexpected_exit"],
    ["invalid", "invalid_worker_event"],
  ] as const)(
    "turns a Worker %s into a typed error and installs a replacement",
    (failure, expectedCode) => {
      const { client, workers } = createHarness();
      const received: DuelWorkerEvent[] = [];
      client.subscribe(({ event }) => received.push(event));
      const first = workers[0]!;

      switch (failure) {
        case "error":
          first.emitError("Worker script crashed");
          break;
        case "messageerror":
          first.emitMessageError();
          break;
        case "exit":
          first.emitExit();
          break;
        case "invalid":
          first.emitRaw({ type: "ready", coreVersion: "wrong" });
          break;
      }

      expect(first.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      expect(received.at(-1)).toMatchObject({
        type: "error",
        error: { code: expectedCode, recoverable: false },
      });
    },
  );
});
