import { describe, expect, it } from "vitest";
import { STARTER_DECK_NAME } from "../../../src/decks/starter-deck.ts";
import { buildStarterGrant } from "../../../src/story/decks/starter-grant.ts";
import { reduceStory } from "../../../src/story/model/story-reducer.ts";
import { createInitialStoryState } from "../../../src/story/model/story-state.ts";
import { migrateStorySaveState } from "../../../src/story/saves/story-save-contracts.ts";

function newGame(): ReturnType<typeof reduceStory> {
  return reduceStory(createInitialStoryState(), { type: "new-game" });
}

describe("the new-save starter grant", () => {
  it("a new game grants the starter deck", () => {
    const { decks } = newGame();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.name).toBe(STARTER_DECK_NAME);
    expect(decks[0]?.main.length).toBeGreaterThanOrEqual(40);
  });

  /* The point of the grant: a deck the save does not own the cards for is a
     deck the ownership rule refuses at the first duel. */
  it("a new game credits the starter deck's cards", () => {
    const { decks, collection } = newGame();
    const deck = decks[0];
    expect(deck).toBeDefined();
    const used = new Map<number, number>();
    for (const code of [...deck!.main, ...deck!.extra, ...deck!.side])
      used.set(code, (used.get(code) ?? 0) + 1);
    expect(used.size).toBeGreaterThan(0);
    for (const [code, copies] of used)
      expect(collection[code] ?? 0).toBeGreaterThanOrEqual(copies);
  });

  it("the granted deck is the default", () => {
    const state = newGame();
    expect(state.defaultDeckId).toBe(state.decks[0]?.id);
  });

  /* A pack costs 150 DP; the grant is cards, not credit. */
  it("the wallet is unchanged", () => {
    expect(newGame().dp).toBe(1000);
  });

  it("the grant is deterministic", () => {
    const first = newGame();
    const second = newGame();
    expect(second.decks).toEqual(first.decks);
    expect(second.collection).toEqual(first.collection);
  });

  /* The reducer is a pure sync function and the runtime catalog is an async
     128-shard fetch, so the grant is built without one. The stored verdict is
     a cache the editor and `resolveDeck` both recompute; what has to survive
     is the save layer's own predicate, because a record it rejects makes the
     whole save read back corrupt — progress, wallet and collection with it. */
  it("the granted deck is a record the save layer can read back", () => {
    const state = newGame();
    const migrated = migrateStorySaveState(state, 3);
    expect(migrated).not.toBeNull();
    expect(migrated?.decks).toEqual(state.decks);
    expect(migrated?.defaultDeckId).toBe(state.defaultDeckId);
  });

  /* The migration retains its historical grant for saves written before decks
     existed. A record that already carries a deck list is not such a save: an
     empty library it chose to hold stays empty, and no cards come with it. */
  it("a record that already carries a deck list is granted nothing", () => {
    const existing = { ...createInitialStoryState(), dp: 40 };
    const migrated = migrateStorySaveState(existing, 2);
    expect(migrated?.decks).toEqual([]);
    expect(migrated?.defaultDeckId).toBeNull();
    expect(migrated?.collection).toEqual({});
  });
});

describe("buildStarterGrant", () => {
  /* Two grants never share a mutable list: a deck edited in one save must not
     turn up edited in the next new game. */
  it("hands every caller its own frozen record", () => {
    const first = buildStarterGrant();
    const second = buildStarterGrant();
    expect(second.deck).toEqual(first.deck);
    expect(second.collection).toEqual(first.collection);
    expect(Object.isFrozen(first.deck)).toBe(true);
    expect(() => {
      (first.deck.main as number[]).push(1);
    }).toThrow();
  });

  it("credits every copy the deck uses and nothing else", () => {
    const { deck, collection } = buildStarterGrant();
    const codes = [...deck.main, ...deck.extra, ...deck.side];
    expect(
      Object.keys(collection)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...new Set(codes)].sort((a, b) => a - b));
    const total = Object.values(collection).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(codes.length);
  });
});
