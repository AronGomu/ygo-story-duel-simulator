import { describe, expect, it } from "vitest";
import type { DuelWorkerEvent } from "../../src/battle/duel/contracts/duel-worker-event.ts";
import {
  cardInstanceId,
  choiceId,
  promptId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";
import type { DuelDeckSelection } from "../../src/battle/duel/contracts/duel-deck-selection.ts";
import type { DeckId } from "../../src/battle/duel/presets/deck-catalog.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import type {
  DuelClient,
  DuelClientContext,
  DuelClientEvent,
} from "../../src/battle/app/DuelWorkerClient.ts";
import {
  createDuelStore,
  createInitialDuelViewState,
  reduceDuelViewState,
} from "../../src/battle/app/stores/duel-store.ts";
import { deckSlots } from "../fixtures/board-public-states.ts";

/** One seat named as a bundled preset, which is what every scenario below
    starts with; a deck the player built has its own coverage in
    `tests/unit/battle/selectable-decks.test.ts`. */
function preset(id: DeckId): DuelDeckSelection {
  return { kind: "preset", deckId: id };
}

const CONTEXT: DuelClientContext = {
  workerGeneration: 2,
  sessionGeneration: 4,
};

const STATE: PublicDuelState = {
  snapshotId: snapshotId("a".repeat(64)),
  revision: 1,
  turn: 1,
  turnPlayer: 0,
  phase: "main1",
  layout: { extraMonsterZones: true },
  players: [
    {
      player: 0,
      lifePoints: 8000,
      deckCount: 35,
      deck: deckSlots(0, 35),
      extraDeckCount: 0,
      handCount: 5,
      hand: [
        {
          instanceId: cardInstanceId("human-card"),
          owner: 0,
          controller: 0,
          location: "hand",
          sequence: 0,
          position: "faceDownDefense",
          faceUp: false,
          counters: [],
          overlayMaterials: [],
        },
      ],
      extraDeck: [],
      monsters: [],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
    {
      player: 1,
      lifePoints: 8000,
      deckCount: 35,
      deck: deckSlots(1, 35),
      extraDeckCount: 0,
      handCount: 5,
      hand: [],
      extraDeck: [],
      monsters: [],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
  ],
  chain: [],
};

const PROMPT_EVENT: DuelWorkerEvent = {
  type: "prompt",
  prompt: {
    id: promptId("prompt-current"),
    kind: "selectCard",
    player: 0,
    title: "Select a card",
    choices: [
      { id: choiceId("choice-current"), label: "Card", action: "select" },
    ],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  },
};

/* Drag and drop arms a placement guess on an idle command and expects the
   engine's own `selectPlace` prompt to arrive next. */
const IDLE_PROMPT_EVENT: Extract<DuelWorkerEvent, { type: "prompt" }> = {
  type: "prompt",
  prompt: {
    id: promptId("prompt-idle"),
    kind: "idleCommand",
    player: 0,
    title: "Choose a Main Phase action",
    choices: [
      {
        id: choiceId("idle-summon"),
        label: "Summon Card 1",
        action: "summon",
      },
    ],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  },
};

function placePromptEvent(
  id: string,
): Extract<DuelWorkerEvent, { type: "prompt" }> {
  return {
    type: "prompt",
    prompt: {
      id: promptId(id),
      kind: "selectPlace",
      player: 0,
      title: "Choose a zone",
      choices: [0, 1, 2].map((sequence) => ({
        id: choiceId(`place-mainMonster-${sequence}`),
        label: `Your monster ${sequence + 1}`,
        action: "select" as const,
        place: { player: 0 as const, location: "monster" as const, sequence },
      })),
      minimum: 1,
      maximum: 1,
      cancelable: false,
      ordered: false,
    },
  };
}

function apply(
  state: ReturnType<typeof createInitialDuelViewState>,
  event: DuelWorkerEvent,
  context: DuelClientContext = CONTEXT,
): ReturnType<typeof createInitialDuelViewState> {
  return reduceDuelViewState(state, { context, event });
}

class FakeDuelClient implements DuelClient {
  context: DuelClientContext = { workerGeneration: 1, sessionGeneration: 0 };
  readonly #listeners = new Set<(event: DuelClientEvent) => void>();
  replaceFailure: Error | null = null;
  initializeResult = true;
  respondResult = true;
  restoreResult = true;
  restoreCalls = 0;
  readonly respondCalls: Array<{
    readonly promptId: string;
    readonly choiceIds: readonly string[];
  }> = [];
  readonly startCalls: Parameters<DuelClient["startDuel"]>[] = [];

  subscribe(listener: (event: DuelClientEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: DuelWorkerEvent): void {
    for (const listener of this.#listeners)
      listener({ context: this.context, event });
  }

  initialize(): boolean {
    return this.initializeResult;
  }

  startDuel(...args: Parameters<DuelClient["startDuel"]>): DuelClientContext {
    this.startCalls.push(args);
    this.context = {
      ...this.context,
      sessionGeneration: this.context.sessionGeneration + 1,
    };
    return this.context;
  }

  respond(
    prompt: Parameters<DuelClient["respond"]>[0],
    choiceIds: Parameters<DuelClient["respond"]>[1],
  ): boolean {
    this.respondCalls.push({ promptId: prompt, choiceIds: [...choiceIds] });
    return this.respondResult;
  }

  surrender(): boolean {
    return true;
  }

  requestDiagnostics(): boolean {
    return true;
  }

  restore(): boolean {
    this.restoreCalls += 1;
    return this.restoreResult;
  }

  async replace(): Promise<{ readonly graceful: boolean }> {
    if (this.replaceFailure !== null) throw this.replaceFailure;
    this.context = {
      workerGeneration: this.context.workerGeneration + 1,
      sessionGeneration: 0,
    };
    return { graceful: true };
  }

  async dispose(): Promise<{ readonly graceful: boolean }> {
    return { graceful: true };
  }
}

describe("duel view-state reducer", () => {
  it("start forwards pair identity and both deck ids to the client", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);

    expect(
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      ),
    ).toBe(true);
    expect(client.startCalls).toEqual([
      [
        "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
        { kind: "preset", deckId: "chapter-one-starter" },
        { kind: "preset", deckId: "chapter-one-practice" },
      ],
    ]);
  });

  it("restart replays the last started pair after replacement readiness", async () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    expect(
      store.start(
        preset("chapter-one-practice"),
        preset("chapter-one-starter"),
      ),
    ).toBe(true);
    expect(client.startCalls).toEqual([
      [
        "bundled-v1:chapter-one-practice:vs:chapter-one-starter",
        { kind: "preset", deckId: "chapter-one-practice" },
        { kind: "preset", deckId: "chapter-one-starter" },
      ],
    ]);

    await expect(store.restart()).resolves.toBe(true);
    expect(client.startCalls).toHaveLength(1);

    client.emit({ type: "ready", coreVersion: [11, 0] });
    expect(client.startCalls).toEqual([
      [
        "bundled-v1:chapter-one-practice:vs:chapter-one-starter",
        { kind: "preset", deckId: "chapter-one-practice" },
        { kind: "preset", deckId: "chapter-one-starter" },
      ],
      [
        "bundled-v1:chapter-one-practice:vs:chapter-one-starter",
        { kind: "preset", deckId: "chapter-one-practice" },
        { kind: "preset", deckId: "chapter-one-starter" },
      ],
    ]);
  });

  it("reset replaces the worker without starting", async () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    expect(
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      ),
    ).toBe(true);

    await expect(store.reset()).resolves.toBe(true);
    client.emit({ type: "ready", coreVersion: [11, 0] });

    expect(current).toMatchObject({ status: "idle", coreVersion: [11, 0] });
    expect(client.startCalls).toHaveLength(1);
    unsubscribe();
  });

  it("projects ordered Worker events into loading, active, input, and result states", () => {
    let view = createInitialDuelViewState(CONTEXT);
    view = apply(view, { type: "loading", stage: "engine", progress: 0.5 });
    expect(view).toMatchObject({
      status: "loading",
      loading: { stage: "engine", progress: 0.5 },
    });

    view = apply(view, { type: "ready", coreVersion: [11, 0] });
    expect(view).toMatchObject({ status: "idle", coreVersion: [11, 0] });

    view = apply(view, { type: "state", state: STATE });
    expect(view).toMatchObject({ status: "active", snapshot: STATE });

    view = apply(view, PROMPT_EVENT);
    expect(view).toMatchObject({
      status: "awaiting-input",
      prompt: PROMPT_EVENT.prompt,
      responsePending: false,
    });

    view = apply(view, {
      type: "result",
      result: { type: "completed", winner: 0, loser: 1, reason: 1 },
    });
    expect(view).toMatchObject({
      status: "completed",
      prompt: null,
      result: { type: "completed", winner: 0 },
    });
  });

  it("keeps the submitted prompt disabled across the intermediate state event", () => {
    let view = apply(createInitialDuelViewState(CONTEXT), PROMPT_EVENT);
    view = { ...view, status: "active", responsePending: true };
    view = apply(view, { type: "state", state: STATE });
    expect(view).toMatchObject({
      status: "active",
      prompt: PROMPT_EVENT.prompt,
      responsePending: true,
    });
  });

  it("ignores stale Worker/session generations", () => {
    const initial = createInitialDuelViewState(CONTEXT);
    const stale = apply(initial, PROMPT_EVENT, {
      workerGeneration: 1,
      sessionGeneration: 99,
    });
    expect(stale).toBe(initial);
  });

  it("clears prompt, result, error, snapshot, and transient log for a new session", () => {
    let view = createInitialDuelViewState(CONTEXT);
    view = apply(view, { type: "state", state: STATE });
    view = apply(view, PROMPT_EVENT);
    view = apply(view, {
      type: "event",
      eventSequence: 1,
      event: { type: "phaseChanged", phase: "main1" },
    });
    view = apply(view, {
      type: "error",
      error: {
        code: "invalid_response",
        message: "Old recoverable error",
        recoverable: true,
      },
    });

    const next = createInitialDuelViewState({
      workerGeneration: 2,
      sessionGeneration: 5,
    });
    expect(next).toMatchObject({
      status: "idle",
      snapshot: null,
      prompt: null,
      result: null,
      error: null,
      presentationEvents: [],
      duelLog: [],
      lastAcceptedEventSequence: 0,
      nextPresentationSequence: 1,
      nextLogSequence: 1,
    });
    expect(next.context).not.toEqual(view.context);
  });

  it("offers recovery only for a failure the Worker can still rebuild", () => {
    const failure = {
      code: "engine_error",
      message: "ocgcore rejected the previous response",
      recoverable: false,
    } as const;
    let view = apply(createInitialDuelViewState(CONTEXT), PROMPT_EVENT);

    const unrecoverable = apply(view, { type: "error", error: failure });
    expect(unrecoverable).toMatchObject({
      status: "failed",
      canRestore: false,
      restoreFailure: null,
    });

    view = apply(view, { type: "error", error: failure, canRestore: true });
    expect(view).toMatchObject({
      status: "failed",
      error: failure,
      canRestore: true,
    });

    /* A replay that fails changes nothing the player is looking at except the
       offer that just proved impossible. */
    view = apply(view, { type: "restore_failed", reason: "replay_failed" });
    expect(view).toMatchObject({
      status: "failed",
      error: failure,
      canRestore: false,
      restoreFailure: "replay_failed",
    });

    view = apply(view, { type: "restored" });
    expect(view).toMatchObject({
      status: "active",
      error: null,
      canRestore: false,
      restoreFailure: null,
      responsePending: false,
    });

    /* A recoverable rejection is answered again at the same prompt, so it
       never offers to rebuild the duel around it. */
    const recoverable = apply(apply(view, PROMPT_EVENT), {
      type: "error",
      error: {
        code: "invalid_response",
        message: "Select exactly one choice",
        recoverable: true,
      },
      canRestore: true,
    });
    expect(recoverable).toMatchObject({
      status: "awaiting-input",
      canRestore: false,
    });
  });

  it("forwards a restore request to the client", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);

    expect(store.restore()).toBe(true);
    client.restoreResult = false;
    expect(store.restore()).toBe(false);
    expect(client.restoreCalls).toBe(2);
  });

  it("keeps 100 transient events while retaining approved semantic rows", () => {
    let view = createInitialDuelViewState(CONTEXT);
    for (let index = 1; index <= 101; index += 1) {
      view = apply(view, {
        type: "event",
        eventSequence: index,
        event: { type: "phaseChanged", phase: "main1" },
      });
    }
    expect(view.presentationEvents).toHaveLength(100);
    expect(view.presentationEvents[0]?.sequence).toBe(2);
    expect(view.presentationEvents.at(-1)?.sequence).toBe(101);
    expect(view.duelLog).toHaveLength(101);
    expect(view.duelLog[0]).toMatchObject({
      kind: "activity",
      logSequence: 1,
      sourceType: "phaseChanged",
    });
    expect(view.duelLog.at(-1)).toMatchObject({ logSequence: 101 });
  });

  it("keeps hints transient instead of retaining arbitrary text", () => {
    let view = createInitialDuelViewState(CONTEXT);
    for (let index = 1; index <= 125; index += 1) {
      view = apply(view, {
        type: "event",
        eventSequence: index,
        event: { type: "hint", message: `Event ${index}` },
      });
    }
    expect(view.presentationEvents).toHaveLength(100);
    expect(view.presentationEvents[0]).toEqual({
      sequence: 26,
      event: { type: "hint", message: "Event 26" },
    });
    expect(view.presentationEvents.at(-1)?.sequence).toBe(125);
    expect(view.duelLog).toEqual([]);
    expect(view.nextLogSequence).toBe(1);
  });

  it("deduplicates deliveries by event sequence without deduplicating equal payloads", () => {
    const initial = createInitialDuelViewState(CONTEXT);
    const firstEvent: DuelWorkerEvent = {
      type: "event",
      eventSequence: 1,
      event: { type: "cardDrawn", player: 0, count: 1 },
    };
    const first = apply(initial, firstEvent);
    expect(first.duelLog[0]).toEqual({
      kind: "activity",
      logSequence: 1,
      sourceType: "cardDrawn",
      text: "You drew 1 card.",
    });
    expect(first.duelLog[0]).not.toHaveProperty("event");
    expect(first.duelLog[0]).not.toHaveProperty("eventSequence");
    const replay = apply(first, structuredClone(firstEvent));
    expect(replay).toBe(first);

    const second = apply(first, { ...firstEvent, eventSequence: 2 });
    expect(second.presentationEvents).toHaveLength(2);
    expect(second.duelLog).toHaveLength(2);
    expect(second).toMatchObject({
      lastAcceptedEventSequence: 2,
      nextPresentationSequence: 3,
      nextLogSequence: 3,
    });

    const duplicateState = apply(
      apply(second, { type: "state", state: STATE }),
      {
        type: "state",
        state: STATE,
      },
    );
    expect(duplicateState.duelLog).toBe(second.duelLog);
    expect(duplicateState.nextLogSequence).toBe(3);
  });

  it("caps the durable log at 2,000 total rows with one stable marker", () => {
    let view = createInitialDuelViewState(CONTEXT);
    const checkpoints = new Map<number, typeof view>();
    for (let index = 1; index <= 4_000; index += 1) {
      view = apply(view, {
        type: "event",
        eventSequence: index,
        event: { type: "phaseChanged", phase: "main1" },
      });
      if ([2_000, 2_001, 2_002, 4_000].includes(index))
        checkpoints.set(index, view);
    }

    expect(checkpoints.get(2_000)?.duelLog).toHaveLength(2_000);
    expect(checkpoints.get(2_000)?.duelLog[0]).toMatchObject({
      kind: "activity",
      logSequence: 1,
    });
    expect(checkpoints.get(2_001)?.duelLog).toHaveLength(2_000);
    expect(checkpoints.get(2_001)?.duelLog[0]).toEqual({
      kind: "truncated",
      logSequence: 0,
      omittedCount: 2,
      text: "2 earlier duel events omitted.",
    });
    expect(checkpoints.get(2_001)?.duelLog[1]).toMatchObject({
      logSequence: 3,
    });
    expect(checkpoints.get(2_002)?.duelLog[0]).toMatchObject({
      kind: "truncated",
      omittedCount: 3,
    });
    expect(checkpoints.get(2_002)?.duelLog[1]).toMatchObject({
      logSequence: 4,
    });
    expect(checkpoints.get(4_000)?.duelLog[0]).toMatchObject({
      kind: "truncated",
      omittedCount: 2_001,
    });
    expect(checkpoints.get(4_000)?.duelLog[1]).toMatchObject({
      logSequence: 2_002,
    });
    expect(checkpoints.get(4_000)?.duelLog.at(-1)).toMatchObject({
      logSequence: 4_000,
    });
    expect(
      new Set(
        checkpoints.get(4_000)?.duelLog.map(({ logSequence }) => logSequence),
      ).size,
    ).toBe(2_000);
    expect(Object.isFrozen(checkpoints.get(4_000)?.duelLog)).toBe(true);
    expect(checkpoints.get(4_000)?.duelLog.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(checkpoints.get(4_000)?.duelLog)).not.toContain(
      "eventSequence",
    );
    expect(JSON.stringify(checkpoints.get(4_000)?.duelLog)).not.toContain(
      "instanceId",
    );
  });

  it("keeps replay and stale contexts from changing queue or allocator state", () => {
    const view = apply(createInitialDuelViewState(CONTEXT), {
      type: "event",
      eventSequence: 5,
      event: { type: "duelStarted" },
    });
    const replay = apply(view, {
      type: "event",
      eventSequence: 4,
      event: { type: "turnStarted", player: 0, turn: 1 },
    });
    expect(replay).toBe(view);
    const stale = apply(
      view,
      {
        type: "event",
        eventSequence: 6,
        event: { type: "turnStarted", player: 0, turn: 1 },
      },
      { workerGeneration: 9, sessionGeneration: 9 },
    );
    expect(stale).toBe(view);
  });

  it("resets both queues and sequence state on start and replacement paths", async () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    client.emit({
      type: "event",
      eventSequence: 1,
      event: { type: "duelStarted" },
    });
    expect(current.duelLog).toHaveLength(1);

    expect(
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      ),
    ).toBe(true);
    expect(current).toMatchObject({
      presentationEvents: [],
      duelLog: [],
      lastAcceptedEventSequence: 0,
      nextPresentationSequence: 1,
      nextLogSequence: 1,
    });
    client.emit({
      type: "event",
      eventSequence: 1,
      event: { type: "duelStarted" },
    });
    expect(current.duelLog).toHaveLength(1);

    await expect(store.restart()).resolves.toBe(true);
    expect(current).toMatchObject({
      status: "initializing",
      presentationEvents: [],
      duelLog: [],
      lastAcceptedEventSequence: 0,
      nextPresentationSequence: 1,
      nextLogSequence: 1,
    });
    unsubscribe();
    await store.destroy();

    const failingClient = new FakeDuelClient();
    const failingStore = createDuelStore(failingClient);
    let failed = createInitialDuelViewState(failingClient.context);
    const unsubscribeFailing = failingStore.subscribe((state) => {
      failed = state;
    });
    failingClient.emit({
      type: "event",
      eventSequence: 1,
      event: { type: "duelStarted" },
    });
    failingClient.replaceFailure = new Error("replacement failed");
    await expect(failingStore.retry()).resolves.toBe(false);
    expect(failed).toMatchObject({
      status: "failed",
      presentationEvents: [],
      duelLog: [],
      lastAcceptedEventSequence: 0,
      nextPresentationSequence: 1,
      nextLogSequence: 1,
    });
    unsubscribeFailing();
    await failingStore.destroy();
  });

  it.each(["invalid_response", "stale_prompt"] as const)(
    "keeps recoverable %s errors actionable and makes terminal errors fail",
    (code) => {
      let view = apply(createInitialDuelViewState(CONTEXT), PROMPT_EVENT);
      view = {
        ...view,
        responsePending: true,
        responsePendingKey: view.interactionSession.key,
        interactionSession: {
          ...view.interactionSession,
          status: "submitting",
          selectedChoiceIds: [choiceId("choice-current")],
        },
      };
      view = apply(view, {
        type: "error",
        error: {
          code,
          message: "Choose again",
          recoverable: true,
        },
      });
      expect(view).toMatchObject({
        status: "awaiting-input",
        prompt: PROMPT_EVENT.prompt,
        responsePending: false,
        responsePendingKey: null,
        error: { recoverable: true },
        interactionSession: {
          status: "editing",
          selectedChoiceIds: [choiceId("choice-current")],
        },
      });

      view = apply(view, {
        type: "error",
        error: {
          code: "engine_error",
          message: "Core failed",
          recoverable: false,
        },
      });
      expect(view).toMatchObject({
        status: "failed",
        prompt: null,
        error: { recoverable: false },
        interactionSession: { key: null, status: "idle" },
      });
    },
  );

  it("accepts one submit across interaction and prompt-control paths", async () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    expect(
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      ),
    ).toBe(true);
    client.emit(PROMPT_EVENT);
    const key = current.interactionSession.key;
    if (key === null) throw new Error("Expected active interaction key");

    expect(
      store.dispatchInteraction({
        type: "toggleChoice",
        key,
        choiceId: choiceId("choice-current"),
      }),
    ).toBe(true);
    expect(store.dispatchInteraction({ type: "confirm", key })).toBe(true);
    expect(store.respond([choiceId("choice-current")])).toBe(false);
    expect(client.respondCalls).toEqual([
      {
        promptId: "prompt-current",
        choiceIds: ["choice-current"],
      },
    ]);
    expect(current).toMatchObject({
      responsePending: true,
      responsePendingKey: key,
      interactionSession: { status: "submitting" },
    });

    client.emit({ type: "state", state: STATE });
    client.emit({
      type: "event",
      eventSequence: 1,
      event: { type: "phaseChanged", phase: "main1" },
    });
    client.emit(PROMPT_EVENT);
    expect(current).toMatchObject({
      responsePending: true,
      responsePendingKey: key,
      prompt: PROMPT_EVENT.prompt,
      interactionSession: { status: "submitting" },
    });
    unsubscribe();
    await store.destroy();
  });

  it("marks local submitting only after client acceptance and resets on new key/result/replacement", async () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    store.start(preset("chapter-one-starter"), preset("chapter-one-practice"));
    client.emit(PROMPT_EVENT);
    const firstKey = current.interactionSession.key;
    if (firstKey === null) throw new Error("Expected active interaction key");

    client.respondResult = false;
    expect(store.respond([choiceId("choice-current")])).toBe(false);
    expect(current.interactionSession.status).toBe("editing");
    expect(current.responsePending).toBe(false);
    expect(store.respond([])).toBe(false);
    expect(client.respondCalls).toHaveLength(1);

    client.respondResult = true;
    expect(store.respond([choiceId("choice-current")])).toBe(true);
    expect(current).toMatchObject({
      responsePending: true,
      responsePendingKey: firstKey,
      interactionSession: { status: "submitting" },
    });

    const nextPrompt: DuelWorkerEvent = {
      ...PROMPT_EVENT,
      prompt: { ...PROMPT_EVENT.prompt, id: promptId("prompt-next") },
    };
    client.emit(nextPrompt);
    expect(current.interactionSession).toMatchObject({
      key: { promptId: "prompt-next" },
      status: "editing",
      selectedChoiceIds: [],
      menuTarget: null,
    });
    expect(
      store.dispatchInteraction({
        type: "toggleChoice",
        key: firstKey,
        choiceId: choiceId("choice-current"),
      }),
    ).toBe(false);
    expect(client.respondCalls).toHaveLength(2);

    client.emit({
      type: "result",
      result: { type: "completed", winner: 0, loser: 1, reason: 1 },
    });
    expect(current.interactionSession).toMatchObject({
      key: null,
      status: "idle",
    });

    await expect(store.restart()).resolves.toBe(true);
    expect(current).toMatchObject({
      responsePending: false,
      responsePendingKey: null,
      interactionSession: { key: null, status: "idle" },
    });
    unsubscribe();
    await store.destroy();
  });

  it("refuses a placement intent without an active prompt", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    const before = current;

    expect(current.prompt).toBeNull();
    expect(store.armPlacementIntent("p0:mainMonster:0")).toBe(false);
    expect(current).toBe(before);
    expect(current.pendingPlacement).toBeNull();
    unsubscribe();
  });

  it("records the armed zone against the prompt that armed it", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    store.start(preset("chapter-one-starter"), preset("chapter-one-practice"));
    client.emit({ type: "state", state: STATE });
    client.emit(IDLE_PROMPT_EVENT);

    expect(store.armPlacementIntent("p0:mainMonster:3")).toBe(true);
    expect(current.pendingPlacement).toEqual({
      zoneId: "p0:mainMonster:3",
      armedAtPromptId: "prompt-idle",
    });
    unsubscribe();
  });

  it("auto-answers the follow-up place prompt that matches the armed zone", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    store.start(preset("chapter-one-starter"), preset("chapter-one-practice"));
    client.emit({ type: "state", state: STATE });
    client.emit(IDLE_PROMPT_EVENT);
    expect(store.armPlacementIntent("p0:mainMonster:1")).toBe(true);
    expect(store.respond([choiceId("idle-summon")])).toBe(true);

    // The state traffic between the chosen action and the engine's place
    // prompt must not consume the intent.
    client.emit({ type: "state", state: STATE });
    expect(current.pendingPlacement).not.toBeNull();

    client.emit(placePromptEvent("prompt-place"));

    expect(client.respondCalls).toEqual([
      { promptId: "prompt-idle", choiceIds: ["idle-summon"] },
      { promptId: "prompt-place", choiceIds: ["place-mainMonster-1"] },
    ]);
    expect(current.pendingPlacement).toBeNull();
    unsubscribe();
  });

  it("leaves a place prompt the guess missed to the player and costs nothing", () => {
    const client = new FakeDuelClient();
    const store = createDuelStore(client);
    let current = createInitialDuelViewState(client.context);
    const unsubscribe = store.subscribe((state) => {
      current = state;
    });
    store.start(preset("chapter-one-starter"), preset("chapter-one-practice"));
    client.emit({ type: "state", state: STATE });
    client.emit(IDLE_PROMPT_EVENT);
    expect(store.armPlacementIntent("p0:mainMonster:4")).toBe(true);
    expect(store.respond([choiceId("idle-summon")])).toBe(true);

    const placeEvent = placePromptEvent("prompt-place");
    client.emit(placeEvent);

    expect(client.respondCalls).toEqual([
      { promptId: "prompt-idle", choiceIds: ["idle-summon"] },
    ]);
    expect(current).toMatchObject({
      status: "awaiting-input",
      prompt: placeEvent.prompt,
      responsePending: false,
      pendingPlacement: null,
    });
    unsubscribe();
  });

  it("never lets a placement intent leak past a prompt, result or error", () => {
    for (const clearing of [
      { type: "result", result: { type: "surrendered", winner: 1, loser: 0 } },
      {
        type: "error",
        error: { code: "worker_error", message: "boom", recoverable: false },
      },
      { type: "prompt", prompt: IDLE_PROMPT_EVENT.prompt },
    ] as const satisfies readonly DuelWorkerEvent[]) {
      const client = new FakeDuelClient();
      const store = createDuelStore(client);
      let current = createInitialDuelViewState(client.context);
      const unsubscribe = store.subscribe((state) => {
        current = state;
      });
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      );
      client.emit({ type: "state", state: STATE });
      client.emit(IDLE_PROMPT_EVENT);
      expect(store.armPlacementIntent("p0:mainMonster:0")).toBe(true);
      expect(current.pendingPlacement).not.toBeNull();

      client.emit(clearing);

      expect(
        current.pendingPlacement,
        `cleared by ${clearing.type}`,
      ).toBeNull();
      unsubscribe();
    }
  });

  /* The two error states the store synthesises for itself never reach the
     reducer, so they have to honour the same invariant by hand: no `error`
     event follows them and nothing else would clear the guess. */
  it("clears a placement intent the store rejects locally", () => {
    for (const rejection of ["invalid_response", "stale_prompt"] as const) {
      const client = new FakeDuelClient();
      client.respondResult = rejection !== "stale_prompt";
      const store = createDuelStore(client);
      let current = createInitialDuelViewState(client.context);
      const unsubscribe = store.subscribe((state) => {
        current = state;
      });
      store.start(
        preset("chapter-one-starter"),
        preset("chapter-one-practice"),
      );
      client.emit({ type: "state", state: STATE });
      client.emit(IDLE_PROMPT_EVENT);
      expect(store.armPlacementIntent("p0:mainMonster:2")).toBe(true);
      expect(current.pendingPlacement).not.toBeNull();

      /* An empty selection fails validation locally; a valid one reaches a
         client that refuses it. */
      const choiceIds =
        rejection === "invalid_response" ? [] : [choiceId("idle-summon")];
      expect(store.respond(choiceIds)).toBe(false);

      expect(current.error?.code, `rejected as ${rejection}`).toBe(rejection);
      expect(current.pendingPlacement, `cleared by ${rejection}`).toBeNull();
      unsubscribe();
    }
  });
});
