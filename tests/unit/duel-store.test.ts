import { describe, expect, it } from "vitest";
import type { DuelWorkerEvent } from "../../src/duel/contracts/duel-worker-event.ts";
import {
  cardInstanceId,
  choiceId,
  promptId,
  snapshotId,
} from "../../src/duel/contracts/ids.ts";
import type { PublicDuelState } from "../../src/duel/contracts/public-duel-state.ts";
import type { DuelClientContext } from "../../src/app/DuelWorkerClient.ts";
import {
  createInitialDuelViewState,
  reduceDuelViewState,
} from "../../src/app/stores/duel-store.ts";

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
  players: [
    {
      player: 0,
      lifePoints: 8000,
      deckCount: 35,
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
          overlayMaterials: [],
        },
      ],
      monsters: [],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
    {
      player: 1,
      lifePoints: 8000,
      deckCount: 35,
      extraDeckCount: 0,
      handCount: 5,
      hand: [],
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

function apply(
  state: ReturnType<typeof createInitialDuelViewState>,
  event: DuelWorkerEvent,
  context: DuelClientContext = CONTEXT,
): ReturnType<typeof createInitialDuelViewState> {
  return reduceDuelViewState(state, { context, event });
}

describe("duel view-state reducer", () => {
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
      event: { type: "hint", message: "Old event" },
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
      events: [],
    });
    expect(next.context).not.toEqual(view.context);
  });

  it("keeps the presentation-event log bounded", () => {
    let view = createInitialDuelViewState(CONTEXT);
    for (let index = 0; index < 125; index += 1) {
      view = apply(view, {
        type: "event",
        event: { type: "hint", message: `Event ${index}` },
      });
    }
    expect(view.events).toHaveLength(100);
    expect(view.events[0]).toEqual({ type: "hint", message: "Event 25" });
    expect(view.presentationEvents).toHaveLength(100);
    expect(view.presentationEvents[0]).toEqual({
      sequence: 26,
      event: { type: "hint", message: "Event 25" },
    });
    expect(view.presentationEvents.at(-1)?.sequence).toBe(125);
  });

  it("keeps recoverable errors actionable and makes terminal errors fail", () => {
    let view = apply(createInitialDuelViewState(CONTEXT), PROMPT_EVENT);
    view = { ...view, responsePending: true };
    view = apply(view, {
      type: "error",
      error: {
        code: "invalid_response",
        message: "Choose again",
        recoverable: true,
      },
    });
    expect(view).toMatchObject({
      status: "awaiting-input",
      prompt: PROMPT_EVENT.prompt,
      responsePending: false,
      error: { recoverable: true },
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
    });
  });
});
