// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CardDetails from "../../../src/prototypes/deck-builder/components/CardDetails.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";

afterEach(() => cleanup());

describe("CardDetails", () => {
  it("keeps long effect text and OCG metadata in the pinned panel", () => {
    const card = PROTOTYPE_CATALOG.find(
      ({ name }) => name === "Angello Vaalmonica",
    )!;
    render(CardDetails, {
      card,
      copies: { main: 2, extra: 0, side: 1 },
      ruleset: PROTOTYPE_RULESET,
    });
    expect(screen.getByRole("heading", { name: card.name })).toBeTruthy();
    expect(screen.getByText(/This intentionally long text/)).toBeTruthy();
    expect(screen.getByText("DARK")).toBeTruthy();
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByText(/2 Main · 0 Extra · 1 Side/)).toBeTruthy();
    expect(screen.getByText("Artwork unavailable")).toBeTruthy();
  });

  it("identifies selected missing-card placeholders", () => {
    render(CardDetails, {
      card: null,
      missingCode: 99999999,
      copies: { main: 1, extra: 0, side: 0 },
      ruleset: PROTOTYPE_RULESET,
    });
    expect(
      screen.getByRole("heading", { name: "Unknown card #99999999" }),
    ).toBeTruthy();
    expect(screen.getByText("Missing catalog entry")).toBeTruthy();
  });
});
