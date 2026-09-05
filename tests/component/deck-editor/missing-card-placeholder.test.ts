// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import CardTile from "../../../src/deck-editor/components/CardTile.svelte";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { stateFixture } from "../../fixtures/deck-editor.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";

installPrototypeActiveCatalog();

afterEach(() => cleanup());

describe("missing-card placeholder", () => {
  it("retains the card code without inventing card metadata", () => {
    const { container } = render(CardTile, {
      card: null,
      code: 99999999,
      limit: 3,
      currentCopies: 1,
      dataCyPrefix: "catalog",
      dataCyId: 99999999,
    });
    expect(
      screen.getByRole("button", { name: /Missing card 99999999/ }),
    ).toBeTruthy();
    expect(container.querySelector(".missing")).toBeTruthy();
    expect(container.textContent).not.toContain("Blue-Eyes");
  });

  it("adding and hovering a card with missing art cannot poison later previews", async () => {
    const state = stateFixture(1);
    const missingCode = state.current!.deck.main[0]!;
    const validCard = PROTOTYPE_CATALOG.find(
      (card) =>
        card.code !== missingCode &&
        quantityLimit(PROTOTYPE_RULESET, card.code) > 0,
    )!;
    const cards = PROTOTYPE_CATALOG.map((card) => ({
      ...card,
      imageUrl:
        card.code === missingCode
          ? "/cards/missing.jpg"
          : card.code === validCard.code
            ? "/cards/valid.jpg"
            : card.imageUrl,
    }));
    const onmutate = vi.fn();
    const { container } = render(DeckEditor, {
      state,
      cards,
      catalog: new Map(cards.map((card) => [card.code, card])),
      ruleset: PROTOTYPE_RULESET,
      returnLabel: "Deck Selection",
      onreturn: vi.fn(),
      onrename: vi.fn(),
      onmutate,
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    const results = container.querySelector(
      '[data-cy="deck-catalog-results"]',
    )!;
    const missingCatalogTile = results.querySelector(
      `[data-cy="catalog-tile-${missingCode}"]`,
    )!;
    const validCatalogTile = results.querySelector(
      `[data-cy="catalog-tile-${validCard.code}"]`,
    )!;

    await fireEvent.mouseEnter(missingCatalogTile);
    const failedImage = container.querySelector<HTMLImageElement>(
      '[data-cy="card-preview-image"]',
    )!;
    await fireEvent.error(failedImage);
    expect(
      container.querySelector('[data-cy="card-preview-image-placeholder"]'),
    ).not.toBeNull();

    await fireEvent.dblClick(missingCatalogTile);
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: missingCode,
      zone: "main",
    });
    await fireEvent.mouseLeave(results);
    await fireEvent.mouseEnter(
      container.querySelector('[data-cy="deck-slot-main-0"] button')!,
    );
    await tick();
    expect(
      container.querySelector('[data-cy="card-preview-image-placeholder"]'),
    ).not.toBeNull();

    await fireEvent.mouseEnter(validCatalogTile);
    await tick();
    expect(
      container
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe("/cards/valid.jpg");
  });
});
