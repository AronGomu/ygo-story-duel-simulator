import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type {
  CardCode,
  ChoiceId,
  PromptId,
} from "../../src/battle/duel/contracts/ids.ts";
import { cardCode, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
} from "../../src/battle/duel/contracts/player-prompt.ts";
import type {
  PublicDuelState,
  PublicOverlayMaterial,
} from "../../src/battle/duel/contracts/public-duel-state.ts";
import type { ParsedDeck } from "../../src/battle/duel/presets/deck-parser.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import type { DuelSeed } from "../../src/battle/worker/engine/duel-seed.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/** Test-only evidence for Dante's engine-authentic detach path. */
export interface DanteMaterialDecisionCapture {
  readonly kind: "engine-choice" | "auto-detach";
  readonly activationPromptId: PromptId;
  readonly materialPrompts: readonly PlayerPrompt[];
  readonly before: readonly PublicOverlayMaterial[];
  readonly after: readonly PublicOverlayMaterial[];
  readonly detachedCode: CardCode | null;
}

export interface DanteMaterialDecisionOptions {
  readonly adapter: OcgCoreAdapter;
  readonly dependencies: ActiveDuelDependencies;
  readonly playerDeck: ParsedDeck;
  readonly opponentDeck: ParsedDeck;
}

const DANTE = cardCode(83531441);
const SCARM = cardCode(84764038);
const GRAFF = cardCode(20758643);
const BOOK_OF_MOON = cardCode(14087893);
const DARK_HOLE = cardCode(53129443);
const ALLURE_OF_DARKNESS = cardCode(1475311);
const ARRANGED_HEAD: readonly CardCode[] = Object.freeze([
  SCARM,
  GRAFF,
  BOOK_OF_MOON,
  BOOK_OF_MOON,
  DARK_HOLE,
  ALLURE_OF_DARKNESS,
  cardCode(57143342),
  cardCode(57143342),
  cardCode(57143342),
]);
const PROMPT_BUDGET = 120;
const SEED: DuelSeed = [17n, 23n, 29n, 31n];

/**
 * Replays deterministic Dante activation against vendored ocgcore. Capture
 * stops only after projected overlay count decreases, so auto-detach claims
 * include both activation and material-decrement evidence.
 */
export function captureDanteMaterialDecision(
  options: DanteMaterialDecisionOptions,
): DanteMaterialDecisionCapture {
  const { adapter, dependencies, playerDeck, opponentDeck } = options;
  const profile = selectedDeckPairRulesProfile(
    playerDeck,
    opponentDeck,
    dependencies.cards,
  );
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck,
    opponentDeck,
    configuration: {
      mode: "programmed",
      rules: profile.rules,
      seed: SEED,
      playerDeckOrder: arrangedDeckOrder(playerDeck.main),
      opponentDeckOrder: opponentDeck.main,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "dante-material-decision",
    deckCounts: [playerDeck.main.length, opponentDeck.main.length],
    extraDeckCounts: [playerDeck.extra.length, opponentDeck.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
    maximumAutomaticResponses: 5_000,
  });
  const ladder = new DanteActivationLadder();
  const materialPrompts: PlayerPrompt[] = [];
  let activationPromptId: PromptId | undefined;
  let before: readonly PublicOverlayMaterial[] | undefined;
  let advance = controller.advance();

  try {
    for (let step = 0; step < PROMPT_BUDGET; step += 1) {
      if (ladder.activated) {
        const current = overlayMaterials(advance.state);
        if (before === undefined)
          throw new Error("Dante activation has no pre-detach material state");
        if (current.length < before.length) {
          if (activationPromptId === undefined)
            throw new Error("Dante decrement has no activation prompt");
          return Object.freeze({
            kind: materialPrompts.some(hasOverlayChoice)
              ? "engine-choice"
              : "auto-detach",
            activationPromptId,
            materialPrompts: Object.freeze([...materialPrompts]),
            before,
            after: current,
            detachedCode: detachedCode(before, current),
          });
        }
        const prompt = advance.prompt;
        if (prompt === undefined)
          throw new Error("Dante detach stopped without material decrement");
        materialPrompts.push(prompt);
        advance = respond(controller, prompt, ladder);
        continue;
      }

      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Dante activation stopped without a prompt");
      const activationChoice = ladder.activationChoice(prompt);
      if (activationChoice !== undefined) {
        before = overlayMaterials(advance.state);
        if (before.length === 0)
          throw new Error("Dante activation has no overlay material");
        activationPromptId = prompt.id;
        advance = controller.respond(prompt.id, [activationChoice]);
        ladder.markActivated();
        continue;
      }
      advance = respond(controller, prompt, ladder);
    }
    throw new Error(
      "Dante material decrement not observed within prompt budget",
    );
  } finally {
    controller.dispose();
  }
}

class DanteActivationLadder {
  #scarmSpecialSummoned = false;
  #graffSummoned = false;
  #danteSummoned = false;
  #activated = false;

  get activated(): boolean {
    return this.#activated;
  }

  markActivated(): void {
    this.#activated = true;
  }

  activationChoice(prompt: PlayerPrompt): ChoiceId | undefined {
    if (prompt.kind !== "idleCommand") return undefined;
    return prompt.choices.find(
      (choice) => choice.action === "activate" && choice.card?.code === DANTE,
    )?.id;
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
    return undefined;
  }
}

function respond(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
  ladder: DanteActivationLadder,
): ReturnType<HeadlessDuelController["respond"]> {
  let lastRejection: DuelOperationError | undefined;
  for (const ids of candidateResponses(prompt, ladder)) {
    try {
      return controller.respond(prompt.id, ids);
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
  ladder: DanteActivationLadder,
): readonly ChoiceId[][] {
  const scripted = ladder.choose(prompt);
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
  return candidates;
}

function overlayMaterials(
  state: PublicDuelState,
): readonly PublicOverlayMaterial[] {
  return Object.freeze(
    state.players.flatMap((seat) =>
      seat.monsters.flatMap((monster) => monster.overlayMaterials),
    ),
  );
}

function detachedCode(
  before: readonly PublicOverlayMaterial[],
  after: readonly PublicOverlayMaterial[],
): CardCode | null {
  return (
    before.find(
      (material) =>
        !after.some(({ instanceId }) => instanceId === material.instanceId),
    )?.code ?? null
  );
}

function hasOverlayChoice(prompt: PlayerPrompt): boolean {
  return prompt.choices.some((choice) => choice.card?.overlay === true);
}

function arrangedDeckOrder(main: readonly CardCode[]): readonly CardCode[] {
  const rest = [...main];
  for (const code of ARRANGED_HEAD) {
    const index = rest.indexOf(code);
    if (index < 0) throw new Error(`Deck does not contain card ${code}`);
    rest.splice(index, 1);
  }
  return Object.freeze([...ARRANGED_HEAD, ...rest]);
}
