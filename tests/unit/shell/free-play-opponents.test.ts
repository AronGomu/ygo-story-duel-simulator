import { describe, expect, it } from "vitest";
import {
  DECK_CATALOG,
  DEFAULT_OPPONENT_DECK_ID,
} from "../../../src/battle/index.ts";
import {
  DEFAULT_FREE_PLAY_OPPONENT_ID,
  FREE_PLAY_OPPONENTS,
  freePlayOpponent,
} from "../../../src/shell/screens/free-play-opponents.ts";

/* The three AI opponents free play offers. Each owns exactly one bundled deck,
   so the roster is only as true as the catalog it names: a renamed preset id
   has to fail here rather than reach a seat that resolves to nothing. */

describe("the free-play opponent roster", () => {
  it("has exactly three personas, each owning a real bundled deck", () => {
    expect(FREE_PLAY_OPPONENTS).toHaveLength(3);
    const catalogIds = DECK_CATALOG.map(({ id }) => String(id));
    for (const opponent of FREE_PLAY_OPPONENTS) {
      expect(opponent.deckKey.startsWith("preset:")).toBe(true);
      expect(catalogIds).toContain(opponent.deckKey.slice("preset:".length));
    }
    expect(FREE_PLAY_OPPONENTS.map(({ id }) => id)).toEqual([
      "practice-bot",
      "blaze-circuit",
      "vault-warden",
    ]);
  });

  /* A persona id remembered from a build that spelled the roster differently
     is not a reason for the picker to render nothing. */
  it("falls back to the default persona for an unknown id", () => {
    expect(freePlayOpponent("gone")).toBe(
      freePlayOpponent(DEFAULT_FREE_PLAY_OPPONENT_ID),
    );
    expect(freePlayOpponent("gone").id).toBe("practice-bot");
    expect(freePlayOpponent("")).toBe(freePlayOpponent("practice-bot"));
  });

  /* A fresh profile defaults to the Chapter 1 practice opponent. */
  it("gives the default persona the duel's default opponent deck", () => {
    expect(freePlayOpponent(DEFAULT_FREE_PLAY_OPPONENT_ID).deckKey).toBe(
      `preset:${DEFAULT_OPPONENT_DECK_ID}`,
    );
    expect(freePlayOpponent(DEFAULT_FREE_PLAY_OPPONENT_ID).deckKey).toBe(
      "preset:chapter-one-practice",
    );
  });

  it("names every persona and gives it a tagline", () => {
    expect(FREE_PLAY_OPPONENTS.map(({ name }) => name)).toEqual([
      "Practice Bot",
      "Blaze Circuit",
      "Vault Warden",
    ]);
    for (const { line } of FREE_PLAY_OPPONENTS) expect(line).not.toBe("");
  });
});
