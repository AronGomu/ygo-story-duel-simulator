import { describe, expect, it } from "vitest";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import {
  PromptRegistry,
  buildEnginePrompt,
} from "../../src/worker/protocol/PromptRegistry.ts";
import {
  EngineIdleAction,
  EngineLocation,
  EngineMessageType,
  EnginePosition,
  EngineResponseType,
} from "../../src/worker/engine/engine-constants.ts";
import type { EngineMessage } from "../../src/worker/engine/OcgCoreAdapter.ts";

const dependencies: ActiveDuelDependencies = {
  cards: new Map(),
  texts: new Map([
    [
      97590747,
      {
        code: 97590747,
        name: "La Jinn",
        description: "A mystical genie.",
        strings: ["Activate La Jinn's effect"],
      },
    ],
  ]),
  scripts: new Map(),
  strings: { system: {}, victory: {}, counter: {}, setname: {} },
  images: new Map(),
  counts: { cards: 0, texts: 1, scripts: 0, globals: 0, images: 0 },
};

const idleMessage: EngineMessage = {
  type: EngineMessageType.SELECT_IDLE_COMMAND,
  player: 0,
  summons: [
    {
      code: 97590747,
      controller: 0,
      location: EngineLocation.HAND,
      sequence: 2,
    },
  ],
  special_summons: [],
  pos_changes: [],
  monster_sets: [],
  spell_sets: [],
  activates: [],
  to_bp: false,
  to_ep: true,
  shuffle: false,
};

