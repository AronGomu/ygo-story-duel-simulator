import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type {
  CardCode,
  ChoiceId,
} from "../../src/battle/duel/contracts/ids.ts";
import { cardCode, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
} from "../../src/battle/duel/contracts/player-prompt.ts";
import {
  parseYdk,
  uniqueDeckCodes,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTraceEntry } from "../../src/battle/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  Reported bug: "I used Dante to mill 3 cards. I milled Cir but i got
  proposition to activate its effect even thought the trigger condition is
  valid."

  Chain propositions are pure engine passthrough — `PromptRegistry` pushes
  every entry of `MSG_SELECT_CHAIN`'s `selects` without a filter — so the only
  way to judge the disputed proposition is to make ocgcore emit it and read the
  payload. This duel does exactly that, deterministically.

  The proposition does not arrive in the chain window that opens while Dante's
  ignition effect sits on the chain: the mill is that effect's cost, and a
  trigger whose timing is met while a cost is being paid cannot chain to the
  effect that paid it. It arrives one window later, once Dante's effect has
  resolved — which is why this run keeps answering chain prompts until the
  graveyard triggers show up instead of reading the first one.
*/

/** "Cir, Malebranche of the Burning Abyss" — the disputed proposition. */
const CIR = cardCode(57143342);
/** "Dante, Traveler of the Burning Abyss" — detaches 1, then mills 1-3. */
const DANTE = cardCode(83531441);
const SCARM = cardCode(84764038);
const GRAFF = cardCode(20758643);
const BOOK_OF_MOON = cardCode(14087893);
const DARK_HOLE = cardCode(53129443);
const ALLURE_OF_DARKNESS = cardCode(1475311);

/**
 * The opening hand, then the deck positions the mill reaches.
 *
 * Scarm and Graff make the two Level 3 monsters Dante needs. The three Spells
 * stay in hand: a Burning Abyss monster may only Special Summon itself while
 * its controller holds no Spell or Trap on the field, so the run never sets
 * one. Positions 5-8 put Cir where any three-card mill reaches it, whether or
 * not the seat drew for turn.
 */
const ARRANGED_HEAD: readonly CardCode[] = Object.freeze([
  SCARM,
  GRAFF,
  BOOK_OF_MOON,
  BOOK_OF_MOON,
  DARK_HOLE,
  ALLURE_OF_DARKNESS,
  CIR,
  CIR,
  CIR,
]);

/** Enough prompts to reach the mill and read the chain windows after it. */
const PROMPT_BUDGET = 120;

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let burningAbyss: ParsedDeck;
let opponent: ParsedDeck;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  burningAbyss = parseYdk(
    await readFile(
      fileURLToPath(
        new URL(
          "../../src/battle/duel/presets/decks/burning-abyss.ydk",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  opponent = (await loadMvpPreset()).opponent;
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(burningAbyss, opponent),
  );
});

describe("Cir mill chain prompt (feedback item 11)", () => {
  it("Dante's mill sends Cir to the GY and the engine offers Cir's trigger in the chain prompt", () => {
    const run = playUntilDanteMillChainPrompt();

    expect(describeFailure(run)).toBe("");
    expect(run.danteMillActivated).toBe(true);
    expect(run.chainPrompts.length).toBeGreaterThanOrEqual(1);
    expect(run.offeredCodes).toContain(57143342);
  });
});

interface CirMillRun {
  /** kind === "chain" prompts observed after Dante's mill resolved. */
  readonly chainPrompts: readonly PlayerPrompt[];
  /** Card codes offered as "activate" choices in those prompts. */
  readonly offeredCodes: readonly number[];
  /** True once Dante's detach-and-mill ignition effect was activated. */
  readonly danteMillActivated: boolean;
  readonly traceTail: readonly DuelTraceEntry[];
}

function playUntilDanteMillChainPrompt(): CirMillRun {
  const profile = selectedDeckPairRulesProfile(
    burningAbyss,
    opponent,
    dependencies.cards,
  );
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: burningAbyss,
    opponentDeck: opponent,
    configuration: {
      mode: "programmed",
      rules: profile.rules,
      seed: [17n, 23n, 29n, 31n],
      playerDeckOrder: arrangedDeckOrder(burningAbyss.main),
      opponentDeckOrder: opponent.main,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "cir-mill-chain-prompt",
    deckCounts: [burningAbyss.main.length, opponent.main.length],
    extraDeckCounts: [burningAbyss.extra.length, opponent.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
    maximumAutomaticResponses: 5_000,
  });
  const goal = new GoalLadder();
  const chainPrompts: PlayerPrompt[] = [];
  const offeredCodes: number[] = [];

  try {
    let advance = controller.advance();
    for (
      let step = 0;
      step < PROMPT_BUDGET && advance.result === undefined;
      step += 1
    ) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      if (goal.danteMillActivated && prompt.kind === "chain") {
        chainPrompts.push(prompt);
        for (const choice of prompt.choices)
          if (choice.action === "activate" && choice.card?.code !== undefined)
            offeredCodes.push(choice.card.code);
      }
      advance = answer(controller, prompt, goal);
      /* The graveyard triggers are what the report disputes; once they have
         been read every later prompt is unrelated duel noise. */
      if (offeredCodes.includes(CIR)) break;
    }
    return {
      chainPrompts: Object.freeze([...chainPrompts]),
      offeredCodes: Object.freeze([...offeredCodes]),
      danteMillActivated: goal.danteMillActivated,
      traceTail: traceTail(controller),
    };
  } finally {
    controller.dispose();
  }
}

