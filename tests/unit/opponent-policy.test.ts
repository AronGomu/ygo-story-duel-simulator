import { describe, expect, it } from "vitest";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
  snapshotId,
} from "../../src/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/duel/contracts/public-duel-state.ts";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import { BasicOpponentPolicy } from "../../src/worker/opponent/OpponentPolicy.ts";

const dependencies: ActiveDuelDependencies = {
  cards: new Map(),
  texts: new Map(),
  scripts: new Map(),
  strings: { system: {}, victory: {}, counter: {}, setname: {} },
  images: new Map(),
  counts: { cards: 0, texts: 0, scripts: 0, globals: 0, images: 0 },
};
const state = {
  snapshotId: snapshotId("a".repeat(64)),
  revision: 0,
  turn: 1,
  turnPlayer: 1,
  phase: "main1",
  players: [
    {
      player: 0,
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
} satisfies PublicDuelState;

function prompt(
  kind: PlayerPrompt["kind"],
  actions: PlayerPrompt["choices"],
): PlayerPrompt {
  return {
    id: promptId("prompt"),
    kind,
    player: 1,
    title: "Choose",
    choices: actions,
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  };
}

describe("BasicOpponentPolicy", () => {
  const policy = new BasicOpponentPolicy(dependencies);

  it("prefers a legal normal summon before phase progression", () => {
    const summon = choiceId("summon");
    const decision = policy.choose(
      prompt("idleCommand", [
        { id: choiceId("end"), label: "End", action: "endPhase" },
        { id: summon, label: "Summon", action: "summon" },
      ]),
      state,
    );
    expect(decision).toEqual({
      choiceIds: [summon],
      reason: "summon_first_legal",
    });
  });

  it("selects a minimal valid at-least sum", () => {
    const choices = [0, 1].map((sequence) => ({
      id: choiceId(`sum-${sequence}`),
      label: "Three",
      action: "select" as const,
      card: {
        instanceId: cardInstanceId(`sum-card-${sequence}`),
        code: cardCode(97590747),
        controller: 1 as const,
        location: "hand" as const,
        sequence,
        contribution: 3,
      },
    }));
    const decision = policy.choose(
      {
        ...prompt("selectSum", choices),
        maximum: 2,
        requiredTotal: 5,
        sumMode: "atLeast",
      },
      state,
    );
    expect(decision).toEqual({
      choiceIds: choices.map((choice) => choice.id),
      reason: "select_valid_sum",
    });
  });

  it("passes optional chains", () => {
    const pass = choiceId("pass");
    expect(
      policy.choose(
        prompt("chain", [
          { id: choiceId("activate"), label: "Activate", action: "activate" },
          { id: pass, label: "Pass", action: "pass" },
        ]),
        state,
      ),
    ).toEqual({ choiceIds: [pass], reason: "decline_optional" });
  });
});
