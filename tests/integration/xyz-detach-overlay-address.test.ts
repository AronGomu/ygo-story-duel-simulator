import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { ChoiceId } from "../../src/battle/duel/contracts/ids.ts";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import { captureDanteMaterialDecision } from "./dante-material-decision.ts";
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
import type { DuelSeed } from "../../src/battle/worker/engine/duel-seed.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  This integration suite proves `PromptCard.overlay` mirrors the raw engine
  location bit. The companion `captureDanteMaterialDecision` fixture proves
  the pinned Dante line first activates Dante, then decrements projected
  overlay materials. Its classification is therefore safe to use for the
  selector gate: real `overlay:true` choices mean engine-choice; no marker
  means pinned-core auto-detach. No sequence inference is used.
*/
const SCENARIO = Object.freeze({
  name: "detaching a material read back from the core",
  player: "burning-abyss",
  opponent: "opponent",
  seed: seedOf(0),
  policySeed: 1,
});

/** Enough prompts for the scripted seat to reach and pass the Xyz Summon. */
const PROMPT_BUDGET = 400;

/** `EngineLocation.OVERLAY`, restated so the assertion reads the engine
    constant the Worker masks rather than importing Worker internals. */
const ENGINE_LOCATION_OVERLAY = 128;

let adapter: OcgCoreAdapter;
const decks = new Map<string, ParsedDeck>();
let dependencies: ActiveDuelDependencies;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  for (const name of [SCENARIO.player, SCENARIO.opponent])
    decks.set(name, await loadDeck(name));
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve("generated/assets/current"),
    uniqueDeckCodes(...decks.values()),
  );
});

describe("Xyz detach overlay addressing", () => {
  it("proves Dante activation and material decrement before classifying detach", () => {
    const capture = captureDanteMaterialDecision({
      adapter,
      dependencies,
      playerDeck: deck(SCENARIO.player),
      opponentDeck: deck(SCENARIO.opponent),
    });

    expect(capture.activationPromptId).toBeTruthy();
    expect(capture.before.length).toBeGreaterThan(capture.after.length);
    expect(capture.detachedCode).not.toBeNull();
    expect(capture.kind).toBe("auto-detach");
    expect(capture.materialPrompts).toEqual([]);
  });

  it("marks a prompt card as an overlay unit exactly when the engine location carries the OVERLAY bit", () => {
    const run = playScriptedDuel(SCENARIO);

    expect(run.failure?.duelError).toBeUndefined();
    /* The scenario has to reach an Xyz monster holding materials, or the
       detach flow was never exercised and the absence below proves nothing. */
    expect(run.overlaidStates).toBeGreaterThan(0);
    // And it has to have read real prompt cards, so the rule is not vacuous.
    expect(run.promptCardsSeen).toBeGreaterThan(0);
    expect(run.markerMismatches).toEqual([]);
  });
});

/** One prompt card the engine addressed as an overlay unit. */
interface OverlayAddress {
  readonly promptKind: PlayerPrompt["kind"];
  readonly controller: 0 | 1;
  readonly location: string;
  readonly sequence: number;
  /** Material sequences of every host holding units in the same state. */
  readonly hostMaterialSequences: readonly number[];
}

interface ScriptedRun {
  readonly promptsAnswered: number;
  readonly failure?: DuelOperationError;
  readonly overlayAddresses: readonly OverlayAddress[];
  /** States passed through holding at least one Xyz monster with materials. */
  readonly overlaidStates: number;
  readonly promptCardsSeen: number;
  /** One line per prompt card whose `overlay` disagreed with its raw location. */
  readonly markerMismatches: readonly string[];
}

function playScriptedDuel(scenario: typeof SCENARIO): ScriptedRun {
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
       core's own shuffle, so only this seed replays this duel. */
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
    presetId: "xyz-detach-overlay-address",
    deckCounts: [player.main.length, opponent.main.length],
    extraDeckCounts: [player.extra.length, opponent.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
  });
  const random = seededRandom(scenario.policySeed);
  const overlayAddresses: OverlayAddress[] = [];
  const markerMismatches: string[] = [];
  let overlaidStates = 0;
  let promptCardsSeen = 0;
  let promptsAnswered = 0;

  try {
    let advance = controller.advance();
    while (advance.result === undefined && promptsAnswered < PROMPT_BUDGET) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      observe(prompt, advance.state);
      advance = answer(controller, prompt, random);
      promptsAnswered += 1;
    }
    return completed();
  } catch (error) {
    if (!(error instanceof DuelOperationError)) throw error;
    return { ...completed(), failure: error };
  } finally {
    controller.dispose();
  }

  function completed(): ScriptedRun {
    return {
      promptsAnswered,
      overlayAddresses: Object.freeze([...overlayAddresses]),
      overlaidStates,
      promptCardsSeen,
      markerMismatches: Object.freeze([...markerMismatches]),
    };
  }

  function observe(prompt: PlayerPrompt, state: PublicDuelState): void {
    const hostMaterialSequences = Object.freeze(
      state.players.flatMap((seat) =>
        seat.monsters.flatMap((monster) =>
          monster.overlayMaterials.map((material) => material.sequence),
        ),
      ),
    );
    if (hostMaterialSequences.length > 0) overlaidStates += 1;

    const cards = [
      ...prompt.choices.flatMap((choice) =>
        choice.card === undefined ? [] : [choice.card],
      ),
      ...(prompt.contextCard === undefined ? [] : [prompt.contextCard]),
    ];
    promptCardsSeen += cards.length;
    for (const card of cards) {
      const raw = rawEngineLocation(card.instanceId);
      const carriesBit = raw !== null && (raw & ENGINE_LOCATION_OVERLAY) !== 0;
      if ((card.overlay === true) !== carriesBit) {
        markerMismatches.push(
          `${card.instanceId}: overlay=${String(card.overlay)} rawLocation=${String(raw)}`,
        );
      }
      if (card.overlay !== true) continue;
      overlayAddresses.push(
        Object.freeze({
          promptKind: prompt.kind,
          controller: card.controller,
          location: card.location as string,
          sequence: card.sequence,
          hostMaterialSequences,
        }),
      );
    }
  }
}

/**
 * `toPromptCard` synthesizes `p{controller}-l{location}-s{sequence}` from the
 * raw engine card, so the pre-mask location survives on the public prompt.
 */
function rawEngineLocation(instanceId: string): number | null {
  const match = /^p[01]-l(\d+)-s\d+$/.exec(instanceId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Answers a prompt the way a player working through a duel does: an arbitrary
 * legal choice, retried against the next candidate when the core refuses the
 * selection. The order is seeded so the scenario replays exactly.
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
