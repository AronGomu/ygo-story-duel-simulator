import { describe, expect, it } from "vitest";
import {
  parseDuelCommand,
  type DuelCommand,
} from "../../src/duel/contracts/duel-command.ts";
import type { DuelWorkerEvent } from "../../src/duel/contracts/duel-worker-event.ts";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  duelId,
  promptId,
} from "../../src/duel/contracts/ids.ts";
import { assertStructuredCloneSafe } from "../../src/duel/contracts/structured-clone.ts";

const examples: readonly (DuelCommand | DuelWorkerEvent)[] = [
  { type: "initialize" },
  { type: "startDuel", duelId: duelId("mvp-preset-v1") },
  {
    type: "respond",
    promptId: promptId("prompt-1"),
    choiceIds: [choiceId("choice-1")],
  },
  { type: "surrender" },
  { type: "dispose" },
  { type: "ready", coreVersion: [11, 0] },
  { type: "loading", stage: "snapshot", progress: 0.5 },
  {
    type: "prompt",
    prompt: {
      id: promptId("sum-prompt"),
      kind: "selectSum",
      player: 0,
      title: "Select a valid total",
      choices: [
        {
          id: choiceId("sum-choice"),
          label: "Contribution",
          action: "select",
          card: {
            instanceId: cardInstanceId("sum-card"),
            code: cardCode(97590747),
            controller: 0,
            location: "hand",
            sequence: 0,
            contribution: 2,
            alternativeContribution: 3,
          },
        },
      ],
      minimum: 1,
      maximum: 1,
      cancelable: false,
      ordered: false,
      requiredTotal: 3,
      sumMode: "exact",
      mandatoryContributions: [],
    },
  },
  {
    type: "error",
    error: {
      code: "engine_initialization_failed",
      message: "failed",
      recoverable: false,
    },
  },
];

describe("Worker contracts", () => {
  it.each(examples)("survives structured cloning: $type", (example) => {
    expect(() => assertStructuredCloneSafe(example)).not.toThrow();
    expect(structuredClone(example)).toEqual(example);
  });

  it("validates untrusted Worker commands and bounds response selections", () => {
    expect(
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: ["choice-1", "choice-2"],
      }),
    ).toEqual({
      type: "respond",
      promptId: "prompt-1",
      choiceIds: ["choice-1", "choice-2"],
    });
    expect(() => parseDuelCommand({ type: "unknown" })).toThrow(
      "Unsupported duel command",
    );
    expect(() =>
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: Array.from({ length: 257 }, () => "choice"),
      }),
    ).toThrow("at most 256 choice IDs");

    const sparseChoices = new Array<string>(1);
    expect(() =>
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: sparseChoices,
      }),
    ).toThrow("dense array");

    const dangerousType = {
      toString: () => {
        throw new Error("must not stringify untrusted command data");
      },
    };
    expect(() => parseDuelCommand({ type: dangerousType })).toThrow(
      "Unsupported duel command",
    );
  });

  it.each([1n, () => undefined, Symbol("value")])(
    "rejects non-contract value %s",
    (value) => {
      expect(() => assertStructuredCloneSafe({ value })).toThrow(
        /non-clone contract value/,
      );
    },
  );
});
