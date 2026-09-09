import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { DuelWorkerEvent } from "../../src/battle/duel/contracts/duel-worker-event.ts";
import {
  DuelWorkerRuntime,
  toDuelError,
} from "../../src/battle/worker/DuelWorkerRuntime.ts";
import { routineLogError } from "../../src/battle/worker/duel-errors.ts";
import {
  attachDuelWorker,
  type DuelWorkerScope,
} from "../../src/battle/worker/duel.worker.ts";
import type {
  WorkerLogEntry,
  WorkerLogger,
} from "../../src/battle/worker/diagnostics/worker-log.ts";

describe("duel Worker attachment", () => {
  it("rejects malformed commands at the Worker boundary", () => {
    const posted: DuelWorkerEvent[] = [];
    const scope = createScope(posted);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const logs: LoggedEntry[] = [];
    const detach = attachDuelWorker(scope, runtime, memoryLogger(logs));

    scope.onmessage?.({ data: { type: "unknown" } } as MessageEvent<unknown>);

    expect(posted).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "invalid_command",
          recoverable: true,
        }),
      }),
    ]);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "duel.worker.command.rejected",
      }),
    );
    expect(logs).toContainEqual({
      level: "debug",
      event: "duel.worker.event.dispatched",
      eventType: "error",
    });
    detach();
  });

  it("detaches immediately when the IPC dispose command is received", () => {
    const scope = createScope([]);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const logs: LoggedEntry[] = [];
    attachDuelWorker(scope, runtime, memoryLogger(logs));

    scope.onmessage?.({ data: { type: "dispose" } } as MessageEvent<unknown>);

    expect(scope.onmessage).toBeNull();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "debug",
          event: "duel.worker.command.received",
          commandType: "dispose",
        }),
        expect.objectContaining({
          level: "info",
          event: "duel.worker.command.completed",
          commandType: "dispose",
        }),
        expect.objectContaining({
          level: "info",
          event: "duel.worker.detached",
        }),
      ]),
    );
  });

  it("sanitizes typed operation causes at the Worker logger boundary", async () => {
    const sentinel = "private-worker-cause-5053103";
    const raw = new DuelOperationError(
      {
        code: "unsupported_message",
        message: "Unable to reconcile overlayMaterials state",
        recoverable: false,
      },
      new Error(sentinel),
    );
    const posted: DuelWorkerEvent[] = [];
    const scope = createScope(posted);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    vi.spyOn(runtime, "handle").mockImplementation(
      (_command, _progress, failureSink) => {
        failureSink?.(raw, {
          commandType: "initialize",
          code: raw.duelError.code,
          runtimeId: "runtime-test",
        });
        return Promise.resolve([{ type: "error", error: raw.duelError }]);
      },
    );
    const logs: LoggedEntry[] = [];
    const detach = attachDuelWorker(scope, runtime, memoryLogger(logs));

    scope.onmessage?.({
      data: { type: "initialize" },
    } as MessageEvent<unknown>);
    await Promise.resolve();
    await Promise.resolve();

    expect(inspect(raw, { depth: 8 })).toContain(sentinel);
    expect(inspect(logs, { depth: 8 })).not.toContain(sentinel);
    expect(JSON.stringify(logs)).not.toContain(sentinel);
    expect(JSON.stringify(posted)).not.toContain(sentinel);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "duel.worker.command.failed",
        err: expect.objectContaining({
          name: "DuelOperationError",
          message: "Unable to reconcile overlayMaterials state",
          code: "unsupported_message",
        }),
      }),
    );
    detach();
  });

  it("sanitizes typed causes nested by cleanup failure at the Worker logger boundary", async () => {
    const sentinel = "private-worker-structural-cause-5053103";
    const cleanupError = new Error("expected unrelated Worker cleanup failure");
    const typedError = new DuelOperationError(
      {
        code: "unsupported_message",
        message: "Unable to reconcile counters state",
        recoverable: false,
      },
      new Error(sentinel),
    );
    const compounded = new AggregateError(
      [typedError, cleanupError],
      "Unable to reconcile counters state; session cleanup failed",
      { cause: typedError },
    );
    const posted: DuelWorkerEvent[] = [];
    const scope = createScope(posted);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    vi.spyOn(runtime, "handle").mockImplementation(
      (_command, _progress, failureSink) => {
        failureSink?.(compounded, {
          commandType: "startDuel",
          code: "engine_error",
          runtimeId: "runtime-test",
          traceTail: [
            {
              sequence: 1,
              kind: "promptDiagnostic",
              detail: "reconcile:overlayHost:unavailable",
            },
          ],
        });
        return Promise.resolve([
          { type: "error", error: toDuelError(compounded) },
        ]);
      },
    );
    const logs: LoggedEntry[] = [];
    const detach = attachDuelWorker(scope, runtime, memoryLogger(logs));

    scope.onmessage?.({
      data: {
        type: "startDuel",
        duelId: "preset-test",
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      },
    } as MessageEvent<unknown>);
    await Promise.resolve();
    await Promise.resolve();

    expect(inspect(compounded, { depth: 8 })).toContain(sentinel);
    const failureLog = logs.find(
      (entry) => entry.event === "duel.worker.command.failed",
    );
    expect(failureLog).toMatchObject({
      traceTail: [
        {
          kind: "promptDiagnostic",
          detail: "reconcile:overlayHost:unavailable",
        },
      ],
    });
    const loggedError = failureLog?.err as {
      readonly errors: readonly unknown[];
    };
    expect(Object.isFrozen(loggedError)).toBe(true);
    expect(Object.isFrozen(loggedError.errors)).toBe(true);
    expect(loggedError.errors[1]).toBe(cleanupError);
    expect(inspect(logs, { depth: 8 })).toContain(cleanupError.message);
    expect(inspect(logs, { depth: 8 })).not.toContain(sentinel);
    expect(JSON.stringify(logs)).not.toContain(sentinel);
    expect(posted).toEqual([
      {
        type: "error",
        error: {
          code: "unsupported_message",
          message: "Unable to reconcile counters state",
          recoverable: false,
        },
      },
    ]);
    expect(JSON.stringify(posted)).not.toContain(cleanupError.message);
    expect(JSON.stringify(posted)).not.toContain(sentinel);
    detach();
  });

  it("bounds and freezes cyclic logger projections without mutating leaves", () => {
    const sentinel = "private-cyclic-cause-5053103";
    const cleanupError = new Error("cycle cleanup remains represented");
    const typedError = new DuelOperationError(
      {
        code: "unsupported_message",
        message: "Unable to reconcile overlayMaterials state",
        recoverable: false,
      },
      new Error(sentinel),
    );
    const outer = new Error(`outer cleanup wrapper ${sentinel}`);
    const aggregate = new AggregateError(
      [typedError, cleanupError],
      `aggregate cleanup wrapper ${sentinel}`,
      { cause: outer },
    );
    Object.defineProperty(outer, "cause", {
      configurable: true,
      value: aggregate,
    });

    const projected = routineLogError(outer) as {
      readonly cause: {
        readonly cause: unknown;
        readonly errors: readonly unknown[];
      };
    };

    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.cause)).toBe(true);
    expect(Object.isFrozen(projected.cause.errors)).toBe(true);
    expect(projected.cause.errors[1]).toBe(cleanupError);
    expect(inspect(projected, { depth: 12 })).toContain("Cyclic error omitted");
    expect(inspect(projected, { depth: 12 })).not.toContain(sentinel);
    expect(JSON.stringify(projected)).not.toContain(sentinel);
    expect((outer as Error & { readonly cause: unknown }).cause).toBe(
      aggregate,
    );
    expect(aggregate.errors[0]).toBe(typedError);
  });

  it("preserves Worker behavior when an injected logger fails", () => {
    const posted: DuelWorkerEvent[] = [];
    const scope = createScope(posted);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const loggingFailure = (): never => {
      throw new Error("fake logger failure");
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const detach = attachDuelWorker(scope, runtime, {
      debug: loggingFailure,
      info: loggingFailure,
      warn: loggingFailure,
      error: loggingFailure,
    });

    try {
      scope.onmessage?.({ data: { type: "unknown" } } as MessageEvent<unknown>);
      expect(posted.at(-1)).toMatchObject({ type: "error" });
      expect(consoleError).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "duel.worker.logging.failed",
          originalEvent: "duel.worker.command.rejected",
        }),
      );
      expect(consoleError.mock.calls[0]?.[0]).not.toHaveProperty(
        "originalEntry",
      );
    } finally {
      detach();
      consoleError.mockRestore();
    }
  });

  it("logs a posting failure without claiming the event was dispatched", () => {
    const logs: LoggedEntry[] = [];
    const postingError = new Error("fake post failure");
    const scope: DuelWorkerScope = {
      onmessage: null,
      postMessage: () => {
        throw postingError;
      },
    };
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const boundaryFailures: unknown[] = [];
    const detach = attachDuelWorker(
      scope,
      runtime,
      memoryLogger(logs),
      undefined,
      (failure) => boundaryFailures.push(failure),
    );

    scope.onmessage?.({ data: { type: "unknown" } } as MessageEvent<unknown>);

    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "duel.worker.event.failed",
        eventType: "error",
      }),
    );
    expect(logs).not.toContainEqual(
      expect.objectContaining({
        event: "duel.worker.event.dispatched",
        eventType: "error",
      }),
    );
    expect(boundaryFailures).toEqual([postingError]);
    detach();
  });

  it("always disposes its runtime without clearing a replacement handler", async () => {
    const scope = createScope([]);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const detach = attachDuelWorker(scope, runtime, memoryLogger([]));
    const replacement = (): void => undefined;
    scope.onmessage = replacement;

    detach();

    expect(scope.onmessage).toBe(replacement);
    await expect(runtime.handle({ type: "initialize" })).resolves.toEqual([]);
  });

  it("reports runtime cleanup failures to the attachment owner", () => {
    const cleanupError = new Error("fake cleanup failure");
    const scope = createScope([]);
    const runtime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    vi.spyOn(runtime, "dispose").mockImplementation(() => {
      throw cleanupError;
    });
    const detachFailures: unknown[] = [];
    attachDuelWorker(scope, runtime, memoryLogger([]), (failure) => {
      detachFailures.push(failure);
    });

    scope.onmessage?.({ data: { type: "dispose" } } as MessageEvent<unknown>);

    expect(detachFailures).toEqual([cleanupError]);
    expect(scope.onmessage).toBeNull();
  });

  it("prevents multiple owners from attaching to the same Worker scope", () => {
    const scope = createScope([]);
    const firstRuntime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const secondRuntime = new DuelWorkerRuntime(async () => {
      throw new Error("initializer should not run");
    });
    const detach = attachDuelWorker(scope, firstRuntime, memoryLogger([]));

    expect(() =>
      attachDuelWorker(scope, secondRuntime, memoryLogger([])),
    ).toThrow("already has a message handler");

    detach();
    secondRuntime.dispose();
  });
});

interface LoggedEntry extends WorkerLogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
}

function memoryLogger(entries: LoggedEntry[]): WorkerLogger {
  const record =
    (level: LoggedEntry["level"]) =>
    (entry: WorkerLogEntry): void => {
      entries.push({ level, ...entry });
    };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

function createScope(posted: DuelWorkerEvent[]): DuelWorkerScope {
  return {
    onmessage: null,
    postMessage: (message) => posted.push(message),
  };
}
