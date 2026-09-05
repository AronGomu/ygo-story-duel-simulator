// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import DeckLibrary from "../../../src/deck-editor/components/DeckLibrary.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";

afterEach(() => cleanup());

describe("deck builder accessibility", () => {
  it("provides labels, visible semantics, keyboard shortcuts, and non-color limit text", async () => {
    render(DeckEditor, {
      state: stateFixture(),
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      returnLabel: "Deck Selection",
      onreturn: vi.fn(),
      onrename: vi.fn(),
      onmutate: vi.fn(),
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    const catalogNameInput = screen.getByRole("searchbox", { name: "Name" });
    expect(catalogNameInput).toBeTruthy();
    expect(document.activeElement).toBe(catalogNameInput);
    const deckNameInput = screen.getByRole("textbox", { name: "Deck name" });
    expect(deckNameInput.getAttribute("placeholder")).toBe("Deck name");
    expect(
      document.querySelector('[data-cy="deck-editor-name-label"]'),
    ).toBeNull();
    expect(await screen.findByRole("combobox", { name: "Types" })).toBeTruthy();
    expect(
      document.querySelector('[data-cy="deck-catalog-name-label"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-family-field"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-subtype-field"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-attribute-field"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-race-field"]'),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Obelisk.*Forbidden, maximum 0/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Advanced Search" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Undo" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Control+Z");
  });

  it("opens exact zone issues from the focusable indicator", async () => {
    render(DeckEditor, {
      state: stateFixture(),
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      returnLabel: "Deck Selection",
      onreturn: vi.fn(),
      onrename: vi.fn(),
      onmutate: vi.fn(),
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    const indicator = screen.getByRole("button", {
      name: "Main Deck has 1 validation error",
    });
    indicator.focus();
    expect(document.activeElement).toBe(indicator);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Main Deck needs 40 more card(s).",
    );
  });

  it("traps dialog focus, closes with Escape, and restores its opener", async () => {
    const user = userEvent.setup();
    render(DeckLibrary, {
      decks: [],
      oncreate: vi.fn(),
      onopen: vi.fn(),
      onimport: vi.fn(),
    });
    const opener = screen.getByRole("button", { name: "Create blank deck" });
    await user.click(opener);
    const input = screen.getByLabelText("Deck name");
    expect(document.activeElement).toBe(input);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
