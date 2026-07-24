// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/prototypes/deck-builder/components/DeckEditor.svelte";
import DeckLibrary from "../../../src/prototypes/deck-builder/components/DeckLibrary.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("deck builder accessibility", () => {
  it("provides labels, visible semantics, keyboard shortcuts, and non-color limit text", () => {
    render(DeckEditor, {
      state: stateFixture(),
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      onlibrary: vi.fn(),
      onrename: vi.fn(),
      onmutate: vi.fn(),
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    expect(screen.getByRole("searchbox", { name: "Name" })).toBeTruthy();
    expect(screen.getByLabelText("Card type")).toBeTruthy();
    expect(screen.getByLabelText("Subtype")).toBeTruthy();
    expect(screen.getByLabelText("Attribute")).toBeTruthy();
    expect(screen.getByLabelText("Monster type")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Obelisk.*Forbidden, maximum 0/i }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Undo" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Control+Z");
  });

  it("moves focus from validation issue to affected zone", async () => {
    const user = userEvent.setup();
    render(DeckEditor, {
      state: stateFixture(),
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      onlibrary: vi.fn(),
      onrename: vi.fn(),
      onmutate: vi.fn(),
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    await user.click(
      screen.getByRole("button", { name: /Main Deck needs 40 more/ }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Main Deck" }),
    );
  });

  it("traps dialog focus, closes with Escape, and restores its opener", async () => {
    const user = userEvent.setup();
    render(DeckLibrary, {
      decks: [],
      oncreate: vi.fn(),
      onopen: vi.fn(),
      onrename: vi.fn(),
      onduplicate: vi.fn(),
      ondelete: vi.fn(),
      onexport: vi.fn(),
      onimport: vi.fn(),
    });
    const opener = screen.getByRole("button", { name: "Create deck" });
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
