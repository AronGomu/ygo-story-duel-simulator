import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  lastActionActor,
  ownEffectChainPassResponse,
  trivialPromptResponse,
} from "../../src/battle/app/prompts/auto-response.ts";
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
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTraceEntry } from "../../src/battle/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  Reported bug: "after sending Scarm to the graveyard, no action was proposed
  to activate its valid trigger" — owner feedback, Duel Field item 11.

  `cir-mill-chain-prompt.test.ts` already proves the engine offers those
  graveyard triggers, so the card that swallows them is on the client: the
  window opens with an empty chain, the last action was the seat's own, and
  `ownEffectChainPassResponse` answers it with "pass" before the player sees
  it. This run reproduces the whole path — real core, real projection, real
  auto-response — and reads the decision the app would take on the window that
  carries the trigger.

  The auto-response chain mirrors `App.svelte`'s `maybeAutoResolvePrompt` for
  the two functions that can answer a chain window; `centralPlacementResponse`
  only ever answers placement prompts and is left out on purpose.
*/

/** "Dante, Traveler of the Burning Abyss" — detaches 1, then mills 1-3. */
const DANTE = cardCode(83531441);
const SCARM = cardCode(84764038);
const GRAFF = cardCode(20758643);
const CIR = cardCode(57143342);
const BOOK_OF_MOON = cardCode(14087893);
const DARK_HOLE = cardCode(53129443);
const ALLURE_OF_DARKNESS = cardCode(1475311);

/**
 * The opening hand, then the deck positions the mill reaches — the same
 * arrangement `cir-mill-chain-prompt.test.ts` uses, because it is the line
 * that puts a Burning Abyss trigger into the graveyard off the seat's own
 * play and nothing else.
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

/** Enough prompts to reach the mill and the chain window after it. */
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

describe("graveyard trigger chain window (feedback item 11)", () => {
  it("arrives as a chain prompt on an empty chain after the seat's own action", () => {
    const window = playUntilGraveyardTriggerWindow();

    expect(describeFailure(window)).toBe("");
    /* The premise the fix rests on: were this an `effectYesNo` prompt the
       chain auto-pass would not be the culprit at all. */
    expect(window.kind).toBe("chain");
    expect(window.chainLength).toBe(0);
    expect(window.actor).toBe(0);
    expect(window.offeredCodes.length).toBeGreaterThanOrEqual(1);
  });

  it("is left for the player instead of being auto-passed", () => {
    const window = playUntilGraveyardTriggerWindow();

    expect(describeFailure(window)).toBe("");
    expect(window.autoResponse).toBeNull();
  });
});

interface TriggerWindow {
  /** Prompt kind the trigger window arrived as. */
  readonly kind?: PlayerPrompt["kind"];
  /** Chain links open when the window arrived. */
  readonly chainLength: number;
  /** Who `lastActionActor` attributes the window to. */
  readonly actor?: number;
  /** Card codes offered as "activate" choices in the window. */
  readonly offeredCodes: readonly number[];
  /** What the app's auto-response would answer the window with. */
  readonly autoResponse: readonly ChoiceId[] | null;
  /** True once Dante's detach-and-mill ignition effect was activated. */
  readonly danteMillActivated: boolean;
  readonly found: boolean;
  readonly traceTail: readonly DuelTraceEntry[];
}

function playUntilGraveyardTriggerWindow(): TriggerWindow {
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
    presetId: "gy-trigger-chain-window",
    deckCounts: [burningAbyss.main.length, opponent.main.length],
    extraDeckCounts: [burningAbyss.extra.length, opponent.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
    maximumAutomaticResponses: 5_000,
  });
  const goal = new GoalLadder();
  /* `lastActionActor` walks back through the whole log to the turn boundary,
     so the run keeps it the way the app's presentation event store does. */
  const events: DuelPresentationEvent[] = [];

  try {
    let advance = controller.advance();
    events.push(...advance.events);
    for (
      let step = 0;
      step < PROMPT_BUDGET && advance.result === undefined;
      step += 1
    ) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      if (goal.danteMillActivated && isTriggerWindow(prompt)) {
        const actor = lastActionActor(events, advance.state.turnPlayer);
        return {
          kind: prompt.kind,
          chainLength: advance.state.chain.length,
          actor,
          offeredCodes: offeredCodes(prompt),
          autoResponse:
            trivialPromptResponse(prompt) ??
            ownEffectChainPassResponse(prompt, advance.state, actor),
          danteMillActivated: true,
          found: true,
          traceTail: traceTail(controller),
        };
      }
      advance = answer(controller, prompt, goal);
      events.push(...advance.events);
    }
    return {
      chainLength: 0,
      offeredCodes: [],
      autoResponse: null,
      danteMillActivated: goal.danteMillActivated,
      found: false,
      traceTail: traceTail(controller),
    };
  } finally {
    controller.dispose();
  }
}

/**
 * The window the report is about: a response window offering a card in the
 * graveyard, rather than one of the many windows offering the Spells still in
 * hand. `effectYesNo` is admitted so a trigger arriving as Falco's does is
 * caught by the kind assertion instead of running the budget out.
 */
function isTriggerWindow(prompt: PlayerPrompt): boolean {
  if (prompt.player !== 0) return false;
  if (prompt.kind !== "chain" && prompt.kind !== "effectYesNo") return false;
  return prompt.choices.some(
    (choice) =>
      choice.action !== "pass" && choice.card?.location === "graveyard",
  );
}

function offeredCodes(prompt: PlayerPrompt): readonly number[] {
  const codes: number[] = [];
  for (const choice of prompt.choices)
    if (choice.action !== "pass" && choice.card?.code !== undefined)
      codes.push(choice.card.code);
  return Object.freeze(codes);
}

/**
 * Drives the seat to the graveyard trigger: Special Summon Scarm, Normal
 * Summon Graff, Xyz Summon Dante over the pair, then activate Dante and
 * announce the largest mill. Every chain window before the mill is passed, so
 * nothing but the scripted line reaches the chain.
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

function describeFailure(window: TriggerWindow): string {
  if (window.found) return "";
  return [
    `mill activated: ${window.danteMillActivated}`,
    `trigger window reached: ${window.found}`,
    ...window.traceTail.map((entry) => JSON.stringify(entry)),
  ].join("\n");
}
