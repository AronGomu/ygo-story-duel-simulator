import { describe, expect, it, vi } from "vitest";
import type { DuelWorkerEvent } from "../../src/duel/contracts/duel-worker-event.ts";
import { DuelWorkerRuntime } from "../../src/worker/DuelWorkerRuntime.ts";
import {
  attachDuelWorker,
  type DuelWorkerScope,
} from "../../src/worker/duel.worker.ts";
import type {
  WorkerLogEntry,
  WorkerLogger,
} from "../../src/worker/diagnostics/worker-log.ts";

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
        expect.objectContaining({ event: "duel.worker.logging.failed" }),
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
