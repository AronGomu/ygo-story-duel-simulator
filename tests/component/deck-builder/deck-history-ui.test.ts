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

describe("deck history orchestration", () => {
  it("retains 50 serialized updates and autosaves Undo/Redo", async () => {
    const name = "controller-history";
    names.push(name);
    const repo = await IndexedDbDeckRepository.open(name);
    const controller = new DeckBuilderController(
      repo,
      catalogByCode(PROTOTYPE_CATALOG),
      PROTOTYPE_RULESET,
    );
    await controller.initialize();
    await controller.createDeck("History");
    for (let index = 0; index < 51; index += 1) {
      const hasCard = (get(controller).current?.deck.main.length ?? 0) > 0;
      await controller.mutate(
        hasCard
          ? { type: "remove", cardCode: 89631139, zone: "main" }
          : { type: "add", cardCode: 89631139 },
      );
    }
    expect(get(controller).current?.history.undo).toHaveLength(50);
    const beforeUndo = get(controller).current?.deck.main.length;
    await controller.undo();
    expect(get(controller).current?.deck.main.length).not.toBe(beforeUndo);
    await controller.redo();
    expect(get(controller).current?.deck.main.length).toBe(beforeUndo);
    repo.close();
  });
});
