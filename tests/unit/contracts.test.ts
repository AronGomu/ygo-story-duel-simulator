import { describe, expect, it } from "vitest";
import {
  parseDuelCommand,
  type DuelCommand,
} from "../../src/duel/contracts/duel-command.ts";
import {
  parseDuelWorkerEvent,
  type DuelWorkerEvent,
} from "../../src/duel/contracts/duel-worker-event.ts";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  duelId,
  promptId,
  snapshotId,
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
  { type: "requestDiagnostics" },
  { type: "dispose" },
  { type: "ready", coreVersion: [11, 0] },
  { type: "disposed", clean: true },
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
    type: "diagnostics",
    trace: {
      schemaVersion: 1,
      sensitivity: "contains-production-seed",
      presetId: "mvp-preset-v1",
      snapshotId: snapshotId("a".repeat(64)),
      seed: ["1", "2", "3", "4"],
      coreVersion: [11, 0],
      revisions: {
        enginePackage: "ocgcore-wasm",
        engineVersion: "0.1.2",
        babelCdb: "babel",
        cardScripts: "scripts",
        distribution: "strings",
        activeImageManifestSha256: "b".repeat(64),
      },
      entries: [],
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

  it.each([
    { type: "event", event: { type: "phaseChanged" } },
    {
      type: "state",
      state: {
        snapshotId: "snapshot",
        revision: 1,
        turn: 1,
        turnPlayer: 0,
        phase: "main1",
        players: [null, null],
        chain: [],
      },
    },
    {
      type: "prompt",
      prompt: {
        id: "prompt",
        kind: "selectSum",
        player: 0,
        title: "Select",
        choices: [],
        minimum: 0,
        maximum: 0,
        cancelable: false,
        ordered: false,
        mandatoryContributions: "wrong",
      },
    },
    { type: "result", result: { type: "completed", winner: 0 } },
  ])("rejects malformed Worker event payloads", (event) => {
    expect(() => parseDuelWorkerEvent(event)).toThrow(
      /invalid|must be an object/,
    );
  });

  it("rejects opponent decisions and concealed opponent prompt identities", () => {
    expect(() =>
      parseDuelWorkerEvent({
        type: "prompt",
        prompt: {
          id: "opponent-prompt",
          kind: "yesNo",
          player: 1,
          title: "Private decision",
          choices: [],
          minimum: 0,
          maximum: 0,
          cancelable: false,
          ordered: false,
        },
      }),
    ).toThrow(/privacy/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "prompt",
        prompt: {
          id: "concealed-card",
          kind: "selectCard",
          player: 0,
          title: "Select",
          choices: [
            {
              id: "private-choice",
              label: "Private card",
              action: "select",
              card: {
                instanceId: "private-card",
                code: 123,
                name: "Leaked identity",
                controller: 1,
                location: "hand",
                sequence: 0,
              },
            },
          ],
          minimum: 1,
          maximum: 1,
          cancelable: false,
          ordered: false,
        },
      }),
    ).toThrow(/identity privacy/);
  });

  it("returns a detached validated value rather than the untrusted input", () => {
    const input = { type: "ready", coreVersion: [11, 0] };
    const parsed = parseDuelWorkerEvent(input);
    input.coreVersion[0] = 99;
    expect(parsed).toEqual({ type: "ready", coreVersion: [11, 0] });
  });

  it("rejects sparse arrays, contradictory errors, and undeclared fields", () => {
    const sparseVersion = new Array<number>(2);
    sparseVersion[0] = 11;
    expect(() =>
      parseDuelWorkerEvent({ type: "ready", coreVersion: sparseVersion }),
    ).toThrow(/dense array/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "ready",
        coreVersion: [11, 0],
        snapshotId: "not-a-digest",
      }),
    ).toThrow(/snapshotId/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "error",
        error: {
          code: "worker_error",
          message: "failed",
          recoverable: true,
        },
      }),
    ).toThrow(/recoverable/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "loading",
        stage: "manifest",
        privateSeed: 123,
      }),
    ).toThrow(/privateSeed/);
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
