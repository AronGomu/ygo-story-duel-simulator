import { describe, expect, it } from "vitest";
import type { DuelCommand } from "../../src/duel/contracts/duel-command.ts";
import type { DuelWorkerEvent } from "../../src/duel/contracts/duel-worker-event.ts";
import { choiceId, duelId, promptId } from "../../src/duel/contracts/ids.ts";
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

  it.each([1n, () => undefined, Symbol("value")])(
    "rejects non-contract value %s",
    (value) => {
      expect(() => assertStructuredCloneSafe({ value })).toThrow(
        /non-clone contract value/,
      );
    },
  );
});
