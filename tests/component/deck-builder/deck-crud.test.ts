// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckLibrary from "../../../src/prototypes/deck-builder/components/DeckLibrary.svelte";
import { deckFixture } from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("Deck Library CRUD", () => {
  it("creates blank decks and confirms named deletion", async () => {
    const user = userEvent.setup();
    const deck = deckFixture();
    const oncreate = vi.fn();
    const ondelete = vi.fn();
    render(DeckLibrary, {
      decks: [deck],
      oncreate,
      onopen: vi.fn(),
      onrename: vi.fn(),
      onduplicate: vi.fn(),
      ondelete,
      onexport: vi.fn(),
      onimport: vi.fn(),
    });
    await user.click(screen.getByRole("button", { name: "Create deck" }));
    await user.type(screen.getByLabelText("Deck name"), "Blank first");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(oncreate).toHaveBeenCalledWith("Blank first");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("heading", { name: `Delete ${deck.name}?` }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: `Delete ${deck.name}` }),
    );
    expect(ondelete).toHaveBeenCalledWith(deck);
  });

  it("routes rename, duplicate, and export through explicit actions", async () => {
    const user = userEvent.setup();
    const deck = deckFixture();
    const onrename = vi.fn();
    const onduplicate = vi.fn();
    const onexport = vi.fn();
    render(DeckLibrary, {
      decks: [deck],
      oncreate: vi.fn(),
      onopen: vi.fn(),
      onrename,
      onduplicate,
      ondelete: vi.fn(),
      onexport,
      onimport: vi.fn(),
    });
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onduplicate).toHaveBeenCalledWith(deck.id);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onexport).toHaveBeenCalledWith(deck);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Deck name");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getAllByRole("button", { name: "Rename" }).at(-1)!);
    expect(onrename).toHaveBeenCalledWith(deck, "Renamed");
  });
});
