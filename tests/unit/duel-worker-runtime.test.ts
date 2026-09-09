import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { DuelCommand } from "../../src/battle/duel/contracts/duel-command.ts";
import {
  DuelOperationError,
  duelOperationError,
  type DuelErrorCode,
} from "../../src/battle/duel/contracts/duel-error.ts";
import { duelId } from "../../src/battle/duel/contracts/ids.ts";
import {
  createFakeOcgCoreAdapter,
  FAKE_DEPENDENCIES,
  FAKE_PRESET,
  FAKE_SNAPSHOT_ID,
} from "../fixtures/fake-ocgcore-adapter.ts";
import type { DuelRuntimeResources } from "../../src/battle/worker/DuelWorkerRuntime.ts";
import {
  DuelWorkerRuntime,
  toDuelError,
} from "../../src/battle/worker/DuelWorkerRuntime.ts";
import { EngineInitializationError } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import {
  EngineLocation,
  EngineMessageType,
  EnginePosition,
  EngineProcess,
} from "../../src/battle/worker/engine/engine-constants.ts";

const WIN_MESSAGE = {
  type: EngineMessageType.WIN,
  player: 1,
  reason: 1,
} as const;

const counterReconciliationFailureProgram = () => ({
  steps: [
    {
      status: EngineProcess.WAITING,
      messages: [
        {
          type: EngineMessageType.REMOVE_COUNTER,
          counter_type: 1,
          controller: 0 as const,
          location: EngineLocation.MONSTER,
          sequence: 0,
          count: 1,
        },
      ],
    },
  ],
});

