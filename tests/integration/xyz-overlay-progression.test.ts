import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { ChoiceId } from "../../src/battle/duel/contracts/ids.ts";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import {
  parseYdk,
  uniqueDeckCodes,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTraceEntry } from "../../src/battle/worker/diagnostics/duel-trace.ts";
import type { DuelSeed } from "../../src/battle/worker/engine/duel-seed.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  Reported bug: "after a few actions the connection is interrupted and a
  technical failure stops the duel", with the Worker logging
  `code: 'unsupported_message'` on a `respond` command.

  Every reproduction traced to an Xyz Summon. The core overlays the materials
  onto the Xyz monster while that monster is still in the Extra Deck, then
  moves the finished monster to its zone without re-announcing the units it
  carries, and it keeps addressing the units of a retired Xyz against the
  Graveyard. Each of those addresses named an overlay host the projection does
  not model, and reconciling them threw a non-recoverable `unsupported_message`
  that killed the Worker mid-duel.

  These seats are the ones the story flow offers, played with the same
  production shuffling the Worker uses. The seeds below are the ones that
  reached an Xyz Summon; each aborted the duel before the fix.
*/
const SCENARIOS: readonly {
  readonly name: string;
  readonly player: string;
  readonly opponent: string;
  readonly seed: DuelSeed;
  readonly policySeed: number;
}[] = Object.freeze([
  Object.freeze({
    name: "detaching a material read back from the core",
    player: "burning-abyss",
    opponent: "opponent",
    seed: seedOf(0),
    policySeed: 1,
  }),
  Object.freeze({
    name: "using an Xyz monster as material for another Xyz monster",
    player: "burning-abyss",
    opponent: "opponent",
    seed: seedOf(1),
    policySeed: 2,
  }),
  Object.freeze({
    name: "summoning an Xyz monster onto a chosen zone",
    player: "burning-abyss",
    opponent: "player",
    seed: seedOf(4),
    policySeed: 5,
  }),
]);

/** Enough prompts for the scripted seat to reach and pass the Xyz Summon. */
const PROMPT_BUDGET = 400;

let adapter: OcgCoreAdapter;
const decks = new Map<string, ParsedDeck>();
let dependencies: ActiveDuelDependencies;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  for (const name of ["burning-abyss", "opponent", "player"])
    decks.set(name, await loadDeck(name));
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(...decks.values()),
  );
});

describe("Xyz overlay duel progression", () => {
  it.each(SCENARIOS)(
    "a duel survives $name without unsupported_message",
    (scenario) => {
      const run = playScriptedDuel(scenario);

      expect(describeFailure(run)).toBe("");
      /* Without an Xyz monster carrying materials the run proves nothing:
         the flow that aborted the duel was never reached. */
      expect(run.overlaidMonsterCodes.length).toBeGreaterThan(0);
    },
  );
});

interface ScriptedRun {
  readonly promptsAnswered: number;
  readonly failure?: DuelOperationError;
  /** Every monster observed holding overlay materials, proving the projection
      carried an Xyz monster's units instead of silently losing them. */
  readonly overlaidMonsterCodes: readonly (number | undefined)[];
  readonly traceTail: readonly DuelTraceEntry[];
}

function playScriptedDuel(scenario: (typeof SCENARIOS)[number]): ScriptedRun {
  const player = deck(scenario.player);
  const opponent = deck(scenario.opponent);
  const profile = selectedDeckPairRulesProfile(
    player,
    opponent,
    dependencies.cards,
  );
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: player,
    opponentDeck: opponent,
    /* Production mode is what the Worker runs: the deck order comes from the
       core's own shuffle, so only this seed reproduces the abort. */
    configuration: {
      mode: "production",
      rules: profile.rules,
      seed: scenario.seed,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "xyz-overlay-progression",
    deckCounts: [player.main.length, opponent.main.length],
    extraDeckCounts: [player.extra.length, opponent.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
  });
  const random = seededRandom(scenario.policySeed);
  const overlaidMonsterCodes: (number | undefined)[] = [];
  let promptsAnswered = 0;

  try {
    let advance = controller.advance();
    observe(advance.state);
    while (advance.result === undefined && promptsAnswered < PROMPT_BUDGET) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      advance = answer(controller, prompt, random);
      observe(advance.state);
      promptsAnswered += 1;
    }
    return {
      promptsAnswered,
      overlaidMonsterCodes: Object.freeze([...overlaidMonsterCodes]),
      traceTail: traceTail(controller),
    };
  } catch (error) {
    if (!(error instanceof DuelOperationError)) throw error;
    return {
      promptsAnswered,
      failure: error,
      overlaidMonsterCodes: Object.freeze([...overlaidMonsterCodes]),
      traceTail: traceTail(controller),
    };
  } finally {
    controller.dispose();
  }

  function observe(state: PublicDuelState): void {
    for (const seat of state.players)
      for (const monster of seat.monsters)
        if (monster.overlayMaterials.length > 0)
          overlaidMonsterCodes.push(monster.code);
  }
}

/**
 * Answers a prompt the way a player working through a duel does: an arbitrary
 * legal choice, retried against the next candidate when the core refuses the
 * selection. The order is seeded so a scenario replays exactly.
 */
function answer(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
  random: () => number,
): ReturnType<HeadlessDuelController["respond"]> {
  let lastRejection: DuelOperationError | undefined;
  for (const choiceIds of candidateResponses(prompt, random)) {
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

function candidateResponses(
  prompt: PlayerPrompt,
  random: () => number,
): readonly ChoiceId[][] {
  const ids = prompt.choices.map(({ id }) => id);
  if (prompt.ordered) return [ids];
  const size = Math.max(prompt.minimum, 1);
  const candidates: ChoiceId[][] = [];
  for (const start of shuffled([...ids.keys()], random)) {
    const window: ChoiceId[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      const value = ids[(start + offset) % ids.length];
      if (value !== undefined) window.push(value);
    }
    if (window.length === size && new Set(window).size === size)
      candidates.push(window);
  }
  if (prompt.cancelable) candidates.push([]);
  return candidates;
}

function shuffled(values: number[], random: () => number): number[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = values[index];
    const right = values[swap];
    if (left !== undefined && right !== undefined) {
      values[index] = right;
      values[swap] = left;
    }
  }
  return values;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedOf(index: number): DuelSeed {
  const value = (offset: number): bigint =>
    (BigInt(index * 4 + offset) * 6364136223846793005n + 1442695040888963407n) &
    0xffffffffffffffffn;
  return [value(1), value(2), value(3), value(4)];
}

async function loadDeck(name: string): Promise<ParsedDeck> {
  return parseYdk(
    await readFile(
      fileURLToPath(
        new URL(
          `../../src/battle/duel/presets/decks/${name}.ydk`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
}

function deck(name: string): ParsedDeck {
  const value = decks.get(name);
  if (value === undefined) throw new Error(`Deck ${name} was not loaded`);
  return value;
}

function traceTail(
  controller: HeadlessDuelController,
): readonly DuelTraceEntry[] {
  return controller.trace().entries.slice(-30);
}

function describeFailure(run: ScriptedRun): string {
  if (run.failure === undefined) return "";
  return [
    `${run.failure.duelError.code}: ${run.failure.duelError.message}`,
    `after ${run.promptsAnswered} prompts`,
    ...run.traceTail.map((entry) => JSON.stringify(entry)),
  ].join("\n");
}
