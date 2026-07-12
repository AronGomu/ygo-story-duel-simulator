import { describe, expect, it } from "vitest";
import {
  MVP_ACTION_FAMILIES,
  MVP_PROMPT_FAMILIES,
  PROGRAMMED_COVERAGE,
} from "../fixtures/action-coverage.ts";
import { loadProgrammedScenarios } from "../fixtures/programmed-scenarios.ts";

describe("programmed integration specification", () => {
  it("maps every supported action and prompt family to a scenario", async () => {
    const scenarios = await loadProgrammedScenarios();
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    const families = [...MVP_ACTION_FAMILIES, ...MVP_PROMPT_FAMILIES];

    expect(Object.keys(PROGRAMMED_COVERAGE).sort()).toEqual(
      [...new Set(families)].sort(),
    );
    for (const family of families) {
      expect(PROGRAMMED_COVERAGE[family].length, family).toBeGreaterThan(0);
      expect(
        PROGRAMMED_COVERAGE[family].every((id) => scenarioIds.has(id)),
        family,
      ).toBe(true);
    }
  });

  it("keeps deterministic inputs explicit and non-zero", async () => {
    const scenarios = await loadProgrammedScenarios();
    for (const scenario of scenarios) {
      expect(scenario.seed.some((word) => word !== 0n)).toBe(true);
      expect(scenario.deckOrder[0]).toHaveLength(40);
      expect(scenario.deckOrder[1]).toHaveLength(40);
      expect(scenario.startingHands[0].length).toBeGreaterThan(0);
      expect(scenario.choices.length).toBeGreaterThan(0);
    }
  });
});
