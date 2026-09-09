// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerClientSpies = vi.hoisted(() => {
  const runtimeSnapshotId = "a".repeat(64);
  Object.assign(globalThis, {
    __RUNTIME_SNAPSHOT_ID__: runtimeSnapshotId,
    __ACTIVATION_SNAPSHOT_ID__: runtimeSnapshotId,
    __RUNTIME_MANIFEST_SHA256__: "b".repeat(64),
    __ACTIVE_IMAGE_MANIFEST_SHA256__: "c".repeat(64),
    __RUNTIME_REVISIONS__: {},
    __ACTIVE_IMAGE_MANIFEST__: {
      snapshotId: runtimeSnapshotId,
      files: [],
      missing: [],
    },
    __APP_BUILD_ID__: "component-test",
  });
  return { startDuel: vi.fn(), respond: vi.fn() };
});

/* The probe the whole file is about: every `mapSnapshotToBoard` call the app
   makes, counted. The duel store maps too, but only while reducing a `prompt`
   or a recoverable `error`, and no measured window below emits either. */
const boardMapping = vi.hoisted(() => ({ calls: 0 }));

vi.mock(
  "../../src/battle/field/board-view-model.ts",
  async (importOriginal) => {
    const actual = await importOriginal<typeof BoardViewModel>();
    return {
      ...actual,
      mapSnapshotToBoard: (
        ...args: Parameters<typeof actual.mapSnapshotToBoard>
      ) => {
        boardMapping.calls += 1;
        return actual.mapSnapshotToBoard(...args);
      },
    };
  },
);

vi.mock("../../src/battle/app/DuelWorkerClient.ts", () => {
  class DuelWorkerClientMock {
    static instances: DuelWorkerClientMock[] = [];
    context = { workerGeneration: 1, sessionGeneration: 0 };
    listeners = new Set<(received: unknown) => void>();

    constructor() {
      DuelWorkerClientMock.instances.push(this);
    }

    subscribe(listener: (received: unknown) => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    initialize() {
      queueMicrotask(() => {
        for (const listener of this.listeners)
          listener({
            context: this.context,
            event: { type: "ready", coreVersion: [11, 0] },
          });
      });
      return true;
    }

    startDuel(...args: unknown[]) {
      workerClientSpies.startDuel(...args);
      this.context = { ...this.context, sessionGeneration: 1 };
      return this.context;
    }

    respond(...args: unknown[]) {
      workerClientSpies.respond(...args);
      return false;
    }

    surrender() {
      return false;
    }

    requestDiagnostics() {
      return false;
    }

    async replace() {
      this.context = {
        workerGeneration: this.context.workerGeneration + 1,
        sessionGeneration: 0,
      };
      return { graceful: true };
    }

    async dispose() {
      return { graceful: true };
    }
  }

  return { DuelWorkerClient: DuelWorkerClientMock };
});

import App from "../../src/battle/app/App.svelte";
import { DuelWorkerClient as MockedDuelWorkerClient } from "../../src/battle/app/DuelWorkerClient.ts";
import type * as BoardViewModel from "../../src/battle/field/board-view-model.ts";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type { DuelPresentationEvent } from "../../src/battle/duel/contracts/duel-presentation-event.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";

interface MockedWorkerInstance {
  readonly context: { workerGeneration: number; sessionGeneration: number };
  readonly listeners: Set<(received: unknown) => void>;
}
interface MockedWorkerClientCtor {
  instances: MockedWorkerInstance[];
}

const mockedWorkerClientCtor =
  MockedDuelWorkerClient as unknown as MockedWorkerClientCtor;

beforeEach(() => {
  boardMapping.calls = 0;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  workerClientSpies.startDuel.mockReset();
  workerClientSpies.respond.mockReset();
  mockedWorkerClientCtor.instances.length = 0;
});

function emptyPlayer(player: 0 | 1) {
  return {
    player,
    lifePoints: 8000,
    deckCount: 40,
    deck: [],
    extraDeckCount: 0,
    handCount: 0,
    hand: [],
    extraDeck: [],
    monsters: [],
    spellsAndTraps: [],
    graveyard: [],
    banished: [],
  } as const;
}

function snapshotAtTurn(turn: number): PublicDuelState {
  return {
    snapshotId: snapshotId(String(turn).padStart(64, "d")),
    revision: turn,
    turn,
    turnPlayer: 0,
    phase: "main1",
    layout: { extraMonsterZones: true },
    players: [emptyPlayer(0), emptyPlayer(1)],
    chain: [],
  };
}

/* One advance's worth of presentation traffic. Eight is arbitrary but large
   enough that a per-message remap cannot pass for a per-state one. */
const PRESENTATION_BATCH_SIZE = 8;

function latestWorker(): MockedWorkerInstance {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  return worker;
}

function emitDuelState(state: PublicDuelState): void {
  const worker = latestWorker();
  for (const listener of worker.listeners)
    listener({ context: worker.context, event: { type: "state", state } });
}

/* Each presentation event arrives as its own Worker message, exactly as
   `duel.worker.ts` posts them, so each one gets its own flush here too. */
function emitPresentationEvent(
  eventSequence: number,
  event: DuelPresentationEvent,
): void {
  const worker = latestWorker();
  for (const listener of worker.listeners)
    listener({
      context: worker.context,
      event: { type: "event", eventSequence, event },
    });
}

async function renderReadyApp() {
  const rendered = render(App);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-cy="deck-picker"]')).not.toBeNull(),
  );
  return rendered;
}

async function startDuelFromPicker(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.selectOptions(
    document.querySelector(
      '[data-cy="deck-picker-player-select"]',
    ) as HTMLSelectElement,
    "preset:chapter-one-starter",
  );
  await user.click(
    document.querySelector(
      '[data-cy="deck-picker-start-button"]',
    ) as HTMLButtonElement,
  );
}

/* The card-text catalog lands asynchronously and is a real board input, so the
   count only answers for the advance once it has settled. */
async function settleStartup(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await tick();
  }
}

async function advanceWithPresentationEvents(
  state: PublicDuelState,
  firstEventSequence: number,
): Promise<void> {
  emitDuelState(state);
  await tick();
  for (let index = 0; index < PRESENTATION_BATCH_SIZE; index += 1) {
    emitPresentationEvent(firstEventSequence + index, {
      type: "phaseChanged",
      phase: "main1",
    });
    await tick();
  }
}

describe("App board mapping", () => {
  it("maps the board once per advance, not once per Worker message", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    await settleStartup();
    boardMapping.calls = 0;

    await advanceWithPresentationEvents(snapshotAtTurn(1), 1);

    expect(boardMapping.calls).toBe(1);
  });

  it("still remaps when the snapshot the board is built from changes", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    await settleStartup();
    await advanceWithPresentationEvents(snapshotAtTurn(1), 1);
    boardMapping.calls = 0;

    await advanceWithPresentationEvents(snapshotAtTurn(2), 100);

    expect(boardMapping.calls).toBe(1);
    expect(document.querySelector('[data-cy="duel-field"]')).not.toBeNull();
  });
});
