import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DECK_CATALOG } from "../../src/battle/duel/presets/deck-catalog.ts";
import {
  MVP_DECK_CONSTRAINTS,
  parseYdk,
  validateDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { DECK_SOURCES } from "../../src/battle/duel/presets/deck-sources-browser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";

const ARCHETYPE_DECK_IDS = ["burning-abyss", "nekroz", "shaddoll", "spellbook"];

describe("bundled deck sources", () => {
  it("loadDeckSources returns one source per catalog entry", async () => {
    const sources = await loadDeckSources();

    expect(sources.size).toBe(2);
    for (const { id } of DECK_CATALOG) {
      expect(sources.has(id)).toBe(true);
      expect(sources.get(id)).not.toBe("");
    }
  });

  it("browser and Node source adapters contain identical text per id", async () => {
    const nodeSources = await loadDeckSources();

    expect(DECK_SOURCES.size).toBe(2);
    for (const { id } of DECK_CATALOG) {
      expect(DECK_SOURCES.get(id)).toBe(nodeSources.get(id));
    }
  });

  it("every bundled deck parses and validates against its constraints", async () => {
    const sources = await loadDeckSources();

    for (const source of sources.values()) {
      const deck = parseYdk(source);
      const codes = new Set([...deck.main, ...deck.extra, ...deck.side]);
      expect(() =>
        validateDeck(deck, codes, MVP_DECK_CONSTRAINTS),
      ).not.toThrow();
      expect(deck.main.length).toBeGreaterThanOrEqual(40);
      expect(deck.main.length).toBeLessThanOrEqual(60);
      expect(deck.extra.length).toBeLessThanOrEqual(15);
      expect(deck.side).toHaveLength(0);
    }
  });

  it("no bundled deck runs more than three copies of a card", async () => {
    const sources = await loadDeckSources();

    for (const source of sources.values()) {
      const deck = parseYdk(source);
      const counts = new Map<number, number>();
      for (const code of [...deck.main, ...deck.extra]) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      expect([...counts.values()].every((count) => count <= 3)).toBe(true);
    }
  });

  it("burning-abyss has 40 main and 15 extra", async () => {
    const deck = await parsedDeck("burning-abyss");
    expect(deck.main).toHaveLength(40);
    expect(deck.extra).toHaveLength(15);
  });

  it("nekroz has a Kaleidoscope-capable 40/15 split", async () => {
    const deck = await parsedDeck("nekroz");
    expect(deck.main).toHaveLength(40);
    expect(deck.extra).toHaveLength(15);
    expect(deck.extra.filter((code) => code === 79606837)).toHaveLength(3);
    expect(deck.extra).toEqual(
      expect.arrayContaining([
        50091196, 15240238, 88033975, 15028680, 73580471, 44508094, 52687916,
        8561192, 41517789, 35952884, 82633039,
      ]),
    );
  });

  it("all four legacy archetype fixtures keep a full Extra Deck", async () => {
    for (const id of ARCHETYPE_DECK_IDS) {
      expect((await parsedDeck(id)).extra).toHaveLength(15);
    }
  });

  it("shaddoll has 40 main and 15 extra", async () => {
    const deck = await parsedDeck("shaddoll");
    expect(deck.main).toHaveLength(40);
    expect(deck.extra).toHaveLength(15);
  });

  it("spellbook has 40 main and 15 extra", async () => {
    const deck = await parsedDeck("spellbook");
    expect(deck.main).toHaveLength(40);
    expect(deck.extra).toHaveLength(15);
  });
});

// Historical archetype fixtures stay explicit, never resolved by active adapters.
async function parsedDeck(id: string) {
  return parseYdk(
    await readFile(
      new URL(`../../src/battle/duel/presets/decks/${id}.ydk`, import.meta.url),
      "utf8",
    ),
  );
}
