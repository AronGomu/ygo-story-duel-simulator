import { describe, expect, it } from "vitest";
import {
  FIFTEEN_CARD_GRID,
  mainDeckGridPlan,
} from "../../../src/decks/deck-model.ts";

describe("deck grid plans", () => {
  it("uses 40 slots through card 40", () => {
    expect(mainDeckGridPlan(0)).toEqual({
      columns: 10,
      rows: 4,
      slots: 40,
      compact: false,
    });
    expect(mainDeckGridPlan(40)).toEqual({
      columns: 10,
      rows: 4,
      slots: 40,
      compact: false,
    });
  });

  it("switches to 60 smaller slots at card 41", () => {
    expect(mainDeckGridPlan(41)).toEqual({
      columns: 12,
      rows: 5,
      slots: 60,
      compact: true,
    });
    expect(mainDeckGridPlan(61)).toEqual({
      columns: 12,
      rows: 5,
      slots: 60,
      compact: true,
    });
  });

  it("keeps Extra and Side at 15 slots", () => {
    expect(FIFTEEN_CARD_GRID).toEqual({
      columns: 5,
      rows: 3,
      slots: 15,
      compact: false,
    });
  });
});
