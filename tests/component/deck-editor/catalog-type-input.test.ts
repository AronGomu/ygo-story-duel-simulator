// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CatalogTypeInput from "../../../src/deck-editor/components/CatalogTypeInput.svelte";
import type { CatalogTypeTag } from "../../../src/decks/catalog/deck-catalog.ts";

const OPTIONS: readonly CatalogTypeTag[] = [
  {
    id: "family:monster",
    category: "family",
    value: "monster",
    label: "Monster",
  },
  { id: "family:spell", category: "family", value: "spell", label: "Spell" },
  {
    id: "subtype:Effect",
    category: "subtype",
    value: "Effect",
    label: "Effect",
  },
  { id: "attribute:DARK", category: "attribute", value: "DARK", label: "DARK" },
  {
    id: "race:Spellcaster",
    category: "race",
    value: "Spellcaster",
    label: "Spellcaster",
  },
];

const LONG_OPTIONS: readonly CatalogTypeTag[] = Array.from(
  { length: 40 },
  (_, index) => ({
    id: `subtype:item-${index}`,
    category: "subtype",
    value: `item-${index}`,
    label: `Item ${index}`,
  }),
);

afterEach(() => cleanup());

describe("CatalogTypeInput", () => {
  it("commits active suggestions with keyboard and removes last tag", async () => {
    const onchange = vi.fn();
    const { rerender } = render(CatalogTypeInput, {
      options: OPTIONS,
      value: [],
      onchange,
    });
    const input = screen.getByRole("combobox", { name: "Types" });
    const user = userEvent.setup();
    await user.type(input, "dar");
    await user.keyboard("{Enter}");
    expect(onchange).toHaveBeenLastCalledWith([OPTIONS[3]]);

    await rerender({ options: OPTIONS, value: [OPTIONS[3]!], onchange });
    expect(
      screen.getByRole("button", { name: "Remove DARK type" }),
    ).toBeTruthy();
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(onchange).toHaveBeenLastCalledWith([]);
  });

  it("supports arrows, click, Escape, invalid text, and duplicate rejection", async () => {
    const onchange = vi.fn();
    const { rerender } = render(CatalogTypeInput, {
      options: OPTIONS,
      value: [],
      onchange,
    });
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Types" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange.mock.calls[0]![0]).toEqual([OPTIONS[1]]);

    await rerender({ options: OPTIONS, value: [OPTIONS[1]!], onchange });
    await user.clear(input);
    await user.type(input, "not-a-type{Enter}");
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No matching types")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    await user.clear(input);
    await user.type(input, "effect");
    await user.click(screen.getByRole("option", { name: /Subtype: Effect/ }));
    expect(onchange).toHaveBeenLastCalledWith([OPTIONS[1], OPTIONS[2]]);

    await rerender({
      options: OPTIONS,
      value: [OPTIONS[1]!, OPTIONS[2]!],
      onchange,
    });
    await user.click(input);
    await user.clear(input);
    await user.type(input, "effect");
    await user.keyboard("{Enter}");
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it("keeps long-list keyboard focus visible without trapping Tab", async () => {
    const onchange = vi.fn();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      render(CatalogTypeInput, {
        options: LONG_OPTIONS,
        value: [],
        onchange,
      });
      const user = userEvent.setup();
      const input = screen.getByRole("combobox", { name: "Types" });
      await user.click(input);

      for (let index = 0; index < 20; index += 1)
        await user.keyboard("{ArrowDown}");

      await waitFor(() =>
        expect(input.getAttribute("aria-activedescendant")).toBe(
          "deck-catalog-type-option-subtype-item-19",
        ),
      );
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(
        scrollIntoView.mock.calls.some(
          ([options]) => options?.block === "nearest",
        ),
      ).toBe(true);

      await user.keyboard("{ArrowUp}");
      await waitFor(() =>
        expect(input.getAttribute("aria-activedescendant")).toBe(
          "deck-catalog-type-option-subtype-item-18",
        ),
      );
      await user.tab();
      expect(document.activeElement).not.toBe(input);
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });
});
