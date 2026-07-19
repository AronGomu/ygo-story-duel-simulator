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
import {
  BasicOpponentPolicy,
  toOpponentVisibleState,
} from "../../src/worker/opponent/OpponentPolicy.ts";

const dependencies: ActiveDuelDependencies = {
  cards: new Map([
    [97590747, cardData(97590747, 1800)],
    [5053103, cardData(5053103, 1200)],
  ]),
  texts: new Map(),
  scripts: new Map(),
  strings: { system: {}, victory: {}, counter: {}, setname: {} },
  images: new Map(),
  counts: { cards: 2, texts: 0, scripts: 0, globals: 0, images: 0 },
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
      hand: [
        {
          instanceId: cardInstanceId("human-private-card"),
          code: cardCode(97590747),
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
} satisfies PublicDuelState;
const opponentState = toOpponentVisibleState(state);

function prompt(
  kind: PlayerPrompt["kind"],
  choices: PlayerPrompt["choices"],
): PlayerPrompt {
  return {
    id: promptId("prompt"),
    kind,
    player: 1,
    title: "Choose",
    choices,
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
      opponentState,
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
      opponentState,
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
        opponentState,
      ),
    ).toEqual({ choiceIds: [pass], reason: "decline_optional" });
  });

  it("never receives human card identities", () => {
    expect(opponentState.players[0].handCount).toBe(5);
    expect(JSON.stringify(opponentState)).not.toContain("97590747");
    expect(opponentState.players[0]).not.toHaveProperty("hand");
  });

  it.each([
    ["specialSummon", "special_summon_first_legal"],
    ["activate", "activate_first_legal"],
    ["setMonster", "set_first_legal"],
  ] as const)("uses the %s idle priority", (action, reason) => {
    const selected = choiceId(action);
    expect(
      policy.choose(
        prompt("idleCommand", [
          { id: selected, label: action, action },
          { id: choiceId("end"), label: "End", action: "endPhase" },
        ]),
        opponentState,
      ),
    ).toEqual({ choiceIds: [selected], reason });
  });

  it("attacks with the strongest legal attacker and otherwise advances", () => {
    const weak = choiceId("weak");
    const strong = choiceId("strong");
    const card = (code: 5053103 | 97590747, sequence: number) => ({
      instanceId: cardInstanceId(`attacker-${sequence}`),
      code: cardCode(code),
      controller: 1 as const,
      location: "monster" as const,
      sequence,
    });
    expect(
      policy.choose(
        prompt("battleCommand", [
          {
            id: weak,
            label: "Weak",
            action: "attack",
            card: card(5053103, 0),
          },
          {
            id: strong,
            label: "Strong",
            action: "attack",
            card: card(97590747, 1),
          },
        ]),
        opponentState,
      ),
    ).toEqual({ choiceIds: [strong], reason: "attack_strongest" });

    const end = choiceId("battle-end");
    expect(
      policy.choose(
        prompt("battleCommand", [
          { id: end, label: "End", action: "endPhase" },
        ]),
        opponentState,
      ),
    ).toEqual({ choiceIds: [end], reason: "advance_phase" });
  });

  it("answers forced decisions and preserves sort order", () => {
    const forced = choiceId("forced");
    expect(
      policy.choose(
        prompt("chain", [
          { id: forced, label: "Activate", action: "activate" },
        ]),
        opponentState,
      ),
    ).toEqual({ choiceIds: [forced], reason: "answer_mandatory" });

    const order = [choiceId("first"), choiceId("second")];
    expect(
      policy.choose(
        {
          ...prompt(
            "sortCard",
            order.map((id) => ({ id, label: id, action: "select" as const })),
          ),
          minimum: 2,
          maximum: 2,
          ordered: true,
        },
        opponentState,
      ),
    ).toEqual({ choiceIds: order, reason: "preserve_order" });
  });

  it("allocates mandatory counters without exceeding per-card capacity", () => {
    const first = choiceId("counter-first");
    const second = choiceId("counter-second");
    expect(
      policy.choose(
        {
          ...prompt("selectCounter", [
            {
              id: first,
              label: "First",
              action: "select",
              allocationMaximum: 1,
            },
            {
              id: second,
              label: "Second",
              action: "select",
              allocationMaximum: 2,
            },
          ]),
          minimum: 3,
          maximum: 3,
        },
        opponentState,
      ),
    ).toEqual({
      choiceIds: [first, second, second],
      reason: "select_first_legal",
    });
  });
});

function cardData(code: number, attack: number) {
  return {
    code,
    alias: 0,
    setcodes: [],
    type: 17,
    level: 4,
    attribute: 0,
    race: 0n,
    attack,
    defense: 1000,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  };
}
