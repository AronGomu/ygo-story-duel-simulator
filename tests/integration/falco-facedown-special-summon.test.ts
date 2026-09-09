import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { DuelPresentationEvent } from "../../src/battle/duel/contracts/duel-presentation-event.ts";
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
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTraceEntry } from "../../src/battle/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  Reported bug: "I activated Sinister Shadow Games sending Falco to grave,
  triggered and accepted its effect to special summon it face down on the field
  then i got the crash." The shipped diagnostics
  (`ygo-duel-diagnostics-a562f5ad6794.json`) end on `MSG_SPSUMMONING` followed
  by `error: Invalid card code: 0` and `session_closed:failed`.

  A face-down Special Summon is the one summon the core announces without an
  identity: `MSG_SPSUMMONING` carries code 0 rather than the summoned card's
  code, because naming it would leak the face-down card. The projector fed that
  0 to `cardCode`, which rejects it, so the duel died on a legal play. This duel
  reproduces the announcement deterministically.
*/

/** "Sinister Shadow Games" — sends 1 "Shaddoll" monster from the Deck to the GY. */
const SINISTER_SHADOW_GAMES = cardCode(77505534);
/** "Shaddoll Falco" — Special Summons itself face-down when sent to the GY. */
const SHADDOLL_FALCO = cardCode(37445295);

/**
 * The opening hand, then the top of the deck.
 *
 * Sinister Shadow Games has to be in hand and Falco has to be in the deck for
 * the reported line to exist, so the head holds the Quick-Play Spell plus five
 * cards that are not Falco: the seat draws the first five and Falco stays
 * where the send can reach it.
 */
const ARRANGED_HEAD: readonly CardCode[] = Object.freeze([
  SINISTER_SHADOW_GAMES,
  cardCode(3717252),
  cardCode(3717252),
  cardCode(77723643),
  cardCode(77723643),
  cardCode(30328508),
]);

/** Enough prompts to reach the face-down Special Summon announcement. */
const PROMPT_BUDGET = 60;

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let shaddoll: ParsedDeck;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  shaddoll = parseYdk(
    await readFile(
      fileURLToPath(
        new URL(
          "../../src/battle/duel/presets/decks/shaddoll.ydk",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(shaddoll, shaddoll),
  );
});

describe("Shaddoll Falco face-down Special Summon", () => {
  it("survives the identity-less MSG_SPSUMMONING and keeps the summoned card concealed", () => {
    const run = playUntilFalcoSpecialSummon();

    expect(describeFailure(run)).toBe("");
    expect(run.falcoSentToGraveyard).toBe(true);
    expect(run.specialSummons).toContainEqual({
      type: "specialSummon",
      player: 0,
    });
    expect(run.faceDownMonsters).toBe(1);
  });
});

interface FalcoRun {
  /** Every `specialSummon` event observed after Falco reached the graveyard. */
  readonly specialSummons: readonly DuelPresentationEvent[];
  /** True once Sinister Shadow Games was answered with Falco. */
  readonly falcoSentToGraveyard: boolean;
  /** Face-down monsters the seat controls once the summon has landed. */
  readonly faceDownMonsters: number;
  readonly failure?: string;
  readonly traceTail: readonly DuelTraceEntry[];
}

/** Prompts answered after the summon, to prove the session keeps running. */
const STEPS_AFTER_SUMMON = 5;

function playUntilFalcoSpecialSummon(): FalcoRun {
  const profile = selectedDeckPairRulesProfile(
    shaddoll,
    shaddoll,
    dependencies.cards,
  );
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: shaddoll,
    opponentDeck: shaddoll,
    configuration: {
      mode: "programmed",
      rules: profile.rules,
      seed: [17n, 23n, 29n, 31n],
      playerDeckOrder: arrangedDeckOrder(shaddoll.main),
      opponentDeckOrder: shaddoll.main,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "falco-facedown-special-summon",
    deckCounts: [shaddoll.main.length, shaddoll.main.length],
    extraDeckCounts: [shaddoll.extra.length, shaddoll.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
    maximumAutomaticResponses: 5_000,
  });
  const goal = new GoalLadder();
  const specialSummons: DuelPresentationEvent[] = [];
  let faceDownMonsters = 0;

  try {
    let advance = controller.advance();
    let stepsAfterSummon = 0;
    for (
      let step = 0;
      step < PROMPT_BUDGET && advance.result === undefined;
      step += 1
    ) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      advance = answer(controller, prompt, goal);
      for (const event of advance.events)
        if (event.type === "specialSummon") specialSummons.push(event);
      if (specialSummons.length === 0) continue;
      faceDownMonsters = advance.state.players[0].monsters.filter(
        (card) => !card.faceUp,
      ).length;
      stepsAfterSummon += 1;
      if (stepsAfterSummon > STEPS_AFTER_SUMMON) break;
    }
    return {
      specialSummons: Object.freeze([...specialSummons]),
      falcoSentToGraveyard: goal.falcoSentToGraveyard,
      faceDownMonsters,
      traceTail: traceTail(controller),
    };
  } catch (error) {
    return {
      specialSummons: Object.freeze([...specialSummons]),
      falcoSentToGraveyard: goal.falcoSentToGraveyard,
      faceDownMonsters,
      failure: error instanceof Error ? error.message : String(error),
      traceTail: traceTail(controller),
    };
  } finally {
    controller.dispose();
  }
}

/**
 * Drives the seat down the reported line: activate Sinister Shadow Games, send
 * Falco with it, then accept Falco's graveyard trigger. Everything else is
 * answered by the walk in `candidateResponses`.
 */
class GoalLadder {
  #shadowGamesActivated = false;
  #falcoSentToGraveyard = false;

  get falcoSentToGraveyard(): boolean {
    return this.#falcoSentToGraveyard;
  }

  choose(prompt: PlayerPrompt): readonly ChoiceId[] | undefined {
    const find = (predicate: (choice: PromptChoice) => boolean) =>
      prompt.choices.find(predicate)?.id;
    if (prompt.kind === "idleCommand") {
      if (this.#shadowGamesActivated) return undefined;
      const id = find(
        (choice) =>
          choice.action === "activate" &&
          choice.card?.code === SINISTER_SHADOW_GAMES &&
          choice.card.location === "hand",
      );
      if (id !== undefined) {
        this.#shadowGamesActivated = true;
        return [id];
      }
      return undefined;
    }
    if (prompt.kind === "selectCard") {
      const id = find((choice) => choice.card?.code === SHADDOLL_FALCO);
      if (id !== undefined) {
        this.#falcoSentToGraveyard = true;
        return [id];
      }
      return undefined;
    }
    /* Falco's graveyard trigger is offered as an optional effect; accepting it
       is the whole point of the run. */
    if (prompt.kind === "effectYesNo" || prompt.kind === "yesNo") {
      const yes = find((choice) => choice.action === "yes");
      return yes === undefined ? undefined : [yes];
    }
    if (prompt.kind === "chain") {
      const pass = find((choice) => choice.action === "pass");
      return pass === undefined ? undefined : [pass];
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

function describeFailure(run: FalcoRun): string {
  if (run.failure === undefined && run.specialSummons.length > 0) return "";
  return [
    `failure: ${run.failure ?? "none"}`,
    `Falco sent to the graveyard: ${run.falcoSentToGraveyard}`,
    `face-down monsters: ${run.faceDownMonsters}`,
    `special summons: ${JSON.stringify(run.specialSummons)}`,
    ...run.traceTail.map((entry) => JSON.stringify(entry)),
  ].join("\n");
}
