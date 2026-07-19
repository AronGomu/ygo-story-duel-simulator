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

  it("matches a brute-force oracle across bounded generated inputs", () => {
    for (let candidateCount = 1; candidateCount <= 4; candidateCount += 1) {
      for (const contributions of contributionVectors(candidateCount)) {
        const candidates = contributions.map((contribution) => ({
          contribution,
        }));
        for (const mode of ["exact", "atLeast"] as const) {
          for (let target = 1; target <= 6; target += 1) {
            for (let minimum = 0; minimum <= candidateCount; minimum += 1) {
              const selected = findValidContributionSelection(
                candidates,
                [],
                target,
                mode,
                minimum,
                candidateCount,
              );
              const possible = hasBruteForceSelection(
                contributions,
                target,
                mode,
                minimum,
              );
              expect(
                selected !== null,
                JSON.stringify({
                  contributions,
                  target,
                  mode,
                  minimum,
                  selected,
                }),
              ).toBe(possible);
              if (selected !== null) {
                expect(new Set(selected).size).toBe(selected.length);
                expect(selected.length).toBeGreaterThanOrEqual(minimum);
                expect(
                  isValidContributionTotal(
                    selected.map((index) => [contributions[index]!]),
                    target,
                    mode,
                  ),
                ).toBe(true);
              }
            }
          }
        }
      }
    }
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

function contributionVectors(length: number): number[][] {
  return Array.from({ length: 3 ** length }, (_, encoded) => {
    let value = encoded;
    return Array.from({ length }, () => {
      const contribution = (value % 3) + 1;
      value = Math.floor(value / 3);
      return contribution;
    });
  });
}

function hasBruteForceSelection(
  contributions: readonly number[],
  target: number,
  mode: "exact" | "atLeast",
  minimum: number,
): boolean {
  for (let mask = 0; mask < 2 ** contributions.length; mask += 1) {
    const selected = contributions.filter(
      (_, index) => (mask & (1 << index)) !== 0,
    );
    if (selected.length < minimum) continue;
    if (
      isValidContributionTotal(
        selected.map((value) => [value]),
        target,
        mode,
      )
    )
      return true;
  }
  return false;
}
