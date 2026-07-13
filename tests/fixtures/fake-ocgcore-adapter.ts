import type { OcgCoreSync } from "../../vendor/ocgcore-wasm/0.1.2/dist/index.js";
import type { SnapshotId } from "../../src/duel/contracts/ids.ts";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import type { ParsedDeck } from "../../src/duel/presets/deck-parser.ts";
import {
  MVP_PRESET_ID,
  type MvpPreset,
} from "../../src/duel/presets/mvp-preset.ts";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import {
  type EngineDuelHandle,
  type EngineDuelOptions,
  type EngineMessage,
  OcgCoreAdapter,
} from "../../src/worker/engine/OcgCoreAdapter.ts";
import { EngineProcess } from "../../src/worker/engine/engine-constants.ts";

export interface FakeProcessStep {
  readonly status?: number;
  readonly messages?: readonly EngineMessage[];
  readonly error?: Error;
  readonly diagnostic?: {
    readonly type: number;
    readonly message: string;
  };
}

export interface FakeDuelProgram {
  readonly steps: readonly FakeProcessStep[];
  readonly fallback?: FakeProcessStep;
}

export interface FakeCoreCounters {
  createDuel: number;
  destroyDuel: number;
}

export interface FakeOcgCoreAdapterOptions {
  readonly destroyError?: Error;
  readonly createDiagnostic?: {
    readonly type: number;
    readonly message: string;
  };
}

export interface FakeOcgCoreAdapterHarness {
  readonly adapter: OcgCoreAdapter;
  readonly counters: FakeCoreCounters;
  readonly activeHandles: () => number;
}

interface FakeHandleState {
  readonly steps: FakeProcessStep[];
  readonly fallback: FakeProcessStep;
  readonly errorHandler?: EngineDuelOptions["errorHandler"];
  messages: EngineMessage[];
}

export const EMPTY_DECK: ParsedDeck = Object.freeze({
  main: Object.freeze([]),
  extra: Object.freeze([]),
  side: Object.freeze([]),
});

export const FAKE_DEPENDENCIES: ActiveDuelDependencies = Object.freeze({
  cards: new Map(),
  texts: new Map(),
  scripts: new Map([
    ["constant.lua", ""],
    ["utility.lua", ""],
  ]),
  strings: Object.freeze({
    system: Object.freeze({}),
    victory: Object.freeze({}),
    counter: Object.freeze({}),
    setname: Object.freeze({}),
  }),
  images: new Map(),
  counts: Object.freeze({
    cards: 0,
    texts: 0,
    scripts: 2,
    globals: 2,
    images: 0,
  }),
});

export const FAKE_PRESET: MvpPreset = Object.freeze({
  id: MVP_PRESET_ID,
  player: EMPTY_DECK,
  opponent: EMPTY_DECK,
});

export const FAKE_SNAPSHOT_ID: SnapshotId = snapshotId("fake-snapshot");

export async function createFakeOcgCoreAdapter(
  programFactory: () => FakeDuelProgram,
  options: FakeOcgCoreAdapterOptions = {},
): Promise<FakeOcgCoreAdapterHarness> {
  const counters: FakeCoreCounters = { createDuel: 0, destroyDuel: 0 };
  const handles = new Map<EngineDuelHandle, FakeHandleState>();
  let nextHandle = 1;

  const core = {
    getVersion: () => [11, 0] as const,
    createDuel: (duelOptions: EngineDuelOptions) => {
      counters.createDuel += 1;
      if (options.createDiagnostic !== undefined) {
        duelOptions.errorHandler?.(
          options.createDiagnostic.type,
          options.createDiagnostic.message,
        );
      }
      const handle = {
        fakeHandle: nextHandle++,
      } as unknown as EngineDuelHandle;
      const program = programFactory();
      handles.set(handle, {
        steps: [...program.steps],
        fallback: program.fallback ?? { status: EngineProcess.WAITING },
        ...(duelOptions.errorHandler === undefined
          ? {}
          : { errorHandler: duelOptions.errorHandler }),
        messages: [],
      });
      return handle;
    },
    destroyDuel: (handle: EngineDuelHandle) => {
      counters.destroyDuel += 1;
      if (options.destroyError !== undefined) throw options.destroyError;
      handles.delete(handle);
    },
    duelNewCard: () => undefined,
    loadScript: () => true,
    startDuel: () => undefined,
    duelProcess: (handle: EngineDuelHandle) => {
      const state = requireHandle(handles, handle);
      const step = state.steps.shift() ?? state.fallback;
      if (step.error !== undefined) throw step.error;
      if (step.diagnostic !== undefined) {
        state.errorHandler?.(step.diagnostic.type, step.diagnostic.message);
        if (!handles.has(handle))
          throw new Error("Fake duel handle was destroyed during processing");
      }
      state.messages.push(...(step.messages ?? []));
      return step.status ?? EngineProcess.CONTINUE;
    },
    duelGetMessage: (handle: EngineDuelHandle) => {
      const state = requireHandle(handles, handle);
      const messages = state.messages;
      state.messages = [];
      return messages;
    },
    duelSetResponse: () => undefined,
  } as unknown as OcgCoreSync;

  const adapter = await OcgCoreAdapter.initialize({
    wasmBinary: new ArrayBuffer(8),
    factory: async () => core,
  });

  return {
    adapter,
    counters,
    activeHandles: () => handles.size,
  };
}

function requireHandle(
  handles: ReadonlyMap<EngineDuelHandle, FakeHandleState>,
  handle: EngineDuelHandle,
): FakeHandleState {
  const state = handles.get(handle);
  if (state === undefined) throw new Error("Unknown fake duel handle");
  return state;
}
