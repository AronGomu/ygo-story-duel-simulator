import { describe, expect, it } from "vitest";
import type { DeckId } from "../../src/battle/duel/presets/deck-catalog.ts";
import { parseYdk } from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../../src/battle/duel/presets/reviewed-card-pool.ts";

describe("reviewed card pool", () => {
  it("pool is the union of every supplied deck", () => {
    const sources = new Map<DeckId, string>([
      ["chapter-one-starter", "#main\n1\n2\n"],
      ["chapter-one-practice", "#main\n2\n3\n"],
    ]);

    expect(reviewedCardPool(sources)).toEqual(new Set([1, 2, 3]));
  });

  it("pool includes extra deck codes", () => {
    const sources = new Map<DeckId, string>([
      ["chapter-one-starter", "#main\n1\n#extra\n9\n!side\n"],
    ]);

    expect(reviewedCardPool(sources).has(9)).toBe(true);
  });

  it("pool of the real Chapter 1 decks has 16 codes", async () => {
    expect(reviewedCardPool(await loadDeckSources()).size).toBe(16);
  });

  it("every bundled deck code is in the pool", async () => {
    const sources = await loadDeckSources();
    const pool = reviewedCardPool(sources);

    for (const source of sources.values()) {
      const deck = parseYdk(source);
      for (const code of [...deck.main, ...deck.extra]) {
        expect(pool.has(code)).toBe(true);
      }
    }
  });
});
