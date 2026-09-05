// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import DeckEditorApp from "../../../src/deck-editor/index.ts";
import { DECK_DATABASE_NAME } from "../../../src/decks/deck-database.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { setRuntimeCatalogForTests } from "../../../src/decks/catalog/runtime-catalog.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { prototypeCatalogMap } from "../../fixtures/deck-editor.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";
import { SHEEP_TOKEN, SHEEP_TOKEN_CODE } from "../../fixtures/token-card.ts";

installPrototypeActiveCatalog();
/* The production catalog is the whole card database, Tokens included, because
   the duel names a token it summons from the same read. */
setRuntimeCatalogForTests([...PROTOTYPE_CATALOG, SHEEP_TOKEN]);

afterEach(async () => {
  cleanup();
  await deleteDB(DECK_DATABASE_NAME);
});

async function seedDeck(id: string): Promise<void> {
  const repository = await IndexedDbDeckRepository.open();
  try {
    const deck = createBlankDeck(
      "Token Test",
      prototypeCatalogMap,
      PROTOTYPE_RULESET,
      { id, now: new Date("2026-01-01T00:00:00.000Z") },
    );
    await repository.create(deck, emptyDeckHistory());
  } finally {
    repository.close();
  }
}

describe("Tokens in the shared runtime catalog", () => {
  it("are never offered by the editor's catalog", async () => {
    await seedDeck("d-token");
    render(DeckEditorApp, { deckId: deckId("d-token"), onnavigate: vi.fn() });
    await waitFor(() =>
      expect(document.querySelector('[data-cy="deck-catalog"]')).not.toBeNull(),
    );

    expect(
      document.querySelector(
        `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${SHEEP_TOKEN_CODE}"]`,
      ),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-result-count"]')
        ?.textContent,
    ).toBe(`${PROTOTYPE_CATALOG.length - 1} results`);
  });
});
