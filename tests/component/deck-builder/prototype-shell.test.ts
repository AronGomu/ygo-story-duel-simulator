// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import DeckBuilderPrototype from "../../../src/prototypes/deck-builder/DeckBuilderPrototype.svelte";
import { PROTOTYPE_DECK_DATABASE_NAME } from "../../../src/decks/indexeddb-deck-repository.ts";

afterEach(async () => {
  cleanup();
  await deleteDB(PROTOTYPE_DECK_DATABASE_NAME);
});

describe("DeckBuilderPrototype", () => {
  it("loads isolated storage then falls back to Deck Library", async () => {
    render(DeckBuilderPrototype);
    expect(
      screen.getByRole("heading", { name: /Loading local decks/i }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Deck Library" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Session status/i)).toBeNull();
  });
});
