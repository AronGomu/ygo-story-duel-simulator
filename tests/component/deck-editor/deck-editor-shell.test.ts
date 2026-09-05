// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { readFileSync } from "fs";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import DeckEditorApp from "../../../src/deck-editor/index.ts";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { DECK_DATABASE_NAME } from "../../../src/decks/deck-database.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";

installPrototypeActiveCatalog();

const EDITOR_SOURCE = readFileSync(
  "src/deck-editor/components/DeckEditor.svelte",
  "utf8",
);
const APP_SOURCE = readFileSync("src/deck-editor/DeckEditorApp.svelte", "utf8");

afterEach(async () => {
  cleanup();
  await deleteDB(DECK_DATABASE_NAME);
});

function renderEditor(mainCount = 0, onreturn = vi.fn()) {
  const result = render(DeckEditor, {
    state: stateFixture(mainCount),
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    returnLabel: "Story",
    onreturn,
    onrename: vi.fn(),
    onmutate: vi.fn(),
    onundo: vi.fn(),
    onredo: vi.fn(),
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  });
  return { ...result, onreturn };
}

describe("DeckEditor shell", () => {
  it("renders fixed Catalog, Deck, Preview topology", () => {
    renderEditor();
    expect(
      document.querySelector('[data-cy="card-preview-panel"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-pane-details"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="deck-pane-deck"]')).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-pane-catalog"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Use deck|Select deck/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /compact|list view/i }),
    ).toBeNull();
  });

  it("owns stage height through parent grid tracks instead of header subtraction", () => {
    expect(APP_SOURCE).toMatch(
      /\.deck-editor-app\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(EDITOR_SOURCE).toMatch(
      /\.editor-root\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/s,
    );
    expect(EDITOR_SOURCE).not.toContain("--deck-editor-header-h");
    expect(EDITOR_SOURCE).not.toContain("height: calc(var(--stage-h");
  });

  it("gives the deck name the header's remaining width", () => {
    expect(EDITOR_SOURCE).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+repeat\(8,\s*auto\)/,
    );
    expect(EDITOR_SOURCE).toMatch(/\.name-field\s*\{[^}]*min-width:\s*0;/s);
    expect(EDITOR_SOURCE).toMatch(
      /\.name-field input\s*\{[^}]*width:\s*100%;/s,
    );
  });

  it("does not surface an empty Side warning from validated editor state", () => {
    const { container } = renderEditor();
    expect(
      container.querySelector('[data-cy="deck-zone-error-side"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-cy="deck-zone-error-extra"]'),
    ).not.toBeNull();
  });

  it("the header has name, action buttons and history controls without library", () => {
    renderEditor();
    expect(
      document.querySelector('[data-cy="deck-editor-library-link"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-name-input"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-duplicate"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-export"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-set-default"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-delete"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-undo"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-redo"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="deck-editor-counts"]')).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-validation-status"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-save-status"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-editor-import"]'),
    ).not.toBeNull();
  });

  it("renders a contextual return after the preview outside its panel", async () => {
    const { onreturn } = renderEditor();
    const preview = document.querySelector('[data-cy="card-preview-panel"]')!;
    const button = screen.getByRole("button", { name: "Return to Story" });
    const details = document.querySelector('[data-cy="deck-pane-details"]')!;

    expect(button.getAttribute("data-cy")).toBe("deck-editor-return");
    expect(button.classList.contains("danger")).toBe(true);
    expect(button.parentElement).toBe(details);
    expect(preview.parentElement).toBe(details);
    expect(
      preview.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.setup().click(button);
    expect(onreturn).toHaveBeenCalledOnce();
  });

  it("workspace and catalog render without decorative headings", () => {
    renderEditor();
    expect(
      document.querySelector('[data-cy="deck-workspace-titles"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-titles"]'),
    ).toBeNull();
  });

  it("shows the empty-catalog state from real filters, not a fixture switch", async () => {
    renderEditor();
    const search = screen.getByRole("searchbox", { name: "Name" });
    await userEvent.setup().type(search, "no-such-card");
    expect(
      screen.getByRole("heading", { name: "No matching cards" }),
    ).toBeTruthy();
  });
});

/* Ported from the deleted prototype-shell test: the domain root has to paint
   the loading skeleton off its own storage and settle on the library, with no
   reviewer harness anywhere in the tree. */
describe("DeckEditorApp boot", () => {
  it("loads isolated storage then falls back to Deck Library", async () => {
    render(DeckEditorApp, { deckId: null, onnavigate: vi.fn() });
    expect(
      screen.getByRole("heading", { name: /Loading local decks/i }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Deck library" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/Session status/i)).toBeNull();
    expect(screen.queryByText(/Prototype review states/i)).toBeNull();
  });
});
