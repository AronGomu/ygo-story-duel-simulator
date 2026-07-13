import { describe, expect, it } from "vitest";
import {
  EXECUTED_PROGRAMMED_COVERAGE,
  MVP_ACTION_FAMILIES,
  MVP_PROMPT_FAMILIES,
  MVP_REQUIRED_COVERAGE,
  uncoveredProgrammedCoverage,
} from "../fixtures/action-coverage.ts";
import { loadProgrammedScenarios } from "../fixtures/programmed-scenarios.ts";

describe("programmed integration specification", () => {
  it("requires executed evidence for every supported coverage row", async () => {
    const scenarios = await loadProgrammedScenarios();
    const executableIds = new Set(
      scenarios
        .filter((scenario) => scenario.transcript !== undefined)
        .map((scenario) => scenario.id),
    );
    expect(MVP_REQUIRED_COVERAGE).toHaveLength(
      MVP_ACTION_FAMILIES.length + MVP_PROMPT_FAMILIES.length,
    );
    expect(
      Object.keys(EXECUTED_PROGRAMMED_COVERAGE).every((id) =>
        executableIds.has(id),
      ),
    ).toBe(true);

    const observed = [
      ...new Set(Object.values(EXECUTED_PROGRAMMED_COVERAGE).flat()),
    ];
    expect(observed.sort()).toEqual([...MVP_REQUIRED_COVERAGE].sort());
    expect(uncoveredProgrammedCoverage()).toEqual([]);
  });

  it("keeps deterministic inputs explicit and non-zero", async () => {
    const scenarios = await loadProgrammedScenarios();
    for (const scenario of scenarios) {
      expect(scenario.seed.some((word) => word !== 0n)).toBe(true);
      expect(scenario.deckOrder[0]).toHaveLength(40);
      expect(scenario.deckOrder[1]).toHaveLength(40);
      expect(scenario.startingHands[0]).toHaveLength(5);
      expect(scenario.startingHands[1]).toHaveLength(5);
      expect(scenario.startingHands[0]).toEqual(
        scenario.deckOrder[0].slice(0, 5),
      );
      expect(scenario.startingHands[1]).toEqual(
        scenario.deckOrder[1].slice(0, 5),
      );
      if (scenario.expectedFinishReason !== "lp_zero") {
        expect(scenario.choices).toEqual([]);
      } else {
        expect(scenario.choices.length).toBeGreaterThan(0);
      }
    }
  });

  it("identifies executable transcripts separately from planned scenarios", async () => {
    const scenarios = await loadProgrammedScenarios();
    expect(
      scenarios.filter((scenario) => scenario.transcript !== undefined),
    ).toEqual([
      expect.objectContaining({
        id: "battle-and-chain",
        transcript: "basic-duel-v1",
        expectedWinner: 1,
      }),
      expect.objectContaining({
        id: "tribute-special-and-target",
        transcript: "tribute-special-v1",
        expectedWinner: 0,
      }),
      expect.objectContaining({
        id: "effects-recovery-and-position",
        transcript: "effects-recovery-v1",
        expectedWinner: 0,
      }),
      expect.objectContaining({
        id: "real-wasm-prompt-matrix",
        transcript: "prompt-matrix-v1",
        expectedWinner: 0,
      }),
      expect.objectContaining({
        id: "shuffle-and-sort-chain",
        transcript: "sort-chain-v1",
        expectedWinner: 0,
      }),
      expect.objectContaining({
        id: "deck-out-at-opening",
        transcript: "deck-out-v1",
        expectedWinner: 1,
      }),
      expect.objectContaining({
        id: "surrender-at-opening",
        transcript: "surrender-v1",
        expectedWinner: 1,
      }),
    ]);
  });
});
