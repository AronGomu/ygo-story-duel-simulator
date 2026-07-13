import { describe, expect, it } from "vitest";
import {
  decodeSumContribution,
  findValidContributionSelection,
  isValidContributionTotal,
} from "../../src/worker/protocol/sum-selection.ts";

describe("sum selection", () => {
  it("decodes packed alternative contributions", () => {
    expect(decodeSumContribution((3 << 16) | 2)).toEqual({
      contribution: 2,
      alternativeContribution: 3,
    });
    expect(decodeSumContribution(2)).toEqual({ contribution: 2 });
  });

  it("validates exact and minimal at-least totals", () => {
    expect(isValidContributionTotal([[2, 3]], 3, "exact")).toBe(true);
    expect(isValidContributionTotal([[3], [3]], 5, "atLeast")).toBe(true);
    expect(isValidContributionTotal([[3], [3], [1]], 5, "atLeast")).toBe(false);
  });

  it("finds a legal choice beyond the former 20-card search limit", () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      contribution: index === 24 ? 5 : 1,
    }));

    expect(
      findValidContributionSelection(candidates, [], 5, "exact", 1, 1),
    ).toEqual([24]);
  });

  it("includes mandatory contributions when choosing optional cards", () => {
    expect(
      findValidContributionSelection(
        [{ contribution: 3 }, { contribution: 4 }],
        [{ contribution: 2 }],
        5,
        "exact",
        1,
        1,
      ),
    ).toEqual([0]);
    expect(
      findValidContributionSelection(
        [{ contribution: 1 }],
        [{ contribution: 2 }, { contribution: 3 }],
        5,
        "atLeast",
        0,
        1,
      ),
    ).toEqual([]);
  });
});
