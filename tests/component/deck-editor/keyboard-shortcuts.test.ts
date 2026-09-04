// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  pushDeckUpdate,
  undoDeckUpdate,
} from "../../../src/decks/deck-history.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";
import type { DeckBuilderState } from "../../../src/deck-editor/deck-editor-store.ts";

afterEach(() => cleanup());

function stateWithUndoHistory(): DeckBuilderState {
  const base = stateFixture(1);
  const deck = base.current!.deck;
  const history = pushDeckUpdate(base.current!.history, {
    deckId: deck.id,
    before: { main: [], extra: [], side: [] },
    after: { main: [deck.main[0]!], extra: [], side: [] },
    reason: "add",
  });
  return { ...base, current: { ...base.current!, history } };
}

function stateWithRedoHistory(): DeckBuilderState {
  const withUndo = stateWithUndoHistory();
  const result = undoDeckUpdate(withUndo.current!.history)!;
  return {
    ...withUndo,
    current: { ...withUndo.current!, history: result.history },
  };
}

function renderEditor(
  state: DeckBuilderState,
  onundo = vi.fn(),
  onredo = vi.fn(),
) {
  return render(DeckEditor, {
    state,
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    returnLabel: "Deck Selection",
    onreturn: vi.fn(),
    onrename: vi.fn(),
    onmutate: vi.fn(),
    onundo,
    onredo,
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  });
}

describe("keyboard shortcuts", () => {
  it("control+z undoes the last deck edit", async () => {
    const user = userEvent.setup();
    const onundo = vi.fn();
    renderEditor(stateWithUndoHistory(), onundo);
    screen.getByRole("button", { name: "Duplicate" }).focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(onundo).toHaveBeenCalledOnce();
  });

  it("control+y redoes the undone edit", async () => {
    const user = userEvent.setup();
    const onredo = vi.fn();
    renderEditor(stateWithRedoHistory(), vi.fn(), onredo);
    screen.getByRole("button", { name: "Duplicate" }).focus();
    await user.keyboard("{Control>}y{/Control}");
    expect(onredo).toHaveBeenCalledOnce();
  });

  it("control+shift+z also redoes", async () => {
    const user = userEvent.setup();
    const onredo = vi.fn();
    renderEditor(stateWithRedoHistory(), vi.fn(), onredo);
    screen.getByRole("button", { name: "Duplicate" }).focus();
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(onredo).toHaveBeenCalledOnce();
  });

  it("control+z inside the deck name input leaves the deck untouched", async () => {
    const user = userEvent.setup();
    const onundo = vi.fn();
    renderEditor(stateWithUndoHistory(), onundo);
    await user.click(screen.getByRole("textbox", { name: "Deck name" }));
    await user.keyboard("{Control>}z{/Control}");
    expect(onundo).not.toHaveBeenCalled();
  });
});
