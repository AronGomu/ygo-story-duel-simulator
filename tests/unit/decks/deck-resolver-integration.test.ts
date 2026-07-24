// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { resolveDeck } from "../../../src/decks/deck-resolver.ts";
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

describe("deck resolver + IndexedDB", () => {
  it("returns invalid persisted drafts by deck ID", async () => {
    const name = "resolver-integration";
    names.push(name);
    const catalog = catalogByCode(PROTOTYPE_CATALOG);
    const repo = await IndexedDbDeckRepository.open(name);
    const draft = createBlankDeck("Invalid", catalog, PROTOTYPE_RULESET, {
      id: "invalid",
    });
    const stored = await repo.create(draft, emptyDeckHistory());
    await expect(
      resolveDeck(stored.deck.id, repo, catalog, PROTOTYPE_RULESET),
    ).resolves.toMatchObject({
      type: "invalid",
      deckId: stored.deck.id,
    });
    repo.close();
  });
});
