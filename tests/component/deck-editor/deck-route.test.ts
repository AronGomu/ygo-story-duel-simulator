// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import DeckEditorApp, {
  type DeckEditorRoute,
} from "../../../src/deck-editor/index.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { deckId, type DeckId } from "../../../src/decks/deck-contracts.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { DECK_DATABASE_NAME } from "../../../src/decks/deck-database.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import { prototypeCatalogMap } from "../../fixtures/deck-editor.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";

installPrototypeActiveCatalog();

afterEach(async () => {
  cleanup();
  await deleteDB(DECK_DATABASE_NAME);
});

/* The route is the only input the shell gives the domain, so every case here
   drives it exactly as `AppShell` does: a `deckId` prop plus an `onnavigate`
   callback the shell turns into a hash write. */
function mount(id: DeckId | null, onnavigate = vi.fn()) {
  const result = render(DeckEditorApp, { deckId: id, onnavigate });
  return { ...result, onnavigate };
}

async function seedDeck(id: string, name: string): Promise<DeckId> {
  const repository = await IndexedDbDeckRepository.open();
  try {
    const deck = createBlankDeck(name, prototypeCatalogMap, PROTOTYPE_RULESET, {
      id,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await repository.create(deck, emptyDeckHistory());
    return deck.id;
  } finally {
    repository.close();
  }
}

function query(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-cy="${name}"]`);
}

describe("deck editor route binding", () => {
  it("opens the library for #/decks", async () => {
    await seedDeck("d1", "Library Deck");
    mount(null);
    await waitFor(() => expect(query("deck-library")).not.toBeNull());
    expect(query("deck-name-input")).toBeNull();
    expect(
      await screen.findByRole("button", { name: /^Select Library Deck,/ }),
    ).toBeTruthy();
  });

  it("opens the deck named by #/decks/:deckId", async () => {
    await seedDeck("d1", "Deep Link Deck");
    mount(deckId("d1"));
    await waitFor(() => expect(query("deck-name-input")).not.toBeNull());
    expect((query("deck-name-input") as HTMLInputElement).value).toBe(
      "Deep Link Deck",
    );
    expect(query("deck-library")).toBeNull();
  });

  /* Reported rather than linked: the way back is the library of whichever deck
     world this mount was bound to, and only the shell knows its URL. */
  it("shows a typed not-found state with a way back to the library", async () => {
    const { onnavigate } = mount(deckId("missing"));
    await waitFor(() => expect(query("deck-not-found")).not.toBeNull());
    expect(query("deck-name-input")).toBeNull();

    await userEvent.setup().click(query("deck-not-found-back")!);

    expect(onnavigate).toHaveBeenCalledWith<[DeckEditorRoute]>({
      deckId: null,
    });
  });

  it("pushes the deck route when a library deck is opened", async () => {
    await seedDeck("d1", "Pushed Deck");
    const { onnavigate } = mount(null);
    /* A deck this short of cards cannot be picked, so its kebab is the way in
       — which is the point: an illegal deck is opened to be repaired. */
    await waitFor(() => expect(query("deck-tile-menu-d1")).not.toBeNull());
    const user = userEvent.setup();
    await user.click(query("deck-tile-menu-d1")!);
    await user.click(query("deck-tile-menu-open-d1")!);
    await waitFor(() =>
      expect(onnavigate).toHaveBeenCalledWith<[DeckEditorRoute]>({
        deckId: deckId("d1"),
      }),
    );
  });

  it("returns to the library when the route goes back to #/decks", async () => {
    await seedDeck("d1", "Back Deck");
    const { rerender } = mount(deckId("d1"));
    await waitFor(() => expect(query("deck-name-input")).not.toBeNull());
    await rerender({ deckId: null });
    await waitFor(() => expect(query("deck-library")).not.toBeNull());
    expect(query("deck-name-input")).toBeNull();
  });
});
