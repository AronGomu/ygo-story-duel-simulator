import { describe, expect, it } from "vitest";
import {
  applyDeckCommand,
  sortDeckCards,
} from "../../../src/decks/deck-model.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const empty = {
  main: [] as number[],
  extra: [] as number[],
  side: [] as number[],
};

describe("deck editing model", () => {
  it("adds catalog cards to one canonical Main or Extra target", () => {
    const main = applyDeckCommand(
      empty,
      { type: "add", cardCode: 89631139 },
      catalog,
      PROTOTYPE_RULESET,
    );
    const extra = applyDeckCommand(
      empty,
      { type: "add", cardCode: 8505920 },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(main.type === "accepted" && main.cards.main).toEqual([89631139]);
    expect(extra.type === "accepted" && extra.cards.extra).toEqual([8505920]);
  });

  it("rejects forbidden catalog cards without mutating the deck", () => {
    const result = applyDeckCommand(
      empty,
      { type: "add", cardCode: 10000000 },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(result).toEqual({ type: "rejected", reason: "Card is forbidden." });
    expect(empty).toEqual({ main: [], extra: [], side: [] });
  });

  it("moves cards to Side and returns them only to their canonical zone", () => {
    const deck = { main: [89631139], extra: [8505920], side: [] };
    const toSide = applyDeckCommand(
      deck,
      { type: "move", cardCode: 8505920, from: "extra", to: "side" },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(toSide.type).toBe("accepted");
    if (toSide.type !== "accepted") return;
    expect(toSide.cards).toEqual({
      main: [89631139],
      extra: [],
      side: [8505920],
    });
    const back = applyDeckCommand(
      toSide.cards,
      { type: "move", cardCode: 8505920, from: "side", to: "extra" },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(back.type === "accepted" && back.cards.extra).toEqual([8505920]);
    expect(
      applyDeckCommand(
        toSide.cards,
        { type: "move", cardCode: 8505920, from: "side", to: "main" },
        catalog,
        PROTOTYPE_RULESET,
      ),
    ).toMatchObject({ type: "rejected" });
  });

  it("removes one repeated tile and enforces the pinned copy limit", () => {
    let cards = { ...empty };
    for (let index = 0; index < 3; index += 1) {
      const result = applyDeckCommand(
        cards,
        { type: "add", cardCode: 89631139 },
        catalog,
        PROTOTYPE_RULESET,
      );
      expect(result.type).toBe("accepted");
      if (result.type === "accepted") cards = result.cards as typeof cards;
    }
    expect(cards.main).toEqual([89631139, 89631139, 89631139]);
    expect(
      applyDeckCommand(
        cards,
        { type: "add", cardCode: 89631139 },
        catalog,
        PROTOTYPE_RULESET,
      ),
    ).toMatchObject({ type: "rejected", reason: "Copy limit 3 reached." });
    const removed = applyDeckCommand(
      cards,
      { type: "remove", cardCode: 89631139, zone: "main" },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(removed.type === "accepted" && removed.cards.main).toHaveLength(2);
  });

  it("removes missing-card placeholders without catalog data", () => {
    const removed = applyDeckCommand(
      { main: [99999999], extra: [], side: [] },
      { type: "remove", cardCode: 99999999, zone: "main" },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(removed).toMatchObject({ type: "accepted", cards: { main: [] } });
  });

  it("orders Side by canonical Main/Extra class", () => {
    expect(
      sortDeckCards(
        { main: [], extra: [], side: [8505920, 44095762, 89631139] },
        catalog,
      ).side,
    ).toEqual([89631139, 44095762, 8505920]);
  });

  it("auto-packs cards deterministically instead of exposing manual ordering", () => {
    expect(
      sortDeckCards(
        { main: [44095762, 12580477, 89631139], extra: [], side: [] },
        catalog,
      ).main,
    ).toEqual([89631139, 12580477, 44095762]);
  });
});