/**
 * Drives the seat to the disputed proposition: Special Summon Scarm, Normal
 * Summon Graff, Xyz Summon Dante over the pair, then activate Dante and
 * announce the largest mill. Every chain window is passed, so nothing but the
 * scripted line reaches the chain.
 */
class GoalLadder {
  #scarmSpecialSummoned = false;
  #graffSummoned = false;
  #danteSummoned = false;
  #danteMillActivated = false;

  get danteMillActivated(): boolean {
    return this.#danteMillActivated;
  }

  choose(prompt: PlayerPrompt): readonly ChoiceId[] | undefined {
    const find = (predicate: (choice: PromptChoice) => boolean) =>
      prompt.choices.find(predicate)?.id;
    if (prompt.kind === "chain") {
      const pass = find((choice) => choice.action === "pass");
      return pass === undefined ? undefined : [pass];
    }
    if (prompt.kind === "announceNumber") {
      const three = find((choice) => choice.value === 3);
      return three === undefined ? undefined : [three];
    }
    if (prompt.kind !== "idleCommand") return undefined;
    /* A Burning Abyss monster Special Summoning itself from the hand is an
       ignition effect, so the core offers it as "activate", not
       "specialSummon". */
    if (!this.#scarmSpecialSummoned) {
      const id = find(
        (choice) =>
          choice.action === "activate" &&
          choice.card?.code === SCARM &&
          choice.card.location === "hand",
      );
      if (id !== undefined) {
        this.#scarmSpecialSummoned = true;
        return [id];
      }
    }
    if (!this.#graffSummoned) {
      const id = find(
        (choice) => choice.action === "summon" && choice.card?.code === GRAFF,
      );
      if (id !== undefined) {
        this.#graffSummoned = true;
        return [id];
      }
    }
    if (!this.#danteSummoned) {
      const id = find(
        (choice) =>
          choice.action === "specialSummon" && choice.card?.code === DANTE,
      );
      if (id !== undefined) {
        this.#danteSummoned = true;
        return [id];
      }
    }
    if (!this.#danteMillActivated) {
      const id = find(
        (choice) => choice.action === "activate" && choice.card?.code === DANTE,
      );
      if (id !== undefined) {
        this.#danteMillActivated = true;
        return [id];
      }
    }
    return undefined;
  }
}

/**
 * Answers with the scripted choice when the ladder has one, and otherwise
 * walks the legal choices the way a player searching for an accepted selection
 * does, retrying against the next candidate when the core refuses one.
 */
function answer(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
  goal: GoalLadder,
): ReturnType<HeadlessDuelController["respond"]> {
  let lastRejection: DuelOperationError | undefined;
  for (const choiceIds of candidateResponses(prompt, goal)) {
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
  goal: GoalLadder,
): readonly ChoiceId[][] {
  const scripted = goal.choose(prompt);
  const candidates: ChoiceId[][] =
    scripted === undefined ? [] : [[...scripted]];
  const ids = prompt.choices.map(({ id }) => id);
  const size = prompt.ordered ? ids.length : Math.max(prompt.minimum, 1);
  for (let start = 0; start < ids.length; start += 1) {
    const window: ChoiceId[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      const value = ids[(start + offset) % ids.length];
      if (value !== undefined) window.push(value);
    }
    if (window.length === size && new Set(window).size === size)
      candidates.push(window);
  }
  if (prompt.cancelable) candidates.push([]);
  if (candidates.length === 0)
    throw new Error(`Prompt ${prompt.kind} offered no choices`);
  return candidates;
}

/**
 * Puts the scripted opening on top of the deck and leaves the rest of the main
 * deck in its listed order, so the whole duel is fixed by the file plus the
 * seed.
 */
function arrangedDeckOrder(main: readonly CardCode[]): readonly CardCode[] {
  const rest = [...main];
  for (const code of ARRANGED_HEAD) {
    const index = rest.indexOf(code);
    if (index < 0) throw new Error(`Deck does not contain card ${code}`);
    rest.splice(index, 1);
  }
  return Object.freeze([...ARRANGED_HEAD, ...rest]);
}

function traceTail(
  controller: HeadlessDuelController,
): readonly DuelTraceEntry[] {
  return controller.trace().entries.slice(-30);
}

function describeFailure(run: CirMillRun): string {
  if (run.danteMillActivated && run.offeredCodes.includes(CIR)) return "";
  return [
    `mill activated: ${run.danteMillActivated}`,
    `chain prompts after the mill: ${run.chainPrompts.length}`,
    `offered codes: ${JSON.stringify(run.offeredCodes)}`,
    ...run.traceTail.map((entry) => JSON.stringify(entry)),
  ].join("\n");
}
