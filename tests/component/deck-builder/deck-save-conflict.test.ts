// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { get } from "svelte/store";
import { DeckBuilderController } from "../../../src/prototypes/deck-builder/deck-builder-store.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

const names: string[] = [];
afterEach(async () =>
  Promise.all(names.splice(0).map((name) => deleteDB(name))),
);

describe("deck revision conflict recovery", () => {
  it("detects stale writes and can reload the newer revision", async () => {
    const name = "controller-conflict";
    names.push(name);
    const repoA = await IndexedDbDeckRepository.open(name);
    const repoB = await IndexedDbDeckRepository.open(name);
    const catalog = catalogByCode(PROTOTYPE_CATALOG);
    const first = new DeckBuilderController(repoA, catalog, PROTOTYPE_RULESET);
    await first.initialize();
    await first.createDeck("Shared");
    const id = get(first).current!.deck.id;

    const second = new DeckBuilderController(repoB, catalog, PROTOTYPE_RULESET);
    await second.initialize();
    expect(get(second).current?.deck.id).toBe(id);
    await first.mutate({ type: "add", cardCode: 89631139 });
    await second.mutate({ type: "add", cardCode: 46986414 });
    expect(get(second).saveState).toBe("conflict");
    await second.reloadCurrent();
    expect(get(second).saveState).toBe("saved");
    expect(get(second).current?.deck.main).toEqual([89631139]);
    repoA.close();
    repoB.close();
  });

  it("preserves conflicted local edits as an independent persisted copy", async () => {
    const name = "controller-conflict-copy";
    names.push(name);
    const repoA = await IndexedDbDeckRepository.open(name);
    const repoB = await IndexedDbDeckRepository.open(name);
    const catalog = catalogByCode(PROTOTYPE_CATALOG);
    const first = new DeckBuilderController(repoA, catalog, PROTOTYPE_RULESET);
    await first.initialize();
    await first.createDeck("Shared");
    const originalId = get(first).current!.deck.id;
    const second = new DeckBuilderController(repoB, catalog, PROTOTYPE_RULESET);
    await second.initialize();
    await first.mutate({ type: "add", cardCode: 89631139 });
    await second.mutate({ type: "add", cardCode: 46986414 });
    expect(get(second).saveState).toBe("conflict");

    await second.preserveCurrentAsCopy();
    const recovered = get(second).current!;
    expect(recovered.deck.id).not.toBe(originalId);
    expect(recovered.deck.name).toBe("Shared Recovered Copy");
    expect(recovered.deck.main).toEqual([46986414]);
    expect(recovered.history.undo).toEqual([]);
    expect((await repoB.load(recovered.deck.id))?.deck.main).toEqual([
      46986414,
    ]);
    repoA.close();
    repoB.close();
  });
});
