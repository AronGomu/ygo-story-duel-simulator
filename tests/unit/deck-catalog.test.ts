import { describe, expect, it } from "vitest";
import {
  DECK_CATALOG,
  DEFAULT_OPPONENT_DECK_ID,
  DEFAULT_PLAYER_DECK_ID,
  deckMetadata,
  isDeckId,
} from "../../src/battle/duel/presets/deck-catalog.ts";

describe("deck catalog", () => {
  it("DECK_CATALOG exposes only Chapter 1 starter and practice identities", () => {
    expect(DECK_CATALOG.map(({ id }) => id)).toEqual([
      "chapter-one-starter",
      "chapter-one-practice",
    ]);
    expect(new Set(DECK_CATALOG.map(({ fileName }) => fileName))).toHaveLength(
      2,
    );
  });

  it("deckMetadata resolves every id in the catalog", () => {
    for (const metadata of DECK_CATALOG) {
      expect(deckMetadata(metadata.id)).toBe(metadata);
    }
  });

  it.each([
    "mvp-player",
    "mvp-opponent",
    "burning-abyss",
    "nekroz",
    "shaddoll",
    "spellbook",
  ])("legacy preset ID cannot resolve: %s", (id) => {
    expect(isDeckId(id)).toBe(false);
  });

  it("isDeckId rejects an unknown id", () => {
    expect(isDeckId("not-a-deck")).toBe(false);
  });

  it("defaults name the bundled player deck and the fixed opponent", () => {
    expect(DEFAULT_PLAYER_DECK_ID).toBe("chapter-one-starter");
    expect(DEFAULT_OPPONENT_DECK_ID).toBe("chapter-one-practice");
  });
});
