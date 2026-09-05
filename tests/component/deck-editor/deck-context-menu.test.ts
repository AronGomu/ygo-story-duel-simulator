// @vitest-environment jsdom

import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/svelte";
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

const MAIN_LIMIT_3_CODES = PROTOTYPE_CATALOG.filter(
  (c) =>
    c.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, c.code) === 3,
).map((c) => c.code);

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

function stateWith(mainCount: number, sideCount: number): DeckBuilderState {
  const base = stateFixture(mainCount);
  const sideCards = Array.from(
    { length: sideCount },
    (_, i) => MAIN_LIMIT_3_CODES[i % MAIN_LIMIT_3_CODES.length]!,
  );
  return {
    ...base,
    current: {
      deck: { ...base.current!.deck, side: sideCards },
      history: base.current!.history,
    },
  };
}

function props(
  onmutate: (command: DeckCommand) => void,
  state = stateFixture(0),
  onsetillustration = vi.fn<(code: number) => void>(),
) {
  return {
    state,
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    returnLabel: "Deck Selection",
    onreturn: vi.fn(),
    onrename: vi.fn(),
    onmutate,
    onsetillustration,
    onundo: vi.fn(),
    onredo: vi.fn(),
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  };
}

describe("context-menu deck editing", () => {
  it("right-click opens card actions and sets the card as illustration", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const onsetillustration = vi.fn<(code: number) => void>();
    const state = stateFixture(1);
    const code = state.current!.deck.main[0]!;
    const { container } = render(
      DeckEditor,
      props(onmutate, state, onsetillustration),
    );
    const deckCard = container.querySelector(
      '[data-cy="deck-slot-main-0"] button',
    )!;

    await fireEvent.contextMenu(deckCard, { clientX: 40, clientY: 60 });
    expect(onmutate).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-cy="deck-card-context-menu"]'),
    ).not.toBeNull();

    await fireEvent.click(
      container.querySelector(
        '[data-cy="deck-card-context-set-illustration"]',
      )!,
    );
    expect(onsetillustration).toHaveBeenCalledWith(code);
  });

  it("Shift+F10 opens card actions and Escape restores tile focus", async () => {
    const { container } = render(DeckEditor, props(vi.fn(), stateFixture(1)));
    const deckCard = container.querySelector(
      '[data-cy="deck-slot-main-0"] button',
    ) as HTMLButtonElement;
    deckCard.focus();

    await fireEvent.keyDown(deckCard, { key: "F10", shiftKey: true });
    expect(
      container.querySelector('[data-cy="deck-card-context-menu"]'),
    ).not.toBeNull();
    await fireEvent.keyDown(
      container.querySelector('[data-cy="deck-card-context-menu"]')!,
      { key: "Escape" },
    );
    expect(
      container.querySelector('[data-cy="deck-card-context-menu"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(deckCard);
  });

  it("context-menu removal still targets the clicked repeated copy", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const repeated = MAIN_LIMIT_3_CODES[0]!;
    const { container } = render(
      DeckEditor,
      props(
        onmutate,
        stateWithMain([repeated, MAIN_LIMIT_3_CODES[1]!, repeated]),
      ),
    );
    await fireEvent.contextMenu(
      container.querySelector('[data-cy="deck-slot-main-2"] button')!,
    );
    await fireEvent.click(
      container.querySelector('[data-cy="deck-card-context-remove"]')!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "remove",
      cardCode: repeated,
      zone: "main",
      index: 2,
    });
  });

  it("right-click on a catalog card adds it to its canonical zone", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate));
    const catalogTile = container.querySelector(
      `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_LIMIT_3_CODES[0]!}"]`,
    )!;
    await fireEvent.contextMenu(catalogTile);
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: MAIN_LIMIT_3_CODES[0]!,
      zone: "main",
    });
  });

  it("right-click on a catalog card with a full canonical deck does not add to Side", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(DeckEditor, props(onmutate, stateFixture(60)));
    const catalogTile = container.querySelector(
      `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_LIMIT_3_CODES[0]!}"]`,
    )!;
    await fireEvent.contextMenu(catalogTile);
    expect(onmutate).not.toHaveBeenCalled();
  });

  it("right-click adds nothing when side is also full", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    const { container } = render(
      DeckEditor,
      props(onmutate, stateWith(60, 15)),
    );
    const catalogTile = container.querySelector(
      `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${MAIN_LIMIT_3_CODES[0]!}"]`,
    )!;
    await fireEvent.contextMenu(catalogTile);
    expect(onmutate).not.toHaveBeenCalled();
  });

  it("the browser context menu is suppressed on tiles", async () => {
    const { container } = render(DeckEditor, props(vi.fn()));
    const catalogTile = container.querySelector(
      '[data-cy="deck-catalog-results"] button',
    )!;
    const event = createEvent.contextMenu(catalogTile);
    fireEvent(catalogTile, event);
    expect(event.defaultPrevented).toBe(true);
  });
});
