// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckLibrary from "../../../src/prototypes/deck-builder/components/DeckLibrary.svelte";
import { deckFixture } from "../../fixtures/deck-builder.ts";
import { deckId } from "../../../src/decks/deck-contracts.ts";

afterEach(() => cleanup());

function callbacks() {
  return {
    oncreate: vi.fn(),
    onopen: vi.fn(),
    onrename: vi.fn(),
    onduplicate: vi.fn(),
    ondelete: vi.fn(),
    onexport: vi.fn(),
    onimport: vi.fn(),
  };
}

describe("DeckLibrary", () => {
  it("shows blank-first create/import empty state without selection UI", async () => {
    const values = callbacks();
    render(DeckLibrary, { decks: [], ...values });
    expect(
      screen.getByRole("heading", { name: "No local decks" }),
    ).toBeTruthy();
    expect(screen.queryByText(/template/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /select|use deck/i }),
    ).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Create blank deck" }));
    expect(
      screen.getByRole("heading", { name: "Create blank deck" }),
    ).toBeTruthy();
  });

  it("warns on duplicate names without conflating deck IDs", async () => {
    const values = callbacks();
    render(DeckLibrary, { decks: [deckFixture()], ...values });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create deck" }));
    await user.type(screen.getByLabelText("Deck name"), "Prototype Control");
    expect(screen.getByRole("status").textContent).toContain(
      "Another deck already uses this name",
    );
    expect(screen.getByRole("button", { name: /^Create$/ })).not.toHaveProperty(
      "disabled",
      true,
    );
  });

  it("searches by name and opens matching decks", async () => {
    const values = callbacks();
    const deck = deckFixture();
    render(DeckLibrary, {
      decks: [deck, { ...deck, id: deckId("other"), name: "Other" }],
      ...values,
    });
    await userEvent
      .setup()
      .type(
        screen.getByRole("searchbox", { name: "Search decks" }),
        "Prototype",
      );
    const matching = screen.getByRole("button", { name: /Prototype Control/ });
    expect(matching).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Other/ })).toBeNull();
    await userEvent.setup().click(matching);
    expect(values.onopen).toHaveBeenCalledWith(deck.id);
  });
});
