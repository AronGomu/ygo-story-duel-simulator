import { describe, expect, it } from "vitest";
import {
  catalogCardClickIntent,
  catalogCardContextIntent,
  deckCardClickIntent,
  type ZoneCounts,
} from "../../../src/deck-editor/layout/click-intent.ts";

function counts(overrides: Partial<ZoneCounts>): ZoneCounts {
  return { main: 0, extra: 0, side: 0, ...overrides };
}

describe("deckCardClickIntent", () => {
  it("a deck-zone double-click removes the source copy", () => {
    expect(deckCardClickIntent()).toEqual({ kind: "remove" });
  });
});

describe("catalogCardClickIntent", () => {
  it("a catalog double-click adds to the canonical zone", () => {
    expect(catalogCardClickIntent("main", counts({ main: 10 }))).toEqual({
      kind: "add",
      zone: "main",
    });
  });

  it("a full canonical zone blocks instead of falling back to side", () => {
    expect(catalogCardClickIntent("main", counts({ main: 60 }))).toEqual({
      kind: "blocked",
      reason: "Main Deck is full.",
    });
  });
});

describe("catalogCardContextIntent", () => {
  it("uses same canonical-only rule as catalog activation", () => {
    expect(catalogCardContextIntent("main", counts({ main: 60 }))).toEqual({
      kind: "blocked",
      reason: "Main Deck is full.",
    });
  });
});
