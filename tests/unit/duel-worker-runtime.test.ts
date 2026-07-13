import { describe, expect, it, vi } from "vitest";
import {
  duelOperationError,
  type DuelErrorCode,
} from "../../src/duel/contracts/duel-error.ts";
import {
  createFakeOcgCoreAdapter,
  FAKE_DEPENDENCIES,
  FAKE_PRESET,
  FAKE_SNAPSHOT_ID,
} from "../fixtures/fake-ocgcore-adapter.ts";
import type { DuelRuntimeResources } from "../../src/worker/DuelWorkerRuntime.ts";
import {
  DuelWorkerRuntime,
  toDuelError,
} from "../../src/worker/DuelWorkerRuntime.ts";
import { EngineInitializationError } from "../../src/worker/engine/OcgCoreAdapter.ts";
import {
  EngineMessageType,
  EngineProcess,
} from "../../src/worker/engine/engine-constants.ts";

const WIN_MESSAGE = {
  type: EngineMessageType.WIN,
  player: 1,
  reason: 1,
} as const;

describe("DuelWorkerRuntime command lifecycle", () => {
  it("does not report a terminal controller failure as recoverable input", () => {
    expect(
      toDuelError(new Error("No supported basic opponent choice"), {
        terminal: true,
      }),
    ).toMatchObject({ code: "engine_error", recoverable: false });
  });

  it.each([
    ["Core exceeded 2 process iterations", "process_timeout"],
    [
      "ocgcore is waiting but emitted no supported player prompt",
      "unsupported_message",
    ],
    ["Stale or unknown prompt ID: duel-1-prompt-1", "stale_prompt"],
    ["No active duel session", "duel_not_active"],
  ] as const)("classifies %s", (message, code) => {
    expect(
      toDuelError(duelOperationError(code as DuelErrorCode, message)),
    ).toMatchObject({ code });
  });

  it("serializes concurrent commands, initializes once, and permits restart after completion", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({
      steps: [
        {
          status: EngineProcess.END,
          messages: [WIN_MESSAGE],
        },
      ],
    }));
    const resources = createResources(harness.adapter);
    const initialization = deferred<DuelRuntimeResources>();
    const initializeResources = vi.fn(() => initialization.promise);
    const runtime = new DuelWorkerRuntime(initializeResources);

    const firstInitialize = runtime.handle({ type: "initialize" });
    const secondInitialize = runtime.handle({ type: "initialize" });
    const firstStart = runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
    });

    await Promise.resolve();
    expect(initializeResources).toHaveBeenCalledTimes(1);
    expect(harness.counters.createDuel).toBe(0);
    initialization.resolve(resources);

    await expect(firstInitialize).resolves.toEqual([
      { type: "ready", coreVersion: [11, 0] },
    ]);
    await expect(secondInitialize).resolves.toEqual([
      { type: "ready", coreVersion: [11, 0] },
    ]);
    expect((await firstStart).at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });

    const restarted = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
    });
    expect(restarted.at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 2, destroyDuel: 2 });
    runtime.dispose();
  });

  it("streams initialization progress before ready", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({ steps: [] }));
    const initialization = deferred<DuelRuntimeResources>();
    const runtime = new DuelWorkerRuntime((progress) => {
      progress("manifest", 0.25);
      return initialization.promise;
    });
    const progressEvents: unknown[] = [];

    const pending = runtime.handle({ type: "initialize" }, (event) => {
      progressEvents.push(event);
    });
    await Promise.resolve();

    expect(progressEvents).toEqual([
      { type: "loading", stage: "manifest", progress: 0.25 },
    ]);
    initialization.resolve(createResources(harness.adapter));
    await expect(pending).resolves.toEqual([
      { type: "ready", coreVersion: [11, 0] },
    ]);
    runtime.dispose();
  });

  it("invalidates a pending initialization and suppresses late events when disposed", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({ steps: [] }));
    const initialization = deferred<DuelRuntimeResources>();
    let initializationSignal: AbortSignal | undefined;
    const initializeResources = vi.fn(
      (_progress: unknown, signal: AbortSignal) => {
        initializationSignal = signal;
        return initialization.promise;
      },
    );
    const runtime = new DuelWorkerRuntime(initializeResources);

    const pending = runtime.handle({ type: "initialize" });
    await Promise.resolve();
    expect(initializeResources).toHaveBeenCalledTimes(1);
    expect(initializationSignal?.aborted).toBe(false);

    await expect(runtime.handle({ type: "dispose" })).resolves.toEqual([]);
    expect(initializationSignal?.aborted).toBe(true);
    initialization.resolve(createResources(harness.adapter));

    await expect(pending).resolves.toEqual([]);
    await expect(runtime.handle({ type: "initialize" })).resolves.toEqual([]);
    expect(harness.counters).toEqual({ createDuel: 0, destroyDuel: 0 });
  });

  it("cleans a provisional session when diagnostic logging disposes the runtime", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({ steps: [] }), {
      createDiagnostic: { type: 1, message: "fake diagnostic" },
    });
    const runtimeRef: { current?: DuelWorkerRuntime } = {};
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(() => runtimeRef.current?.dispose()),
      error: vi.fn(),
    };
    const runtime = new DuelWorkerRuntime(
      async () => createResources(harness.adapter),
      { logger },
    );
    runtimeRef.current = runtime;
    await runtime.handle({ type: "initialize" });

    await expect(
      runtime.handle({ type: "startDuel", duelId: FAKE_PRESET.id }),
    ).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duel.worker.engine.session.diagnostic",
        message: "fake diagnostic",
      }),
    );
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
    expect(harness.activeHandles()).toBe(0);
  });

  it("defers reentrant diagnostic disposal until core processing unwinds", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({
      steps: [
        {
          status: EngineProcess.WAITING,
          diagnostic: { type: 1, message: "process diagnostic" },
          messages: [
            {
              type: EngineMessageType.SELECT_YES_NO,
              player: 0,
              description: 0n,
            },
          ],
        },
      ],
    }));
    const runtimeRef: { current?: DuelWorkerRuntime } = {};
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(() => runtimeRef.current?.dispose()),
      error: vi.fn(),
    };
    const runtime = new DuelWorkerRuntime(
      async () => createResources(harness.adapter),
      { logger },
    );
    runtimeRef.current = runtime;
    await runtime.handle({ type: "initialize" });

    await expect(
      runtime.handle({ type: "startDuel", duelId: FAKE_PRESET.id }),
    ).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: "process diagnostic" }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
    expect(harness.activeHandles()).toBe(0);
  });

  it("logs direct runtime disposal failures before propagating them", async () => {
    const cleanupError = new Error("fake runtime cleanup failure");
    const harness = await createFakeOcgCoreAdapter(
      () => ({
        steps: [
          {
            status: EngineProcess.WAITING,
            messages: [
              {
                type: EngineMessageType.SELECT_YES_NO,
                player: 0,
                description: 0n,
              },
            ],
          },
        ],
      }),
      { destroyError: cleanupError },
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = new DuelWorkerRuntime(
      async () => createResources(harness.adapter),
      { logger },
    );
    await runtime.handle({ type: "initialize" });
    await runtime.handle({ type: "startDuel", duelId: FAKE_PRESET.id });

    expect(() => runtime.dispose()).toThrow(cleanupError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duel.worker.session.cleanup.failed",
        err: cleanupError,
      }),
    );
    expect(harness.counters.destroyDuel).toBe(1);
  });

  it("bounds the pending command queue while initialization is blocked", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({ steps: [] }));
    const initialization = deferred<DuelRuntimeResources>();
    const runtime = new DuelWorkerRuntime(() => initialization.promise, {
      maximumQueuedCommands: 1,
    });

    const pending = runtime.handle({ type: "initialize" });
    await Promise.resolve();
    const overflow = await runtime.handle({ type: "initialize" });
    expect(overflow).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "invalid_command",
          recoverable: true,
        }),
      }),
    ]);

    await runtime.handle({ type: "dispose" });
    initialization.resolve(createResources(harness.adapter));
    await expect(pending).resolves.toEqual([]);
  });

  it("preserves typed initialization errors and reports invalid lifecycle commands", async () => {
    const initializationError = new EngineInitializationError({
      code: "engine_initialization_failed",
      message: "fake initialization failure",
      recoverable: false,
    });
    const initializeResources = vi.fn(async () => {
      throw initializationError;
    });
    const runtime = new DuelWorkerRuntime(initializeResources);

    const initialized = await runtime.handle({ type: "initialize" });
    expect(initialized).toEqual([
      {
        type: "error",
        error: initializationError.duelError,
      },
    ]);

    expect(await runtime.handle({ type: "initialize" })).toEqual(initialized);
    expect(initializeResources).toHaveBeenCalledTimes(1);

    const surrendered = await runtime.handle({ type: "surrender" });
    expect(surrendered).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "duel_not_active",
          recoverable: true,
        }),
      }),
    ]);
    runtime.dispose();
  });

  it("releases a failed controller so a later duel can start cleanly", async () => {
    let duelNumber = 0;
    const harness = await createFakeOcgCoreAdapter(() => {
      duelNumber += 1;
      return duelNumber === 1
        ? { steps: [{ error: new Error("fake engine failure") }] }
        : {
            steps: [
              {
                status: EngineProcess.END,
                messages: [WIN_MESSAGE],
              },
            ],
          };
    });
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const failures: { error: unknown; code: string }[] = [];
    const failed = await runtime.handle(
      {
        type: "startDuel",
        duelId: FAKE_PRESET.id,
      },
      undefined,
      (error, context) => failures.push({ error, code: context.code }),
    );
    expect(failed).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "engine_error" }),
      }),
    ]);
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
    expect(failures).toEqual([
      { error: expect.any(Error), code: "engine_error" },
    ]);

    const restarted = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
    });
    expect(restarted.at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 2, destroyDuel: 2 });
    runtime.dispose();
  });
});

function createResources(
  adapter: DuelRuntimeResources["adapter"],
): DuelRuntimeResources {
  return {
    adapter,
    dependencies: FAKE_DEPENDENCIES,
    preset: FAKE_PRESET,
    snapshotId: FAKE_SNAPSHOT_ID,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
