// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CardTile from "../../../src/prototypes/deck-builder/components/CardTile.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

afterEach(() => cleanup());

describe("quantity-limit badge", () => {
  it.each([
    [0, "Forbidden"],
    [1, "Limited"],
    [2, "Semi-Limited"],
    [3, "Unlimited"],
  ] as const)("renders %i with explicit %s semantics", (limit, label) => {
    const card = PROTOTYPE_CATALOG[0]!;
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit,
      currentCopies: 0,
    });
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${label}, maximum ${limit}`),
      }),
    ).toBeTruthy();
    expect(container.querySelector(`.limit-${limit}`)?.textContent).toBe(
      String(limit),
    );
  });
});
