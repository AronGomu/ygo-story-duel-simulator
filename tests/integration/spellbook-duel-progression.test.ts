import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ChoiceId } from "../../src/battle/duel/contracts/ids.ts";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import {
  parseYdk,
  uniqueDeckCodes,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTraceEntry } from "../../src/battle/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/** How many human prompts the scripted duel answers before giving up. */
const PROMPT_BUDGET = 200;

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let spellbook: ParsedDeck;
let opponent: ParsedDeck;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  spellbook = parseYdk(
    await readFile(
      fileURLToPath(
        new URL(
          "../../src/battle/duel/presets/decks/spellbook.ydk",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  opponent = (await loadMvpPreset()).opponent;
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(spellbook, opponent),
  );
});

describe("spellbook duel progression", () => {
  it("a spellbook duel survives repeated effect activations without unsupported_message", () => {
    const run = playScriptedSpellbookDuel();

    expect(describeFailure(run)).toBe("");
    expect(run.finished).toBe(true);
  });
});

interface ProgressionRun {
  readonly promptsAnswered: number;
  readonly finished: boolean;
  readonly failure?: DuelOperationError;
  readonly traceTail: readonly DuelTraceEntry[];
}

function playScriptedSpellbookDuel(): ProgressionRun {
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: spellbook,
    opponentDeck: opponent,
    configuration: {
      mode: "programmed",
      rules: "mr5",
      seed: [17n, 23n, 29n, 31n],
      playerDeckOrder: spellbook.main,
      opponentDeckOrder: opponent.main,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "spellbook-duel-progression",
    deckCounts: [spellbook.main.length, opponent.main.length],
    extraDeckCounts: [spellbook.extra.length, opponent.extra.length],
    extraMonsterZones: true,
    maximumAutomaticResponses: 5_000,
  });
  let promptsAnswered = 0;

  try {
    let advance = controller.advance();
    while (advance.result === undefined && promptsAnswered < PROMPT_BUDGET) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      advance = answer(controller, prompt);
      promptsAnswered += 1;
    }
    return {
      promptsAnswered,
      finished: advance.result !== undefined,
      traceTail: traceTail(controller),
    };
  } catch (error) {
    if (!(error instanceof DuelOperationError)) throw error;
    return {
      promptsAnswered,
      finished: false,
      failure: error,
      traceTail: traceTail(controller),
    };
  } finally {
    controller.dispose();
  }
}

/**
 * Answers a prompt the way the reported player did: take an activation when
 * one is offered, otherwise the first selection the prompt accepts. Selections
 * the engine rejects as illegal are a scripting artefact rather than the bug
 * under test, so the next candidate is tried instead.
 */
function answer(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
): ReturnType<HeadlessDuelController["respond"]> {
  let lastRejection: DuelOperationError | undefined;
  for (const choiceIds of candidateResponses(prompt)) {
    try {
      return controller.respond(prompt.id, choiceIds);
    } catch (error) {
      if (
        !(error instanceof DuelOperationError) ||
        error.duelError.code !== "invalid_response"
      )
        throw error;
      lastRejection = error;
    }
  }
  throw (
    lastRejection ??
    new Error(`Prompt ${prompt.kind} offered no answerable choices`)
  );
}

function candidateResponses(prompt: PlayerPrompt): readonly ChoiceId[][] {
  if (prompt.ordered) return [prompt.choices.map(({ id }) => id)];
  const preferred = prompt.choices.filter(
    (choice) => choice.action === "activate",
  );
  const rest = prompt.choices.filter((choice) => choice.action !== "activate");
  const ordered = [...preferred, ...rest];
  const size = Math.max(prompt.minimum, 1);
  const candidates: ChoiceId[][] = [];
  for (let start = 0; start + size <= ordered.length; start += 1)
    candidates.push(ordered.slice(start, start + size).map(({ id }) => id));
  if (prompt.cancelable) candidates.push([]);
  return candidates;
}

function traceTail(
  controller: HeadlessDuelController,
): readonly DuelTraceEntry[] {
  return controller.trace().entries.slice(-30);
}

function describeFailure(run: ProgressionRun): string {
  if (run.failure === undefined) return "";
  return [
    `${run.failure.duelError.code}: ${run.failure.duelError.message}`,
    `after ${run.promptsAnswered} prompts`,
    ...run.traceTail.map((entry) => JSON.stringify(entry)),
  ].join("\n");
}
