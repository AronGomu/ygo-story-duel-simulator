// @vitest-environment jsdom

import { readFileSync } from "fs";
import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/deck-editor/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";

afterEach(() => cleanup());

const CATALOG_SOURCE = readFileSync(
  "src/deck-editor/components/CardCatalog.svelte",
  "utf8",
);

function resultsRegionDeclarations(): string {
  const body = /\.results-region\s*\{([^}]*)\}/.exec(CATALOG_SOURCE)?.[1];
  expect(
    body,
    "CardCatalog.svelte has no `.results-region` rule",
  ).toBeDefined();
  return body!.replace(/\s+/g, " ");
}

describe("CardCatalog", () => {
  it("combines compact Name and Types filters with AND", async () => {
    const user = userEvent.setup();
    render(CardCatalog, {
      cards: PROTOTYPE_CATALOG,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    const name = screen.getByRole("searchbox", { name: "Name" });
    expect(name.getAttribute("placeholder")).toBe("Name");
    expect(screen.getByRole("combobox", { name: "Types" })).toBeTruthy();
    expect(
      document.querySelector('[data-cy="deck-catalog-name-label"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-family-select"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-subtype-select"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-attribute-select"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-race-select"]'),
    ).toBeNull();

    await user.type(name, "dark");
    const types = screen.getByRole("combobox", { name: "Types" });
    await user.type(types, "spellcaster{Enter}");
    expect(screen.getByText("1 results")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dark Magician/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Dark Hole/ })).toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-filter-summary"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-results-region"]'),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText(/24 results/)).toBeTruthy();
  });

  it("keeps token spacing before results when a truncation notice is visible", () => {
    const cards = Array.from({ length: 201 }, (_, index) => ({
      ...PROTOTYPE_CATALOG[index % PROTOTYPE_CATALOG.length]!,
      code: 100_000_000 + index,
    }));
    render(CardCatalog, { cards, ruleset: PROTOTYPE_RULESET });
    expect(
      document.querySelector('[data-cy="deck-catalog-fallback-notice"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="deck-catalog-results-region"]'),
    ).not.toBeNull();
    expect(resultsRegionDeclarations()).toContain("margin-top: var(--space-3)");
  });

  it("updates pinned selection callback without adding on click", async () => {
    const onselect = vi.fn();
    const ondragcard = vi.fn();
    render(CardCatalog, {
      cards: PROTOTYPE_CATALOG,
      ruleset: PROTOTYPE_RULESET,
      onselect,
      ondragcard,
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Raigeki/ }));
    expect(onselect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Raigeki" }),
    );
    expect(ondragcard).not.toHaveBeenCalled();
  });
});
