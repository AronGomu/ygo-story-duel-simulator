import { describe, expect, it } from "vitest";
import {
  reduceEndTurnAutomation,
  type EndTurnAutomationInput,
  type EndTurnAutomationState,
} from "../../src/battle/app/presentation/end-turn-automation.ts";
import { choiceId, promptId } from "../../src/battle/duel/contracts/ids.ts";
import type { PlayerIndex } from "../../src/battle/duel/contracts/public-duel-state.ts";
import type { ActiveInteractionSpec } from "../../src/battle/app/prompts/interaction-spec.ts";

const IDLE: EndTurnAutomationState = {
  status: "idle",
  sessionGeneration: null,
  lastDispatchedKey: null,
};

function spec(
  id: string,
  action: "endPhase" | "yes" = "endPhase",
  sessionGeneration = 4,
): ActiveInteractionSpec {
  return {
    key: {
      workerGeneration: 2,
      sessionGeneration,
      promptId: promptId(id),
    },
    globalChoices: new Map([
      [
        choiceId(`${id}-choice`),
        {
          id: choiceId(`${id}-choice`),
          label: action === "endPhase" ? "End turn" : "Yes",
          action,
        },
      ],
    ]),
  } as unknown as ActiveInteractionSpec;
}

function input(
  value: ActiveInteractionSpec | null,
  overrides: Partial<EndTurnAutomationInput> = {},
): EndTurnAutomationInput {
  return {
    turnPlayer: 0,
    duelFinished: false,
    responsePending: false,
    sessionGeneration: 4,
    spec: value,
    ...overrides,
  };
}

function arm(state: EndTurnAutomationState = IDLE): EndTurnAutomationState {
  return reduceEndTurnAutomation(state, { type: "arm" }).state;
}

function sync(
  state: EndTurnAutomationState,
  value: ActiveInteractionSpec | null,
  overrides: Partial<EndTurnAutomationInput> = {},
) {
  return reduceEndTurnAutomation(state, {
    type: "sync",
    input: input(value, overrides),
  });
}

describe("reduceEndTurnAutomation", () => {
  it("arms intent and emits the exact current keyed end-phase choice", () => {
    const current = spec("first");
    const armed = arm();

    const reduction = sync(armed, current);

    expect(reduction.state).toEqual({
      status: "armed",
      sessionGeneration: 4,
      lastDispatchedKey: current.key,
    });
    expect(reduction.action).toEqual({
      type: "chooseChoice",
      choiceId: choiceId("first-choice"),
      key: current.key,
    });
  });

  it("never emits the same interaction key twice across pending changes", () => {
    const current = spec("same");
    const first = sync(arm(), current);

    const pending = sync(first.state, current, { responsePending: true });
    const settled = sync(pending.state, current, { responsePending: false });

    expect(first.action).not.toBeNull();
    expect(pending.action).toBeNull();
    expect(settled.action).toBeNull();
    expect(settled.state.lastDispatchedKey).toEqual(current.key);
  });

  it("emits each newly offered end-phase interaction key once", () => {
    const first = sync(arm(), spec("first"));
    const nextSpec = spec("next");

    const next = sync(first.state, nextSpec);
    const repeated = sync(next.state, nextSpec);

    expect(next.action).toEqual({
      type: "chooseChoice",
      choiceId: choiceId("next-choice"),
      key: nextSpec.key,
    });
    expect(repeated.action).toBeNull();
  });

  it("pauses through a manual non-end response then resumes on the next end choice", () => {
    const first = sync(arm(), spec("first"));
    const decisionSpec = spec("decision", "yes");

    const paused = sync(first.state, decisionSpec);
    const manuallyAnswering = sync(paused.state, decisionSpec, {
      responsePending: true,
    });
    const resumedSpec = spec("resumed");
    const resumed = sync(manuallyAnswering.state, resumedSpec);

    expect(paused.state).toEqual({
      status: "armed",
      sessionGeneration: 4,
      lastDispatchedKey: first.state.lastDispatchedKey,
    });
    expect(paused.action).toBeNull();
    expect(manuallyAnswering.state).toBe(paused.state);
    expect(manuallyAnswering.action).toBeNull();
    expect(resumed.action).toEqual({
      type: "chooseChoice",
      choiceId: choiceId("resumed-choice"),
      key: resumedSpec.key,
    });
  });

  it.each([
    ["opponent turn", { turnPlayer: 1 as PlayerIndex }],
    ["duel result", { duelFinished: true }],
  ])("clears on %s", (_label, overrides) => {
    const reduction = sync(arm(), spec("stop"), overrides);

    expect(reduction).toEqual({ state: IDLE, action: null });
  });

  it("clears when the current session generation changes", () => {
    const initialized = sync(arm(), spec("first"));

    const changed = sync(
      initialized.state,
      spec("replacement", "endPhase", 5),
      {
        sessionGeneration: 5,
      },
    );

    expect(changed).toEqual({ state: IDLE, action: null });
  });

  it("ignores a spec whose key is stale for the current session", () => {
    const stale = spec("stale", "endPhase", 3);

    const reduction = sync(arm(), stale);

    expect(reduction.state).toEqual({
      status: "armed",
      sessionGeneration: 4,
      lastDispatchedKey: null,
    });
    expect(reduction.action).toBeNull();
  });

  it("reset clears armed intent", () => {
    expect(reduceEndTurnAutomation(arm(), { type: "reset" })).toEqual({
      state: IDLE,
      action: null,
    });
  });
});
