// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";

installPrototypeActiveCatalog();

afterEach(() => cleanup());

function renderEditor(
  mainCount = 0,
  cards = PROTOTYPE_CATALOG,
  catalog = prototypeCatalogMap,
) {
  return render(DeckEditor, {
    state: stateFixture(mainCount),
    cards,
    catalog,
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
}

function catalogTiles(): HTMLElement[] {
  const results = document.querySelector('[data-cy="deck-catalog-results"]')!;
  return Array.from(results.querySelectorAll('[data-cy^="catalog-tile-"]'));
}

describe("editor preview pane", () => {
  it("the preview pane renders the shared duel panel", () => {
    renderEditor();
    expect(
      document.querySelector('[data-cy="card-preview-panel"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="deck-card-details"]')).toBeNull();
  });

  it("hovering a catalog tile previews it", async () => {
    renderEditor();
    const [tile] = catalogTiles();
    const code = Number(tile!.dataset.cardCode);
    const card = prototypeCatalogMap.get(code)!;
    fireEvent.mouseEnter(tile!);
    await tick();
    expect(
      document.querySelector('[data-cy="card-preview-name"]')?.textContent,
    ).toContain(card.name);
  });

  it("leaving the catalog restores the selected card", async () => {
    const user = userEvent.setup();
    renderEditor();
    const results = document.querySelector('[data-cy="deck-catalog-results"]')!;
    const [tileA, tileB] = catalogTiles();
    const codeA = Number(tileA!.dataset.cardCode);
    const cardA = prototypeCatalogMap.get(codeA)!;

    await user.click(tileA!);
    fireEvent.mouseEnter(tileB!);
    await tick();
    fireEvent.mouseLeave(results);
    await tick();

    expect(
      document.querySelector('[data-cy="card-preview-name"]')?.textContent,
    ).toContain(cardA.name);
  });

  it("recovers valid preview art after a catalog image fails", async () => {
    const cards = PROTOTYPE_CATALOG.map((card, index) => ({
      ...card,
      imageUrl:
        index === 1
          ? "/cards/missing.jpg"
          : index === 2
            ? "/cards/valid.jpg"
            : card.imageUrl,
    }));
    renderEditor(0, cards, new Map(cards.map((card) => [card.code, card])));
    const results = document.querySelector('[data-cy="deck-catalog-results"]')!;
    const missingTile = results.querySelector(
      `[data-cy="catalog-tile-${cards[1]!.code}"]`,
    )!;
    const validTile = results.querySelector(
      `[data-cy="catalog-tile-${cards[2]!.code}"]`,
    )!;

    fireEvent.mouseEnter(missingTile);
    await tick();
    const failedImage = document.querySelector<HTMLImageElement>(
      '[data-cy="card-preview-image"]',
    )!;
    expect(failedImage.getAttribute("src")).toBe("/cards/missing.jpg");
    await fireEvent.error(failedImage);
    expect(
      document.querySelector('[data-cy="card-preview-image-placeholder"]'),
    ).not.toBeNull();

    fireEvent.mouseEnter(validTile);
    await tick();

    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe("/cards/valid.jpg");
  });

  it("panes read preview, deck, catalog left to right", () => {
    renderEditor();
    const preview = document.querySelector('[data-cy="card-preview-panel"]')!;
    const workspace = document.querySelector('[data-cy="deck-workspace"]')!;
    const catalog = document.querySelector('[data-cy="deck-catalog"]')!;
    expect(
      preview.compareDocumentPosition(workspace) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      workspace.compareDocumentPosition(catalog) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
