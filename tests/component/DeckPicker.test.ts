// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckPicker from "../../src/battle/app/components/DeckPicker.svelte";
import type { SelectableDeck } from "../../src/battle/decks/selectable-decks.ts";
import { deckId } from "../../src/decks/index.ts";
import { DECK_CATALOG } from "../../src/battle/duel/presets/deck-catalog.ts";

afterEach(() => cleanup());

/* The picker never reads the card lists — it only shows the label and reports
   the key — so every list here is left empty on purpose. */
const NO_CARDS = { main: [], extra: [], side: [] };

const PRESET_DECKS: readonly SelectableDeck[] = DECK_CATALOG.map((preset) => ({
  key: `preset:${preset.id}`,
  label: preset.name,
  source: "preset",
  selection: { kind: "preset", deckId: preset.id },
  lists: NO_CARDS,
  updatedAt: null,
}));

const LOCAL_DECK: SelectableDeck = {
  key: "local:built-deck:2",
  label: "Built Deck",
  source: "local",
  lists: NO_CARDS,
  updatedAt: "2026-08-01T00:00:00.000Z",
  selection: {
    kind: "local",
    deck: {
      ref: { type: "local", deckId: deckId("built-deck"), revision: 2 },
      name: "Built Deck",
      validationDigest: "fnv1a-0",
      main: [],
      extra: [],
      side: [],
    },
  },
};

function renderPicker(overrides: Record<string, unknown> = {}) {
  return render(DeckPicker, {
    decks: PRESET_DECKS,
    playerKey: "preset:chapter-one-starter",
    ...overrides,
  });
}

function query(value: string): HTMLElement | null {
  return document.querySelector(`[data-cy="${value}"]`);
}

function playerSelect(): HTMLSelectElement {
  return query("deck-picker-player-select") as HTMLSelectElement;
}

describe("DeckPicker", () => {
  it("renders one option per deck under its own group", () => {
    renderPicker({ decks: [...PRESET_DECKS, LOCAL_DECK] });

    expect(
      document.querySelectorAll('[data-cy^="deck-picker-option-"]'),
    ).toHaveLength(3);
    expect(query("deck-picker-group-preset")?.getAttribute("label")).toBe(
      "Bundled decks",
    );
    expect(query("deck-picker-group-local")?.getAttribute("label")).toBe(
      "Your decks",
    );
    expect(query("deck-picker-option-local:built-deck:2")?.textContent).toBe(
      "Built Deck",
    );
  });

  it("pre-selects the deck the host chose", () => {
    renderPicker();

    expect(playerSelect().value).toBe("preset:chapter-one-starter");
  });

  it("the filter narrows the deck options", async () => {
    const user = userEvent.setup();
    renderPicker({
      decks: [...PRESET_DECKS, LOCAL_DECK],
      playerKey: "preset:chapter-one-practice",
    });

    await user.type(
      query("deck-picker-filter") as HTMLInputElement,
      "Practice",
    );

    expect(
      query("deck-picker-option-preset:chapter-one-practice"),
    ).not.toBeNull();
    expect(query("deck-picker-option-preset:chapter-one-starter")).toBeNull();
    expect(query("deck-picker-option-local:built-deck:2")).toBeNull();
    expect(query("deck-picker-no-matches")).toBeNull();
  });

  /* Filtering is a view over the list, never a change of choice: hiding the
     chosen deck would leave a select with no selected option and a Start
     button that duels with a deck nobody can see. */
  it("keeps the chosen deck listed even when the filter excludes it", async () => {
    const user = userEvent.setup();
    renderPicker({ decks: [...PRESET_DECKS, LOCAL_DECK] });
    expect(playerSelect().value).toBe("preset:chapter-one-starter");

    await user.type(
      query("deck-picker-filter") as HTMLInputElement,
      "Practice",
    );

    expect(
      query("deck-picker-option-preset:chapter-one-starter"),
    ).not.toBeNull();
    expect(playerSelect().value).toBe("preset:chapter-one-starter");
    const matching = query(
      "deck-picker-option-preset:chapter-one-practice",
    ) as HTMLOptionElement;
    expect(matching).not.toBeNull();
    expect(matching.selected).toBe(false);
    expect(playerSelect().options).toHaveLength(2);
    expect(query("deck-picker-option-local:built-deck:2")).toBeNull();
  });

  it("reports that nothing matched while still showing the choice", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.type(query("deck-picker-filter") as HTMLInputElement, "zzz");

    expect(query("deck-picker-no-matches")).not.toBeNull();
    expect(
      document.querySelectorAll('[data-cy^="deck-picker-option-"]'),
    ).toHaveLength(1);
    expect(playerSelect().value).toBe("preset:chapter-one-starter");
  });

  it("choosing an option reports its key", async () => {
    const user = userEvent.setup();
    const onselect = vi.fn();
    renderPicker({ onselect });

    await user.selectOptions(playerSelect(), "preset:chapter-one-practice");

    expect(onselect).toHaveBeenCalledOnce();
    expect(onselect).toHaveBeenCalledWith("preset:chapter-one-practice");
  });

  it("the opponent seat is a fixed chapter-one-practice line", () => {
    renderPicker();

    expect(query("deck-picker-opponent-fixed")?.textContent?.trim()).toBe(
      "Opponent deck: Chapter 1 Practice (auto-assigned)",
    );
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-cy*="opponent-preset"]'),
    ).toHaveLength(0);
  });

  it("start reports once", async () => {
    const user = userEvent.setup();
    const onstart = vi.fn();
    renderPicker({ onstart });

    await user.click(query("deck-picker-start-button") as HTMLButtonElement);

    expect(onstart).toHaveBeenCalledOnce();
  });

  it("disabled blocks start and the deck controls", async () => {
    const user = userEvent.setup();
    const onstart = vi.fn();
    renderPicker({ disabled: true, onstart });
    const start = query("deck-picker-start-button") as HTMLButtonElement;

    expect(start.disabled).toBe(true);
    expect(playerSelect().disabled).toBe(true);
    await user.click(start);
    expect(onstart).not.toHaveBeenCalled();
  });

  it("hides the local group when no local deck qualifies", () => {
    renderPicker();

    expect(query("deck-picker-group-preset")).not.toBeNull();
    expect(query("deck-picker-group-local")).toBeNull();
    expect(query("deck-picker-start-button")).not.toBeNull();
  });

  it("shows the fallback notice only when the host asks for it", () => {
    const { rerender } = renderPicker();
    expect(query("deck-picker-fallback-notice")).toBeNull();

    rerender({ decks: PRESET_DECKS, fallbackNotice: true });
    expect(
      document.querySelectorAll('[data-cy="deck-picker-fallback-notice"]'),
    ).toHaveLength(1);
  });

  it("shows a start error as an assertive, recoverable message", () => {
    renderPicker({ startError: "That deck is no longer available." });
    const error = query("deck-picker-start-error");

    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent?.trim()).toBe(
      "That deck is no longer available.",
    );
    expect(
      (query("deck-picker-start-button") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
