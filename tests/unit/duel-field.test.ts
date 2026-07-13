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
import {
  fieldCardChoices,
  mapSnapshotToField,
  promptFieldTargets,
  reconcileFieldKeys,
} from "../../src/field/card-mapping.ts";
import {
  createDuelFieldLayout,
  fieldZoneId,
} from "../../src/field/duel-field-layout.ts";

const state: PublicDuelState = {
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
      handCount: 1,
      hand: [
        {
          instanceId: cardInstanceId("human-hand"),
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
      handCount: 2,
      hand: [],
      monsters: [
        {
          instanceId: cardInstanceId("opponent-monster"),
          code: cardCode(89631139),
          owner: 1,
          controller: 1,
          location: "monster",
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
          overlayMaterials: [],
        },
      ],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
  ],
  chain: [],
};

const prompt: PlayerPrompt = {
  id: promptId("field-prompt"),
  kind: "selectCard",
  player: 0,
  title: "Choose",
  choices: [
    {
      id: choiceId("monster-choice"),
      label: "Opponent monster",
      action: "select",
      card: {
        instanceId: cardInstanceId("prompt-positional-id"),
        code: cardCode(89631139),
        controller: 1,
        location: "monster",
        sequence: 0,
        position: "faceUpAttack",
      },
    },
  ],
  minimum: 1,
  maximum: 1,
  cancelable: false,
  ordered: false,
};

describe("duel field mapping", () => {
  it("creates a deterministic complete two-player layout", () => {
    const first = createDuelFieldLayout();
    const second = createDuelFieldLayout();
    expect(first).toEqual(second);
    expect(first).toHaveLength(44);
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
    expect(first).toContainEqual(
      expect.objectContaining({ id: fieldZoneId(0, "monster", 0) }),
    );
  });

  it("maps snapshots idempotently with hidden opponent-hand placeholders", () => {
    const first = mapSnapshotToField(state);
    const second = mapSnapshotToField(state);
    expect([...first.cards]).toEqual([...second.cards]);
    expect(first.cards.get("human-hand")).toMatchObject({ hidden: false });
    expect(first.cards.get("opponent-hand-0")).toMatchObject({ hidden: true });
    expect(first.cards.get("opponent-hand-1")).toMatchObject({ hidden: true });
    expect(first.cards).toHaveLength(4);
  });

  it("resolves positional prompt cards to public field instances", () => {
    const targets = promptFieldTargets(prompt, state);
    expect(targets.cardIds).toEqual(new Set(["opponent-monster"]));
    expect(
      fieldCardChoices(prompt, state, "opponent-monster").map(({ id }) => id),
    ).toEqual(["monster-choice"]);
  });

  it("reconciles only new and removed presentation keys", () => {
    expect(
      reconcileFieldKeys(new Set(["keep", "remove"]), new Set(["keep", "add"])),
    ).toEqual({ create: ["add"], remove: ["remove"] });
  });
});
