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
import { deckId } from "../../../src/decks/deck-contracts.ts";

const names: string[] = [];
afterEach(async () =>
  Promise.all(names.splice(0).map((name) => deleteDB(name))),
);

describe("prototype entry", () => {
  it("opens last-opened deck and clears stale pointers", async () => {
    const name = "entry-routing";
    names.push(name);
    const repo = await IndexedDbDeckRepository.open(name);
    const controller = new DeckBuilderController(
      repo,
      catalogByCode(PROTOTYPE_CATALOG),
      PROTOTYPE_RULESET,
    );
    await controller.initialize();
    expect(get(controller).mode).toBe("library");
    await controller.createDeck("Last opened");
    const id = get(controller).current!.deck.id;
    expect(await repo.getLastOpened()).toBe(id);

    const next = new DeckBuilderController(
      repo,
      catalogByCode(PROTOTYPE_CATALOG),
      PROTOTYPE_RULESET,
    );
    await next.initialize();
    expect(get(next).mode).toBe("editor");
    expect(get(next).current?.deck.id).toBe(id);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("preferences", "readwrite");
    transaction.objectStore("preferences").put({
      key: "last-opened-deck",
      value: deckId("stale"),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const stale = new DeckBuilderController(
      repo,
      catalogByCode(PROTOTYPE_CATALOG),
      PROTOTYPE_RULESET,
    );
    await stale.initialize();
    expect(get(stale).mode).toBe("library");
    expect(await repo.getLastOpened()).toBeNull();
    repo.close();
  });
});
