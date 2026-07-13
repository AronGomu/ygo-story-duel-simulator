import { describe, expect, it } from "vitest";
import {
  cardInstanceId,
  choiceId,
  promptId,
  type ChoiceId,
} from "../../src/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
  PromptKind,
} from "../../src/duel/contracts/player-prompt.ts";
import {
  describePromptConstraints,
  validatePromptSelection,
} from "../../src/app/prompts/prompt-selection.ts";

const FIRST = choiceId("choice-1");
const SECOND = choiceId("choice-2");
const THIRD = choiceId("choice-3");

function choice(
  id: ChoiceId,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return {
    id,
    label: String(id),
    action: "select",
    ...overrides,
  };
}

function prompt(
  kind: PromptKind,
  overrides: Partial<PlayerPrompt> = {},
): PlayerPrompt {
  return {
    id: promptId(`${kind}-prompt`),
    kind,
    player: 0,
    title: "Choose",
    choices: [choice(FIRST), choice(SECOND), choice(THIRD)],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
    ...overrides,
  };
}

describe("prompt selection validation", () => {
  it("requires one known choice for single-action controls", () => {
    const value = prompt("idleCommand");
    expect(validatePromptSelection(value, [FIRST])).toEqual({ valid: true });
    expect(validatePromptSelection(value, [])).toMatchObject({
      valid: false,
      message: "Select exactly one choice",
    });
    expect(
      validatePromptSelection(value, [choiceId("unknown-choice")]),
    ).toMatchObject({ valid: false, message: "Unknown choice" });
  });

  it("enforces multi-selection bounds, uniqueness, and cancellation", () => {
    const value = prompt("selectCard", {
      minimum: 2,
      maximum: 3,
      cancelable: true,
    });
    expect(validatePromptSelection(value, [])).toEqual({ valid: true });
    expect(validatePromptSelection(value, [FIRST])).toMatchObject({
      valid: false,
      message: "Select between 2 and 3 choices",
    });
    expect(validatePromptSelection(value, [FIRST, SECOND])).toEqual({
      valid: true,
    });
    expect(validatePromptSelection(value, [FIRST, FIRST])).toMatchObject({
      valid: false,
      message: "Select each choice at most once",
    });
  });

  it("validates exact and at-least sums including mandatory contributions", () => {
    const choices = [
      choice(FIRST, {
        card: {
          instanceId: cardInstanceId("card-1"),
          controller: 0,
          location: "hand",
          sequence: 0,
          contribution: 2,
          alternativeContribution: 3,
        },
      }),
      choice(SECOND, {
        card: {
          instanceId: cardInstanceId("card-2"),
          controller: 0,
          location: "hand",
          sequence: 1,
          contribution: 2,
        },
      }),
    ];
    const exact = prompt("selectSum", {
      choices,
      minimum: 1,
      maximum: 1,
      requiredTotal: 3,
      sumMode: "exact",
      mandatoryContributions: [],
    });
    expect(validatePromptSelection(exact, [FIRST])).toEqual({ valid: true });
    expect(validatePromptSelection(exact, [SECOND])).toMatchObject({
      valid: false,
      message: "Selection must total exactly 3",
    });

    const atLeast = prompt("selectSum", {
      choices,
      minimum: 0,
      maximum: 2,
      requiredTotal: 5,
      sumMode: "atLeast",
      mandatoryContributions: [{ contribution: 1 }],
    });
    expect(validatePromptSelection(atLeast, [FIRST, SECOND])).toEqual({
      valid: true,
    });
    expect(validatePromptSelection(atLeast, [SECOND])).toMatchObject({
      valid: false,
      message: "Selection must reach at least 5",
    });
  });

  it("allows repeated counter choices only within explicit capacities", () => {
    const value = prompt("selectCounter", {
      choices: [
        choice(FIRST, {
          allocationMaximum: 2,
        }),
        choice(SECOND, {
          allocationMaximum: 1,
        }),
      ],
      minimum: 3,
      maximum: 3,
    });
    expect(validatePromptSelection(value, [FIRST, FIRST, SECOND])).toEqual({
      valid: true,
    });
    expect(validatePromptSelection(value, [FIRST, FIRST, FIRST])).toMatchObject(
      {
        valid: false,
        message: "Counter allocation exceeds the available amount",
      },
    );
  });

  it("requires a complete unique sort order or an explicit cancellation", () => {
    const value = prompt("sortCard", {
      choices: [choice(FIRST), choice(SECOND)],
      minimum: 2,
      maximum: 2,
      ordered: true,
      cancelable: true,
    });
    expect(validatePromptSelection(value, [])).toEqual({ valid: true });
    expect(validatePromptSelection(value, [SECOND, FIRST])).toEqual({
      valid: true,
    });
    expect(validatePromptSelection(value, [FIRST, FIRST])).toMatchObject({
      valid: false,
      message: "Include every choice exactly once",
    });
  });

  it("describes all active constraints in human-readable text", () => {
    expect(
      describePromptConstraints(
        prompt("selectSum", {
          minimum: 1,
          maximum: 3,
          cancelable: true,
          ordered: true,
          requiredTotal: 5,
          sumMode: "atLeast",
          mandatoryContributions: [
            { contribution: 1 },
            { contribution: 2, alternativeContribution: 3 },
          ],
        }),
      ),
    ).toContain("Choose 1 to 3");
    expect(
      describePromptConstraints(
        prompt("selectSum", {
          minimum: 1,
          maximum: 3,
          cancelable: true,
          ordered: true,
          requiredTotal: 5,
          sumMode: "atLeast",
          mandatoryContributions: [
            { contribution: 1 },
            { contribution: 2, alternativeContribution: 3 },
          ],
        }),
      ),
    ).toContain("at least 5");
    expect(
      describePromptConstraints(
        prompt("selectSum", {
          minimum: 1,
          maximum: 3,
          cancelable: true,
          ordered: true,
          requiredTotal: 5,
          sumMode: "atLeast",
          mandatoryContributions: [
            { contribution: 1 },
            { contribution: 2, alternativeContribution: 3 },
          ],
        }),
      ),
    ).toContain("Mandatory contributions: 1 and 2 or 3");
  });
});
