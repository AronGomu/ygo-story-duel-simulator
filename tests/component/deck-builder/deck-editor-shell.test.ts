// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/prototypes/deck-builder/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

function renderEditor(mainCount = 0) {
  return render(DeckEditor, {
    state: stateFixture(mainCount),
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
}

describe("DeckEditor shell", () => {
  it("renders fixed Catalog, Deck, pinned Details topology", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "Find cards" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Build deck" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Select a card" })).toBeTruthy();
    expect(screen.getByLabelText("Deck counts").textContent).toContain(
      "Main 0",
    );
    expect(
      screen.queryByRole("button", { name: /Use deck|Select deck/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /compact|list view/i }),
    ).toBeNull();
  });

  it("keeps save state separate from deck validity", () => {
    renderEditor();
    expect(screen.getByText("Saved locally")).toBeTruthy();
    expect(screen.getByText("errors")).toBeTruthy();
  });
});
