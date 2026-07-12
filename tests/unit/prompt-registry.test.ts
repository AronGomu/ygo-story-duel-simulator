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
      { code: 97590747, name: "La Jinn", description: "", strings: [] },
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