const reconciliationFailureProgram = () => ({
  steps: [
    {
      status: EngineProcess.WAITING,
      messages: [
        {
          type: EngineMessageType.MOVE,
          card: 97590747,
          from: {
            controller: 0 as const,
            location: EngineLocation.DECK,
            sequence: 0,
            position: EnginePosition.FACE_DOWN_DEFENSE,
          },
          to: {
            controller: 0 as const,
            location: EngineLocation.MONSTER,
            sequence: 0,
            position: EnginePosition.FACE_UP_ATTACK,
          },
        },
        {
          type: EngineMessageType.MOVE,
          card: 5053103,
          from: {
            controller: 0 as const,
            location: EngineLocation.DECK,
            sequence: 1,
            position: EnginePosition.FACE_DOWN_DEFENSE,
          },
          to: {
            controller: 0 as const,
            location: EngineLocation.MONSTER,
            sequence: 0,
            position: EnginePosition.FACE_UP_ATTACK,
            overlay_sequence: 0,
          },
        },
      ],
    },
  ],
});

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
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });

    await Promise.resolve();
    expect(initializeResources).toHaveBeenCalledTimes(1);
    expect(harness.counters.createDuel).toBe(0);
    initialization.resolve(resources);

    await expect(firstInitialize).resolves.toEqual([
      {
        type: "ready",
        coreVersion: [11, 0],
        snapshotId: FAKE_SNAPSHOT_ID,
      },
    ]);
    await expect(secondInitialize).resolves.toEqual([
      {
        type: "ready",
        coreVersion: [11, 0],
        snapshotId: FAKE_SNAPSHOT_ID,
      },
    ]);
    expect((await firstStart).at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });

    const restarted = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    expect(restarted.at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 2, destroyDuel: 2 });
    runtime.dispose();
  });

  it("allocates event sequences monotonically and resets them for each duel session", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({
      steps: [
        {
          status: EngineProcess.END,
          messages: [
            { type: EngineMessageType.NEW_TURN, player: 0 as const },
            { type: EngineMessageType.NEW_PHASE, phase: 4 },
            WIN_MESSAGE,
          ],
        },
      ],
    }));
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const first = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    expect(
      first
        .filter((event) => event.type === "event")
        .map(({ eventSequence }) => eventSequence),
    ).toEqual([1, 2]);

    const second = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    expect(
      second
        .filter((event) => event.type === "event")
        .map(({ eventSequence }) => eventSequence),
    ).toEqual([1, 2]);
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
      {
        type: "ready",
        coreVersion: [11, 0],
        snapshotId: FAKE_SNAPSHOT_ID,
      },
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
      runtime.handle({
        type: "startDuel",
        duelId: FAKE_PRESET.id,
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
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

  it("retains engine diagnostics in the downloadable bounded trace", async () => {
    const harness = await createFakeOcgCoreAdapter(
      () => ({
        steps: [
          {
            status: EngineProcess.END,
            messages: [WIN_MESSAGE],
          },
        ],
      }),
      { createDiagnostic: { type: 7, message: "fixture core diagnostic" } },
    );
    const runtime = new DuelWorkerRuntime(
      async () => createResources(harness.adapter),
      {
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
    );
    await runtime.handle({ type: "initialize" });
    await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });

    const [diagnostics] = await runtime.handle({ type: "requestDiagnostics" });
    expect(diagnostics).toMatchObject({
      type: "diagnostics",
      trace: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            kind: "engineDiagnostic",
            diagnosticType: 7,
            detail: "engine diagnostic emitted",
          }),
        ]),
      },
    });
    runtime.dispose();
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
      runtime.handle({
        type: "startDuel",
        duelId: FAKE_PRESET.id,
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
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
    await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });

    expect(() => runtime.dispose()).toThrow(cleanupError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duel.worker.session.cleanup.failed",
        err: cleanupError,
      }),
    );
    expect(harness.counters.destroyDuel).toBe(1);
  });

  it("poisons the runtime after uncertain core-handle cleanup", async () => {
    const harness = await createFakeOcgCoreAdapter(
      () => ({
        steps: [{ status: EngineProcess.END, messages: [WIN_MESSAGE] }],
      }),
      { destroyError: new Error("uncertain destroy") },
    );
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const failed = await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    expect(failed).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ recoverable: false }),
      }),
    ]);
    expect(runtime.replacementRequired).toBe(true);
    await expect(
      runtime.handle({
        type: "startDuel",
        duelId: FAKE_PRESET.id,
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
    ).resolves.toEqual([]);
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

  it("returns a bounded sensitive diagnostic trace after completion", async () => {
    const harness = await createFakeOcgCoreAdapter(() => ({
      steps: [
        {
          status: EngineProcess.END,
          messages: [WIN_MESSAGE],
        },
      ],
    }));
    const runtime = new DuelWorkerRuntime(async () => ({
      ...createResources(harness.adapter),
      revisions: {
        babelCdb: "babel-revision",
        cardScripts: "script-revision",
        distribution: "string-revision",
        activeImageManifestSha256: "f".repeat(64),
      },
    }));
    await runtime.handle({ type: "initialize" });
    await runtime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });

    const [diagnostics] = await runtime.handle({ type: "requestDiagnostics" });
    expect(diagnostics).toMatchObject({
      type: "diagnostics",
      trace: {
        schemaVersion: 2,
        sensitivity: "contains-production-seed",
        snapshotId: FAKE_SNAPSHOT_ID,
        coreVersion: [11, 0],
        revisions: {
          babelCdb: "babel-revision",
          activeImageManifestSha256: "f".repeat(64),
        },
      },
    });
    if (diagnostics?.type !== "diagnostics")
      throw new Error("Expected diagnostics event");
    expect(diagnostics.trace.seed).toHaveLength(4);
    expect(diagnostics.trace.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics.trace)).not.toContain("wasmBinary");
    runtime.dispose();
  });

  it("keeps reconciliation causes internal while routine Worker logs stay sanitized", async () => {
    const hiddenSentinel = "private-reconciliation-card-5053103";
    const harness = await createFakeOcgCoreAdapter(
      reconciliationFailureProgram,
      {
        queryCard: () => {
          throw new Error(hiddenSentinel);
        },
      },
    );

    const internalRuntime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    await internalRuntime.handle({ type: "initialize" });
    let internalFailure: unknown;
    const internalEvents = await internalRuntime.handle(
      {
        type: "startDuel",
        duelId: FAKE_PRESET.id,
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      },
      undefined,
      (error) => {
        internalFailure = error;
      },
    );
    expect(internalFailure).toBeInstanceOf(DuelOperationError);
    expect(inspect(internalFailure, { depth: 8 })).toContain(hiddenSentinel);
    expect(JSON.stringify(internalEvents)).not.toContain(hiddenSentinel);
    const internalTrace = await internalRuntime.handle({
      type: "requestDiagnostics",
    });
    expect(JSON.stringify(internalTrace)).not.toContain(hiddenSentinel);
    internalRuntime.dispose();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const loggedRuntime = new DuelWorkerRuntime(
      async () => createResources(harness.adapter),
      { logger },
    );
    await loggedRuntime.handle({ type: "initialize" });
    const publicEvents = await loggedRuntime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    const publicTrace = await loggedRuntime.handle({
      type: "requestDiagnostics",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "duel.worker.command.failed",
        err: expect.objectContaining({
          name: "DuelOperationError",
          message: "Unable to reconcile overlayMaterials state",
          code: "unsupported_message",
        }),
      }),
    );
    expect(inspect(logger.error.mock.calls, { depth: 8 })).not.toContain(
      hiddenSentinel,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      hiddenSentinel,
    );
    expect(JSON.stringify([publicEvents, publicTrace])).not.toContain(
      hiddenSentinel,
    );
    loggedRuntime.dispose();
  });

  it("sanitizes reconciliation causes nested by cleanup failure in routine logs", async () => {
    const hiddenSentinel = "private-structural-cause-5053103";
    const cleanupMessage = "expected unrelated cleanup failure";
    const internalCleanup = new Error(cleanupMessage);
    const internalHarness = await createFakeOcgCoreAdapter(
      counterReconciliationFailureProgram,
      {
        destroyError: internalCleanup,
        queryCard: () => {
          throw new Error(hiddenSentinel);
        },
      },
    );
    const internalRuntime = new DuelWorkerRuntime(async () =>
      createResources(internalHarness.adapter),
    );
    await internalRuntime.handle({ type: "initialize" });
    let internalFailure: unknown;
    const internalEvents = await internalRuntime.handle(
      {
        type: "startDuel",
        duelId: FAKE_PRESET.id,
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      },
      undefined,
      (error) => {
        internalFailure = error;
      },
    );
    expect(internalFailure).toBeInstanceOf(AggregateError);
    const aggregate = internalFailure as AggregateError;
    expect(aggregate.errors[0]).toBeInstanceOf(DuelOperationError);
    expect(aggregate.errors[1]).toBe(internalCleanup);
    expect(inspect(aggregate, { depth: 8 })).toContain(hiddenSentinel);
    expect(JSON.stringify(internalEvents)).toContain(
      "Unable to reconcile counters state",
    );
    expect(JSON.stringify(internalEvents)).not.toContain(hiddenSentinel);
    expect(JSON.stringify(internalEvents)).not.toContain(cleanupMessage);
    const internalTrace = await internalRuntime.handle({
      type: "requestDiagnostics",
    });
    expect(JSON.stringify(internalTrace)).not.toContain(hiddenSentinel);

    const loggedCleanup = new Error(cleanupMessage);
    const loggedHarness = await createFakeOcgCoreAdapter(
      counterReconciliationFailureProgram,
      {
        destroyError: loggedCleanup,
        queryCard: () => {
          throw new Error(hiddenSentinel);
        },
      },
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const loggedRuntime = new DuelWorkerRuntime(
      async () => createResources(loggedHarness.adapter),
      { logger },
    );
    await loggedRuntime.handle({ type: "initialize" });
    const publicEvents = await loggedRuntime.handle({
      type: "startDuel",
      duelId: FAKE_PRESET.id,
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    const publicTrace = await loggedRuntime.handle({
      type: "requestDiagnostics",
    });
    const commandFailure = logger.error.mock.calls.find(
      ([entry]) => entry.event === "duel.worker.command.failed",
    );
    expect(commandFailure).toBeDefined();
    const loggedError = commandFailure?.[0].err as {
      readonly errors: readonly unknown[];
    };
    expect(Object.isFrozen(loggedError)).toBe(true);
    expect(Object.isFrozen(loggedError.errors)).toBe(true);
    expect(loggedError.errors[1]).toBe(loggedCleanup);
    expect(inspect(logger.error.mock.calls, { depth: 8 })).toContain(
      cleanupMessage,
    );
    expect(inspect(logger.error.mock.calls, { depth: 8 })).not.toContain(
      hiddenSentinel,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      hiddenSentinel,
    );
    expect(JSON.stringify(publicEvents)).toContain(
      "Unable to reconcile counters state",
    );
    expect(JSON.stringify(publicEvents)).not.toContain(cleanupMessage);
    expect(JSON.stringify([publicEvents, publicTrace])).not.toContain(
      hiddenSentinel,
    );
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
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
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
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    expect(restarted.at(-1)).toEqual({
      type: "result",
      result: { type: "completed", winner: 1, loser: 0, reason: 1 },
    });
    expect(harness.counters).toEqual({ createDuel: 2, destroyDuel: 2 });
    runtime.dispose();
  });
});

describe("duels started from an explicit card list", () => {
  it("starts a duel from card lists and never checks a preset id", async () => {
    const harness = await createFakeOcgCoreAdapter(winImmediately);
    const runtime = new DuelWorkerRuntime(async () =>
      createCardListResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const started = await runtime.handle({
      type: "startDuel",
      /* Nothing derives this id, so a preset-shaped assertion would refuse a
         duel that is otherwise entirely legal. */
      duelId: duelId("custom-v1:anything"),
      player: { kind: "cards", main: PLAYER_MAIN, extra: [], side: [] },
      opponent: { kind: "cards", main: OPPONENT_MAIN, extra: [], side: [] },
    });

    expect(started.some(({ type }) => type === "error")).toBe(false);
    expect(harness.counters.createDuel).toBe(1);
    runtime.dispose();
  });

  it("keeps the opponent card list out of every event it sends back", async () => {
    const harness = await createFakeOcgCoreAdapter(winImmediately);
    const runtime = new DuelWorkerRuntime(async () =>
      createCardListResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const started = await runtime.handle({
      type: "startDuel",
      duelId: duelId("custom-v1:hidden"),
      player: { kind: "cards", main: PLAYER_MAIN, extra: [], side: [] },
      opponent: { kind: "cards", main: OPPONENT_MAIN, extra: [], side: [] },
    });
    const diagnostics = await runtime.handle({ type: "requestDiagnostics" });

    /* The opponent's codes are disjoint from the player's, so any appearance
       in the Worker's outbound traffic is the Worker disclosing a deck the
       main thread is not meant to read. */
    const outbound = JSON.stringify([...started, ...diagnostics]);
    for (const code of OPPONENT_MAIN) {
      expect(outbound).not.toContain(String(code));
    }
    runtime.dispose();
  });

  it("refuses an unsupported code without creating a core session", async () => {
    const harness = await createFakeOcgCoreAdapter(winImmediately);
    const runtime = new DuelWorkerRuntime(async () =>
      createCardListResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    const refused = await runtime.handle({
      type: "startDuel",
      duelId: duelId("custom-v1:unsupported"),
      player: {
        kind: "cards",
        main: [...PLAYER_MAIN.slice(1), 909_090],
        extra: [],
        side: [],
      },
      opponent: { kind: "cards", main: OPPONENT_MAIN, extra: [], side: [] },
    });

    expect(refused).toEqual([
      {
        type: "error",
        error: {
          code: "unsupported_card",
          message: expect.stringContaining("909090"),
          recoverable: true,
        },
      },
    ]);
    expect(harness.counters).toEqual({ createDuel: 0, destroyDuel: 0 });
    runtime.dispose();
  });

  it("rebuilds a failed duel from its own recorded responses", async () => {
    const harness = await createFakeOcgCoreAdapter(recordedDuelProgram);
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    try {
      await runtime.handle({ type: "initialize" });
      const started = await runtime.handle(START_FAKE_DUEL);
      const firstPrompt = started.find((event) => event.type === "prompt");
      if (firstPrompt?.type !== "prompt")
        throw new Error("Fake duel asked the player nothing");

      /* A live duel is played, not rebuilt. */
      expect(await runtime.handle({ type: "restore" })).toEqual([
        { type: "restore_failed", reason: "duel_active" },
      ]);

      const answered = await runtime.handle({
        type: "respond",
        promptId: firstPrompt.prompt.id,
        choiceIds: [firstPrompt.prompt.choices[0]!.id],
      });
      const secondPrompt = answered.find((event) => event.type === "prompt");
      if (secondPrompt?.type !== "prompt")
        throw new Error(
          "Fake duel asked the player nothing after the opponent",
        );
      const failed = await runtime.handle({
        type: "respond",
        promptId: secondPrompt.prompt.id,
        choiceIds: [secondPrompt.prompt.choices[0]!.id],
      });
      expect(failed).toEqual([
        {
          type: "error",
          error: expect.objectContaining({ recoverable: false }),
          canRestore: true,
        },
      ]);
      const before = runtime.diagnosticTrace();

      const restored = await runtime.handle({ type: "restore" });
      expect(restored.map((event) => event.type)).toEqual([
        "restored",
        "state",
        "prompt",
      ]);
      const restoredPrompt = restored.find((event) => event.type === "prompt");
      if (restoredPrompt?.type !== "prompt")
        throw new Error("Restore published no live prompt");
      expect(restoredPrompt.prompt).toEqual(secondPrompt.prompt);
      expect(harness.counters.createDuel).toBe(2);

      /* The opponent's recorded answer was fed back, reason and all, instead
         of being decided a second time. */
      const after = runtime.diagnosticTrace();
      expect(responses(after)).toEqual(responses(before).slice(0, -1));
      expect(responses(after)).toContainEqual(
        expect.objectContaining({
          player: 1,
          opponentReason: "decline_optional",
        }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("refuses to hand over a rebuilt duel that asks a different question", async () => {
    let createdDuels = 0;
    const harness = await createFakeOcgCoreAdapter(() => {
      createdDuels += 1;
      /* The rebuilt duel opens on the opponent's seat, so the first recorded
         answer no longer belongs to the prompt in front of it. */
      return createdDuels === 1
        ? recordedDuelProgram()
        : { steps: [yesNoStep(1), yesNoStep(0)] };
    });
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    try {
      await runtime.handle({ type: "initialize" });
      const started = await runtime.handle(START_FAKE_DUEL);
      const firstPrompt = started.find((event) => event.type === "prompt");
      if (firstPrompt?.type !== "prompt")
        throw new Error("Fake duel asked the player nothing");
      const answered = await runtime.handle({
        type: "respond",
        promptId: firstPrompt.prompt.id,
        choiceIds: [firstPrompt.prompt.choices[0]!.id],
      });
      const secondPrompt = answered.find((event) => event.type === "prompt");
      if (secondPrompt?.type !== "prompt")
        throw new Error(
          "Fake duel asked the player nothing after the opponent",
        );
      await runtime.handle({
        type: "respond",
        promptId: secondPrompt.prompt.id,
        choiceIds: [secondPrompt.prompt.choices[0]!.id],
      });
      const before = runtime.diagnosticTrace();

      expect(await runtime.handle({ type: "restore" })).toEqual([
        {
          type: "restore_failed",
          reason: "replay_diverged",
          detail: expect.stringContaining("Replay expected"),
        },
      ]);
      /* The duel the player is looking at, and the report they can download,
         are untouched by the attempt. */
      expect(runtime.diagnosticTrace()).toEqual(before);
      expect(harness.counters).toEqual({ createDuel: 2, destroyDuel: 2 });
      expect(harness.activeHandles()).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  it("still refuses a preset pair whose duel id does not match", async () => {
    const harness = await createFakeOcgCoreAdapter(winImmediately);
    const runtime = new DuelWorkerRuntime(async () =>
      createResources(harness.adapter),
    );
    await runtime.handle({ type: "initialize" });

    expect(
      await runtime.handle({
        type: "startDuel",
        duelId: duelId("custom-v1:forged"),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
    ).toEqual([
      {
        type: "error",
        error: expect.objectContaining({ code: "invalid_command" }),
      },
    ]);
    expect(harness.counters).toEqual({ createDuel: 0, destroyDuel: 0 });
    runtime.dispose();
  });
});

const PLAYER_MAIN = Array.from({ length: 40 }, (_, index) => 11_000 + index);
const OPPONENT_MAIN = Array.from({ length: 40 }, (_, index) => 22_000 + index);

const START_FAKE_DUEL = {
  type: "startDuel",
  duelId: FAKE_PRESET.id,
  player: { kind: "preset", deckId: "chapter-one-starter" },
  opponent: { kind: "preset", deckId: "chapter-one-practice" },
} as const satisfies DuelCommand;

function yesNoStep(player: 0 | 1) {
  return {
    status: EngineProcess.WAITING,
    messages: [
      { type: EngineMessageType.SELECT_YES_NO, player, description: 0n },
    ],
  };
}

/** Player, opponent, player, then a core that gives up: the shortest duel
    that still has a decision of the player's own to go back to. */
const recordedDuelProgram = () => ({
  steps: [
    yesNoStep(0),
    yesNoStep(1),
    yesNoStep(0),
    { error: new Error("fake core rejected the previous response") },
  ],
});

function responses(
  trace: ReturnType<DuelWorkerRuntime["diagnosticTrace"]>,
): readonly unknown[] {
  return (trace?.entries ?? []).flatMap((entry) =>
    entry.kind === "response"
      ? [
          {
            promptId: entry.promptId,
            choiceIds: entry.choiceIds,
            player: entry.player,
            ...(entry.opponentReason === undefined
              ? {}
              : { opponentReason: entry.opponentReason }),
          },
        ]
      : [],
  );
}

const winImmediately = () => ({
  steps: [{ status: EngineProcess.END, messages: [WIN_MESSAGE] }],
});

function createCardListResources(
  adapter: DuelRuntimeResources["adapter"],
): DuelRuntimeResources {
  const codes = [...PLAYER_MAIN, ...OPPONENT_MAIN];
  return {
    ...createResources(adapter),
    dependencies: {
      ...FAKE_DEPENDENCIES,
      cards: new Map(
        codes.map((code) => [
          code,
          {
            code,
            alias: 0,
            setcodes: [],
            type: 0x1,
            level: 4,
            attribute: 1,
            race: 1n,
            attack: 0,
            defense: 0,
            lscale: 0,
            rscale: 0,
            link_marker: 0,
          },
        ]),
      ),
      images: new Map(
        codes.map((code) => [code, { code, full: "", cropped: "" }]),
      ),
    },
  };
}

function createResources(
  adapter: DuelRuntimeResources["adapter"],
): DuelRuntimeResources {
  return {
    adapter,
    dependencies: FAKE_DEPENDENCIES,
    createPreset: (playerDeckId, opponentDeckId) => ({
      ...FAKE_PRESET,
      playerDeckId,
      opponentDeckId,
    }),
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
