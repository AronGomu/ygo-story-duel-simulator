// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The duel's worker client is the only piece of the battle domain this test
   cannot run for real in jsdom, so it is replaced with the same hand-driven
   double `tests/component/BattleFacade.test.ts` uses: everything else —
   the shell, the coordinator, the story and the real deck picker — is the
   production code path. */
vi.hoisted(() => {
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
});

vi.mock("../../src/battle/app/DuelWorkerClient.ts", () => {
  class DuelWorkerClientMock {
    static instances: DuelWorkerClientMock[] = [];
    /** Every seat pairing the duel actually asked the Worker to start. The one
        place the deck the player fights with is observable end to end. */
    static starts: { player: unknown; opponent: unknown }[] = [];
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

    startDuel(_duelId: unknown, player: unknown, opponent: unknown) {
      DuelWorkerClientMock.starts.push({ player, opponent });
      this.context = { ...this.context, sessionGeneration: 1 };
      return this.context;
    }

    respond() {
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

import { DuelWorkerClient as MockedDuelWorkerClient } from "../../src/battle/app/DuelWorkerClient.ts";
import AppShell from "../../src/shell/AppShell.svelte";
import type { DomainLoaders } from "../../src/shell/domain-loaders.ts";
import {
  createShellStore,
  type ShellStore,
} from "../../src/shell/shell-store.ts";
import { createInitialStoryState } from "../../src/story/model/story-state.ts";
import { STORY_SAVES_DATABASE_NAME } from "../../src/story/saves/story-save-contracts.ts";
import type {
  StorySaveWriteResult,
  StorySlotKey,
} from "../../src/story/saves/story-save-contracts.ts";
import {
  createStorySaveRepository,
  type StorySaveRepository,
} from "../../src/story/saves/story-save-repository.ts";
import { installPrototypeActiveCatalog } from "../fixtures/active-catalog.ts";
import { fieldableStoryDeck } from "../fixtures/story-decks.ts";

/* The briefing revalidates the save's decks against the card database before
   it will start an encounter, and jsdom has no runtime assets to serve one
   from. The same fixture answers the duel's own deck picker downstream. */
installPrototypeActiveCatalog();

interface MockedWorkerInstance {
  readonly context: { workerGeneration: number; sessionGeneration: number };
  readonly listeners: Set<(received: unknown) => void>;
}

const mockedWorkerClientCtor = MockedDuelWorkerClient as unknown as {
  instances: MockedWorkerInstance[];
  starts: { player: unknown; opponent: unknown }[];
};

/** Set to make the duel's own request parser refuse whatever the shell built,
    which is the one way the two contracts can be made to disagree from here. */
let refuseBattleRequest = false;

const READY_CORE_GATE = {
  kind: "ready" as const,
  chapterIds: ["chapter-01" as const],
  generation: 1,
};

const loaders: DomainLoaders = {
  duel: async () => {
    const battle = await import("../../src/battle/index.ts");
    if (!refuseBattleRequest) return battle;
    return {
      ...battle,
      parseBattleRequest: () => {
        throw new battle.BattleRequestError(
          "player.deck.main holds more than 60 cards",
        );
      },
    };
  },
  decks: () => new Promise<never>(() => {}),
  story: async () => await import("../../src/story/index.ts"),
};

let hash = "#/story";
let saves: StorySaveRepository;
/** Set to fail the next checkpoint write, exactly as full storage would. */
let checkpointWriteFailure: StorySaveWriteResult | null = null;

function failableSaves(inner: StorySaveRepository): StorySaveRepository {
  return {
    read: (slot) => inner.read(slot),
    write: (slot, state, expectedRevision) => {
      const failure = checkpointWriteFailure;
      if (failure !== null && slot === "checkpoint:pre-duel") {
        checkpointWriteFailure = null;
        return Promise.resolve(failure);
      }
      return inner.write(slot, state, expectedRevision);
    },
    list: () => inner.list(),
    clear: (slot) => inner.clear(slot),
  };
}

let store: ShellStore;

function renderShell() {
  store = createShellStore(hash, (next) => {
    hash = next;
  });
  return render(AppShell, {
    store,
    loaders,
    saves,
    initialCoreGate: READY_CORE_GATE,
  });
}

function region(name: string): Element | null {
  return document.querySelector(`[data-cy="shell-region-${name}"]`);
}

function cy(value: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-cy="${value}"]`);
  if (element === null) throw new Error(`No element for data-cy="${value}"`);
  return element;
}

async function waitForCy(value: string): Promise<HTMLElement> {
  await vi.waitFor(
    () =>
      expect(
        document.querySelector(`[data-cy="${value}"]`),
        `waiting for data-cy="${value}"`,
      ).not.toBeNull(),
    { timeout: 5_000 },
  );
  return cy(value);
}

function emitResult(result: unknown): void {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  for (const listener of worker.listeners)
    listener({ context: worker.context, event: { type: "result", result } });
}

/** Puts the player on the city map with one save on disk, so the flow under
    test starts at the encounter rather than 30 narrative beats earlier.

    The save carries a deck and the cards behind it, as every real save that
    reaches the map does: a new game is granted both, and the briefing refuses
    to hand a duel a deck this save cannot field. */
async function seedMapProgress(): Promise<void> {
  const { deck, collection } = fieldableStoryDeck();
  await saves.write(
    "autosave" as StorySlotKey,
    {
      ...createInitialStoryState(),
      screen: "map",
      savedScreen: "map",
      progressExists: true,
      decks: [deck],
      defaultDeckId: deck.id,
      collection,
    },
    null,
  );
}

async function reachEncounter(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderShell();
  store.enterStory("continue");
  await waitForCy("story-map-screen");
  await user.click(await waitForCy("story-map-hotspot-old-arena"));
  /* The catalog read the briefing gates on resolves a microtask later than the
     screen renders, so Start is briefly disabled on purpose. */
  await vi.waitFor(() =>
    expect(cy("deck-select-start").hasAttribute("disabled")).toBe(false),
  );
  await user.click(cy("deck-select-start"));
  return user;
}

async function deleteStorySaves(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(STORY_SAVES_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  hash = "#/story";
  checkpointWriteFailure = null;
  refuseBattleRequest = false;
  mockedWorkerClientCtor.starts.length = 0;
  await deleteStorySaves();
  saves = failableSaves(createStorySaveRepository(globalThis.indexedDB));
  await seedMapProgress();
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  mockedWorkerClientCtor.instances.length = 0;
  mockedWorkerClientCtor.starts.length = 0;
  await deleteStorySaves();
});

/** The seats the Worker was actually asked to duel with, once it has been. */
async function startedSeats(): Promise<{
  player: unknown;
  opponent: unknown;
}> {
  await vi.waitFor(() =>
    expect(mockedWorkerClientCtor.starts.length).toBeGreaterThan(0),
  );
  return mockedWorkerClientCtor.starts[
    mockedWorkerClientCtor.starts.length - 1
  ]!;
}

describe("story duel handoff", () => {
  it("starts a real duel on the chosen deck and routes to the session", async () => {
    await reachEncounter();

    await waitForCy("battle-root");
    expect(region("duel")).not.toBeNull();
    expect(region("story")).toBeNull();
    expect(hash).toMatch(/^#\/duel\/session\/[\w-]+$/);
    /* The player already chose at the briefing. A picker here would ask again
       and, worse, fix the opponent to a deck the encounter did not stage. */
    expect(document.querySelector('[data-cy="deck-picker"]')).toBeNull();
  });

  /* The payoff of the whole chain, read off the only place it is real: what
     the duel asked the Worker to shuffle. A duel that merely started proves
     nothing about which deck is in the player's hand. */
  it("seats the save's own cards as the player and the encounter's preset as the opponent", async () => {
    await reachEncounter();

    const { player, opponent } = await startedSeats();

    expect(player).toEqual({
      kind: "cards",
      main: fieldableStoryDeck().deck.main,
      extra: [],
      side: [],
    });
    expect(opponent).toEqual({ kind: "preset", deckId: expect.any(String) });
  });

  /* A reload lands on the session with nothing in memory. The checkpoint holds
     the whole save, so the deck the encounter chose has to come back with it —
     otherwise crash recovery quietly demotes the player to a bundled preset. */
  it("rebuilds the chosen deck from the checkpoint on a cold start into the session", async () => {
    const handoffId = "77777777-2222-4333-8444-555555555555";
    const { deck, collection } = fieldableStoryDeck();
    await saves.write(
      "checkpoint:pre-duel",
      {
        ...createInitialStoryState(),
        screen: "battle-mock",
        savedScreen: "map",
        progressExists: true,
        encounterId: "old-arena",
        pendingHandoffId: handoffId,
        decks: [deck],
        defaultDeckId: deck.id,
        collection,
      },
      null,
    );
    hash = `#/duel/session/${handoffId}`;
    renderShell();

    await waitForCy("battle-root");
    const { player } = await startedSeats();

    expect(player).toMatchObject({ kind: "cards", main: deck.main });
    expect(document.querySelector('[data-cy="deck-picker"]')).toBeNull();
  });

  /* The briefing accepted the deck and the duel's own parser refused it, which
     can only mean the two contracts drifted apart. The story says so and keeps
     the player where they can change the deck; no duel is mounted, and nothing
     is checkpointed for one. */
  it("fails the encounter instead of mounting a duel the request cannot start", async () => {
    refuseBattleRequest = true;
    await reachEncounter();

    const error = await waitForCy("story-handoff-error");
    expect(error.textContent).toMatch(/cannot be played/i);
    expect(region("duel")).toBeNull();
    expect(hash).toBe("#/story");
    expect(mockedWorkerClientCtor.starts).toEqual([]);
    expect((await saves.read("checkpoint:pre-duel")).kind).toBe("empty");
  });

  it("returns a surrendered duel to the story's abort branch", async () => {
    await reachEncounter();
    await waitForCy("battle-root");

    emitResult({ type: "surrendered", player: 0 });

    await waitForCy("story-outcome-abort-heading");
    expect(hash).toBe("#/story");
    expect(
      document.querySelector('[data-cy="story-outcome-win-heading"]'),
    ).toBeNull();
  });

  it("takes a completed win to the win branch and its reward", async () => {
    const user = await reachEncounter();
    await waitForCy("battle-root");

    emitResult({ type: "completed", winner: 0, loser: 1, reason: 1 });

    await waitForCy("story-outcome-win-heading");
    await user.click(cy("story-outcome-win-continue"));
    await waitForCy("story-reward-screen");
  });

  /* The property, end to end: a duel the engine could not finish must reach
     the technical-failure scene, not the authored defeat. */
  it("takes an engine failure to the technical-failure branch, never to a loss", async () => {
    await reachEncounter();
    await waitForCy("battle-root");

    emitResult({ type: "engineError", detail: "core stopped" });

    await waitForCy("story-outcome-error-heading");
    expect(
      document.querySelector('[data-cy="story-outcome-loss-heading"]'),
    ).toBeNull();
  });

  it("ignores a duplicate result instead of advancing the story twice", async () => {
    await reachEncounter();
    await waitForCy("battle-root");

    emitResult({ type: "completed", winner: 0, loser: 1, reason: 1 });
    emitResult({ type: "completed", winner: 1, loser: 0, reason: 1 });
    emitResult({ type: "surrendered", player: 0 });

    await waitForCy("story-outcome-win-heading");
    expect(
      document.querySelector('[data-cy="story-outcome-loss-heading"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="story-outcome-abort-heading"]'),
    ).toBeNull();
  });

  /* The crash-safety property, without a browser: a session route reached
     with nothing in memory has to come back as the same encounter, read out
     of the checkpoint. `e2e/story-duel.spec.ts` does the real reload. */
  it("restarts the encounter from the checkpoint on a cold start into the session", async () => {
    const handoffId = "66666666-2222-4333-8444-555555555555";
    await saves.write(
      "checkpoint:pre-duel",
      {
        ...createInitialStoryState(),
        screen: "battle-mock",
        savedScreen: "map",
        progressExists: true,
        encounterId: "old-arena",
        pendingHandoffId: handoffId,
      },
      null,
    );
    hash = `#/duel/session/${handoffId}`;
    renderShell();

    await waitForCy("battle-root");
    expect(hash).toBe(`#/duel/session/${handoffId}`);

    emitResult({ type: "surrendered", player: 0 });

    await waitForCy("story-outcome-abort-heading");
    expect(hash).toBe("#/story");
  });

  /* Leaving a story duel still owes the story a result, or the checkpoint
     would outlive the duel it was written for. */
  it("settles a story duel that is torn down before it finishes as an abort", async () => {
    await reachEncounter();
    await waitForCy("battle-root");

    cleanup();

    expect(hash).toBe("#/story");
    await vi.waitFor(async () =>
      expect((await saves.read("checkpoint:pre-duel")).kind).toBe("empty"),
    );
  });

  /* The same debt, owed on the route the player actually leaves by: browser
     Back changes the route first and tears the duel region down afterwards,
     so the result the facade owes the story has to survive that ordering. */
  it("settles a story duel left by a route change as an abort", async () => {
    await reachEncounter();
    await waitForCy("battle-root");

    store.syncFromHash("#/story");

    await waitForCy("story-outcome-abort-heading");
    expect(hash).toBe("#/story");
    await vi.waitFor(async () =>
      expect((await saves.read("checkpoint:pre-duel")).kind).toBe("empty"),
    );
  });

  it("shows a retry instead of a duel when the checkpoint cannot be written", async () => {
    checkpointWriteFailure = { kind: "failed", reason: "quota" };
    const user = await reachEncounter();

    await waitForCy("story-handoff-error");
    expect(region("duel")).toBeNull();
    expect(hash).toBe("#/story");

    await user.click(cy("story-handoff-retry"));

    await waitForCy("battle-root");
    expect(
      document.querySelector('[data-cy="story-handoff-error"]'),
    ).toBeNull();
  });

  it("sends a session route with no matching checkpoint back to the story", async () => {
    hash = "#/duel/session/44444444-2222-4333-8444-555555555555";
    renderShell();

    await waitForCy("story-app");
    expect(hash).toBe("#/story");
    expect(region("duel")).toBeNull();
  });
});
