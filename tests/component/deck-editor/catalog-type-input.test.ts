// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
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

    await user.clear(input);
    await user.type(input, "spell");
    expect(screen.queryByRole("option", { name: /Family: Spell/ })).toBeNull();
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    await user.clear(input);
    await user.type(input, "effect");
    await user.click(screen.getByRole("option", { name: /Subtype: Effect/ }));
    expect(onchange).toHaveBeenLastCalledWith([OPTIONS[1], OPTIONS[2]]);
  });
});
