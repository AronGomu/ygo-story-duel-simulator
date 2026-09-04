// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import type { DeckBuilderState } from "../../../src/deck-editor/deck-editor-store.ts";
import type { DeckCommand } from "../../../src/decks/deck-model.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";

afterEach(() => cleanup());

const MAIN_CODE = PROTOTYPE_CATALOG.find(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
)!.code;
const EXTRA_CODE = PROTOTYPE_CATALOG.find(
  (card) => card.canonicalZone === "extra",
)!.code;
/* A second Main-deck card, so a repeated-code deck still has a neighbour that
   proves the wrong tile was not the one that moved. */
const EXTRA_MAIN_CODE = PROTOTYPE_CATALOG.find(
  (card) =>
    card.canonicalZone === "main" &&
    card.code !== MAIN_CODE &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
)!.code;

function stateWithMain(main: readonly number[]): DeckBuilderState {
  const base = stateFixture(0);
  return {
    ...base,
    current: {
      deck: { ...base.current!.deck, main },
      history: base.current!.history,
    },
  };
}

function stateWithExtra(): DeckBuilderState {
  const base = stateFixture(0);
  return {
    ...base,
    current: {
      deck: { ...base.current!.deck, extra: [EXTRA_CODE] },
      history: base.current!.history,
    },
  };
}

function props(
  onmutate: (command: DeckCommand) => void,
  state = stateFixture(0),
) {
  return {
    state,
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    layoutMode: "panels" as const,
    returnLabel: "Deck Selection",
    onreturn: vi.fn(),
    onrename: vi.fn(),
    onmutate,
    onundo: vi.fn(),
    onredo: vi.fn(),
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  };
}

describe("desktop click editing", () => {
  it("single-clicking a main-deck card only selects it", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate, stateFixture(1)));
    const tile = container.querySelector(
      '[data-cy="deck-slot-main-0"] button',
    )!;
    await fireEvent.click(tile);
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(onmutate).not.toHaveBeenCalled();
  });

  /* Two copies of one card are two tiles, and the double-click has to mean the
     tile under the pointer: naming only the code removes the first copy and
     leaves the clicked one on screen, destroying the order ADR-037 preserves. */
  it("double-clicking the third tile of a repeated card removes that copy", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(
      DeckEditor,
      props(onmutate, stateWithMain([MAIN_CODE, EXTRA_MAIN_CODE, MAIN_CODE])),
    );
    await fireEvent.dblClick(
      container.querySelector('[data-cy="deck-slot-main-2"] button')!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "remove",
      cardCode: MAIN_CODE,
      zone: "main",
      index: 2,
    });
  });

  it("double-clicking an extra-deck card removes it", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate, stateWithExtra()));
    await fireEvent.dblClick(
      container.querySelector('[data-cy="deck-slot-extra-0"] button')!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "remove",
      cardCode: EXTRA_CODE,
      zone: "extra",
      index: 0,
    });
  });

  it("double-clicking a catalog card adds it", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate));
    await fireEvent.dblClick(
      container.querySelector(
        `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_CODE}"]`,
      )!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: MAIN_CODE,
      zone: "main",
    });
  });

  it("catalog activation always adds to the canonical zone", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate));
    expect(
      container.querySelector('[data-cy="deck-catalog-to-sideboard-field"]'),
    ).toBeNull();
    await fireEvent.dblClick(
      container.querySelector(
        `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_CODE}"]`,
      )!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: MAIN_CODE,
      zone: "main",
    });
  });
  it("a catalog card can be dropped on the Side Deck", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate));
    await fireEvent.click(
      container.querySelector('[data-cy="deck-zone-toggle-side"]')!,
    );
    await fireEvent.dragStart(
      container.querySelector(
        `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_CODE}"]`,
      )!,
    );
    expect(
      container
        .querySelector('[data-cy="deck-zone-drop-area-side"]')!
        .classList.contains("allowed"),
    ).toBe(true);
    await fireEvent.drop(
      container.querySelector('[data-cy="deck-zone-drop-area-side"]')!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: MAIN_CODE,
      zone: "side",
    });
  });
});
