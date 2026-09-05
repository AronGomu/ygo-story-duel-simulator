// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CardTile from "../../../src/deck-editor/components/CardTile.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";

afterEach(() => cleanup());

describe("quantity-limit badge", () => {
  it.each([
    [0, "Forbidden"],
    [1, "Limited"],
    [2, "Semi-Limited"],
  ] as const)("renders %i with explicit %s semantics", (limit, label) => {
    const card = PROTOTYPE_CATALOG[0]!;
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit,
      currentCopies: 0,
      dataCyPrefix: "catalog",
      dataCyId: card.code,
    });
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${label}, maximum ${limit}`),
      }),
    ).toBeTruthy();
    expect(
      container.querySelector(`[data-cy="catalog-tile-limit-${card.code}"]`)
        ?.textContent,
    ).toBe(String(limit));
  });

  it("hides the redundant unlimited badge without hiding its semantics", () => {
    const card = PROTOTYPE_CATALOG[0]!;
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "catalog",
      dataCyId: card.code,
    });
    expect(
      screen.getByRole("button", { name: /Unlimited, maximum 3/ }),
    ).toBeTruthy();
    expect(
      container.querySelector(`[data-cy="catalog-tile-limit-${card.code}"]`),
    ).toBeNull();
  });
});