describe("PromptRegistry", () => {
  it("maps opaque choices back to Worker-private idle response indexes", () => {
    const binding = buildEnginePrompt(idleMessage, 1, dependencies);
    expect(binding).not.toBeNull();
    const summon = binding?.prompt.choices.find(
      (choice) => choice.action === "summon",
    );
    expect(summon?.label).toContain("La Jinn");
    expect(summon?.card).toMatchObject({
      name: "La Jinn",
      description: "A mystical genie.",
    });
    expect(binding?.prompt).not.toHaveProperty("index");
    expect(binding?.resolve(summon === undefined ? [] : [summon.id])).toEqual({
      type: EngineResponseType.SELECT_IDLE_COMMAND,
      action: EngineIdleAction.SUMMON,
      index: 0,
    });
  });

  it("rejects stale, duplicate, and unknown choices", () => {
    const registry = new PromptRegistry(dependencies);
    const prompt = registry.publish(idleMessage);
    expect(prompt).not.toBeNull();
    const selected = prompt?.choices[0];
    if (prompt === null || selected === undefined)
      throw new Error("Fixture prompt is empty");
    registry.respond(prompt.id, [selected.id]);
    expect(() => registry.respond(prompt.id, [selected.id])).toThrow(
      /No prompt/,
    );
  });

  it("validates exact and at-least sum modes with packed contributions", () => {
    const exact = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_SUM,
        player: 0,
        select_max: 0,
        amount: 3,
        min: 1,
        max: 1,
        selects_must: [],
        selects: [
          {
            code: 97590747,
            controller: 0,
            location: EngineLocation.HAND,
            sequence: 0,
            position: EnginePosition.FACE_DOWN_DEFENSE,
            amount: (3 << 16) | 2,
          },
        ],
      },
      2,
      dependencies,
    );
    const exactChoice = exact?.prompt.choices[0];
    if (exactChoice === undefined)
      throw new Error("Exact sum choice is missing");
    expect(exactChoice.card).toMatchObject({
      contribution: 2,
      alternativeContribution: 3,
    });
    expect(exact?.resolve([exactChoice.id])).toEqual({
      type: EngineResponseType.SELECT_SUM,
      indicies: [0],
    });

    const atLeast = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_SUM,
        player: 0,
        select_max: 1,
        amount: 5,
        min: 0,
        max: 0,
        selects_must: [],
        selects: [0, 1].map((sequence) => ({
          code: 97590747,
          controller: 0 as const,
          location: EngineLocation.HAND,
          sequence,
          position: EnginePosition.FACE_DOWN_DEFENSE,
          amount: 3,
        })),
      },
      3,
      dependencies,
    );
    const atLeastChoices = atLeast?.prompt.choices ?? [];
    expect(atLeast?.prompt).toMatchObject({
      minimum: 0,
      maximum: 2,
      sumMode: "atLeast",
      requiredTotal: 5,
    });
    expect(() => atLeast?.resolve([atLeastChoices[0]!.id])).toThrow(
      /minimum total 5/,
    );
    expect(atLeast?.resolve(atLeastChoices.map((choice) => choice.id))).toEqual(
      { type: EngineResponseType.SELECT_SUM, indicies: [0, 1] },
    );

    const mandatoryOnly = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_SUM,
        player: 0,
        select_max: 1,
        amount: 5,
        min: 0,
        max: 0,
        selects_must: [2, 3].map((amount, sequence) => ({
          code: 97590747,
          controller: 0 as const,
          location: EngineLocation.HAND,
          sequence,
          position: EnginePosition.FACE_DOWN_DEFENSE,
          amount,
        })),
        selects: [
          {
            code: 97590747,
            controller: 0,
            location: EngineLocation.HAND,
            sequence: 2,
            position: EnginePosition.FACE_DOWN_DEFENSE,
            amount: 1,
          },
        ],
      },
      4,
      dependencies,
    );
    expect(mandatoryOnly?.prompt.minimum).toBe(0);
    expect(mandatoryOnly?.resolve([])).toEqual({
      type: EngineResponseType.SELECT_SUM,
      indicies: [],
    });
  });

  it("rejects duplicate cards in a sort order", () => {
    const binding = buildEnginePrompt(
      {
        type: EngineMessageType.SORT_CARD,
        player: 0,
        cards: [0, 1].map((sequence) => ({
          code: 97590747,
          controller: 0 as const,
          location: EngineLocation.DECK,
          sequence,
        })),
      },
      4,
      dependencies,
    );
    const choice = binding?.prompt.choices[0];
    if (choice === undefined) throw new Error("Sort choice is missing");
    expect(() => binding?.resolve([choice.id, choice.id])).toThrow(
      /Duplicate choice IDs/,
    );
  });

  it("handles zero, one, and multiple chain candidates", () => {
    const activeCard = (sequence: number) => ({
      code: 97590747,
      controller: 0 as const,
      location: EngineLocation.MONSTER,
      sequence,
      position: EnginePosition.FACE_UP_ATTACK,
      description: 0n,
      client_mode: 0 as const,
    });
    for (const count of [0, 1, 2]) {
      const binding = buildEnginePrompt(
        {
          type: EngineMessageType.SELECT_CHAIN,
          player: 0,
          spe_count: 0,
          forced: false,
          hint_timing: 1,
          hint_timing_other: 1,
          selects: Array.from({ length: count }, (_, index) =>
            activeCard(index),
          ),
        },
        10 + count,
        dependencies,
      );
      expect(binding?.prompt.choices).toHaveLength(count + 1);
      expect(binding?.prompt.choices.at(-1)?.action).toBe("pass");
    }
  });

  it("emits a diagnostic when localized option text is missing", () => {
    const diagnostics: unknown[] = [];
    const option = 123n << 20n;
    const binding = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_OPTION,
        player: 0,
        options: [option],
      },
      13,
      dependencies,
      "",
      (diagnostic) => diagnostics.push(diagnostic),
    );
    expect(binding?.prompt.choices[0]?.label).toBe(`Option ${option}`);
    expect(diagnostics).toEqual([
      { type: "missing_text", reference: `option:${option}` },
    ]);
  });

  it("adds effect-card details and explicit counter capacities to public prompts", () => {
    const effect = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_EFFECT_YES_NO,
        player: 0,
        code: 97590747,
        controller: 0,
        location: EngineLocation.MONSTER,
        sequence: 0,
        position: EnginePosition.FACE_UP_ATTACK,
        description: (97590747n << 20n) | 0n,
      },
      5,
      dependencies,
    );
    expect(effect?.prompt).toMatchObject({
      message: "Activate La Jinn's effect",
      contextCard: {
        code: 97590747,
        name: "La Jinn",
        description: "A mystical genie.",
      },
    });

    const counters = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_COUNTER,
        player: 0,
        counter_type: 1,
        count: 2,
        cards: [
          {
            code: 97590747,
            controller: 0,
            location: EngineLocation.MONSTER,
            sequence: 0,
            count: 2,
          },
        ],
      },
      6,
      dependencies,
    );
    expect(counters?.prompt.choices[0]).toMatchObject({
      allocationMaximum: 2,
    });
  });

  it("redacts opponent hidden identities from public prompt cards and labels", () => {
    const binding = buildEnginePrompt(
      {
        type: EngineMessageType.SELECT_CARD,
        player: 0,
        can_cancel: false,
        min: 1,
        max: 1,
        selects: [
          {
            code: 97590747,
            controller: 1,
            location: EngineLocation.BANISHED,
            sequence: 0,
            position: EnginePosition.FACE_DOWN_DEFENSE,
          },
        ],
      },
      7,
      dependencies,
    );
    expect(binding?.prompt.choices[0]).toMatchObject({
      label: "Hidden card",
      card: { controller: 1, location: "banished" },
    });
    expect(binding?.prompt.choices[0]?.card).not.toHaveProperty("code");
    expect(JSON.stringify(binding?.prompt)).not.toContain("97590747");
  });

  it("validates multi-card minimum and maximum bounds before encoding", () => {
    const message: EngineMessage = {
      type: EngineMessageType.SELECT_CARD,
      player: 0,
      can_cancel: false,
      min: 1,
      max: 1,
      selects: [
        {
          code: 97590747,
          controller: 0,
          location: EngineLocation.MONSTER,
          sequence: 0,
          position: EnginePosition.FACE_UP_ATTACK,
        },
      ],
    };
    const binding = buildEnginePrompt(message, 2, dependencies);
    expect(() => binding?.resolve([])).toThrow(/between 1 and 1/);
    const choice = binding?.prompt.choices[0];
    if (choice === undefined) throw new Error("Fixture choice is missing");
    expect(binding?.resolve([choice.id])).toEqual({
      type: EngineResponseType.SELECT_CARD,
      indicies: [0],
    });
  });
});
