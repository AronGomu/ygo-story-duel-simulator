// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/prototypes/deck-builder/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import type { DeckCommand } from "../../../src/decks/deck-model.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

function props(onmutate: (command: DeckCommand) => void, mainCount = 0) {
  return {
    state: stateFixture(mainCount),
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    onlibrary: vi.fn(),
    onrename: vi.fn(),
    onmutate,
    onundo: vi.fn(),
    onredo: vi.fn(),
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  };
}

describe("pointer deck editing", () => {
  it("drags catalog cards only to their canonical target", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    render(DeckEditor, props(onmutate));
    await fireEvent.dragStart(
      screen.getByRole("button", { name: /Blue-Eyes White Dragon/ }),
    );
    await fireEvent.drop(
      screen.getByRole("group", { name: "Main Deck drop area" }),
    );
    expect(onmutate).toHaveBeenCalledWith({ type: "add", cardCode: 89631139 });
  });

  it("moves deck cards to Side and exposes a Remove target", async () => {
    const onmutate = vi.fn<(command: DeckCommand) => void>();
    render(DeckEditor, props(onmutate, 1));
    const cardButtons = screen.getAllByRole("button", {
      name: /copies in deck/,
    });
    const deckCard = cardButtons.at(-1)!;
    await fireEvent.dragStart(deckCard);
    await fireEvent.drop(
      screen.getByRole("group", { name: "Side Deck drop area" }),
    );
    expect(onmutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "move", from: "main", to: "side" }),
    );
    await fireEvent.dragStart(deckCard);
    await fireEvent.drop(
      screen.getByRole("button", { name: "Remove picked card" }),
    );
    expect(onmutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "remove", zone: "main" }),
    );
  });
});
