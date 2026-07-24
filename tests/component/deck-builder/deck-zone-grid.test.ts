// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckZoneGrid from "../../../src/prototypes/deck-builder/components/DeckZoneGrid.svelte";
import { mainDeckGridPlan } from "../../../src/decks/deck-model.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { prototypeCatalogMap } from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("DeckZoneGrid", () => {
  it("renders repeated tiles plus 40 explicit slots through card 40", () => {
    const codes = [89631139, 89631139, 89631139];
    const { container } = render(DeckZoneGrid, {
      zone: "main",
      label: "Main Deck",
      codes,
      plan: mainDeckGridPlan(codes.length),
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      totalCopies: new Map([[89631139, 3]]),
      onselect: vi.fn(),
      ondragcard: vi.fn(),
      onpickup: vi.fn(),
      ondropzone: vi.fn(),
    });
    expect(
      screen.getAllByRole("button", { name: /Blue-Eyes White Dragon/ }),
    ).toHaveLength(3);
    expect(container.querySelector('[data-slots="40"]')).toBeTruthy();
    expect(container.querySelector('[data-columns="10"]')).toBeTruthy();
    expect(container.querySelectorAll(".empty-slot")).toHaveLength(37);
  });

  it("switches to 60 slots at card 41", () => {
    const codes = Array.from({ length: 41 }, () => 89631139);
    const { container } = render(DeckZoneGrid, {
      zone: "main",
      label: "Main Deck",
      codes,
      plan: mainDeckGridPlan(codes.length),
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      totalCopies: new Map([[89631139, 41]]),
    });
    expect(container.querySelector('[data-slots="60"]')).toBeTruthy();
    expect(container.querySelector('[data-columns="12"]')).toBeTruthy();
  });
});
