import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type {
  CardCode,
  CardInstanceId,
  ChoiceId,
  PromptId,
} from "../../src/battle/duel/contracts/ids.ts";
import { cardCode, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
} from "../../src/battle/duel/contracts/player-prompt.ts";
import type {
  PlayerIndex,
  PublicCard,
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

export interface DanteMaterialPromptCapture {
  readonly prompt: PlayerPrompt;
  readonly state: PublicDuelState;
  /** Exact response accepted by core while advancing deterministic line. */
  readonly responseChoiceIds: readonly ChoiceId[];
}

/** Test-only evidence for Dante's engine-authentic detach path. */
export interface DanteMaterialDecisionCapture {
  readonly kind: "engine-choice" | "auto-detach";
  readonly activationPromptId: PromptId;
  readonly player: PlayerIndex;
  readonly hostInstanceId: CardInstanceId;
  readonly materialPrompts: readonly PlayerPrompt[];
  readonly materialPromptCaptures: readonly DanteMaterialPromptCapture[];
  readonly beforeState: PublicDuelState;
  readonly afterState: PublicDuelState;
  /** Materials attached to captured Dante host, never aggregate field data. */
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
  const materialPromptCaptures: DanteMaterialPromptCapture[] = [];
  let activationPromptId: PromptId | undefined;
  let player: PlayerIndex | undefined;
  let hostInstanceId: CardInstanceId | undefined;
  let beforeState: PublicDuelState | undefined;
  let before: readonly PublicOverlayMaterial[] | undefined;
  let advance = controller.advance();

  try {
    for (let step = 0; step < PROMPT_BUDGET; step += 1) {
      if (ladder.activated) {
        if (
          beforeState === undefined ||
          before === undefined ||
          player === undefined ||
          hostInstanceId === undefined
        ) {
          throw new Error("Dante activation has no pre-detach host state");
        }
        const current = danteMaterials(advance.state, player, hostInstanceId);
        if (current.length < before.length) {
          if (activationPromptId === undefined)
            throw new Error("Dante decrement has no activation prompt");
          const materialPrompts = materialPromptCaptures.map(
            ({ prompt }) => prompt,
          );
          return Object.freeze({
            kind: materialPrompts.some(hasOverlayChoice)
              ? "engine-choice"
              : "auto-detach",
            activationPromptId,
            player,
            hostInstanceId,
            materialPrompts: Object.freeze(materialPrompts),
            materialPromptCaptures: Object.freeze([...materialPromptCaptures]),
            beforeState,
            afterState: advance.state,
            before,
            after: current,
            detachedCode: detachedCode(before, current),
          });
        }
        const prompt = advance.prompt;
        if (prompt === undefined)
          throw new Error("Dante detach stopped without material decrement");
        const response = respond(controller, prompt, ladder);
        materialPromptCaptures.push(
          Object.freeze({
            prompt,
            state: advance.state,
            responseChoiceIds: response.choiceIds,
          }),
        );
        advance = response.advance;
        continue;
      }

      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Dante activation stopped without a prompt");
      const activationChoice = ladder.activationChoice(prompt);
      if (activationChoice !== undefined) {
        const activationCard = activationChoice.card;
        if (activationCard === undefined)
          throw new Error("Dante activation choice has no card address");
        const host = danteHost(
          advance.state,
          activationCard.controller,
          activationCard.sequence,
        );
        beforeState = advance.state;
        before = host.overlayMaterials;
        if (before.length === 0)
          throw new Error("Dante activation has no overlay material");
        activationPromptId = prompt.id;
        player = host.controller;
        hostInstanceId = host.instanceId;
        advance = controller.respond(prompt.id, [activationChoice.id]);
        ladder.markActivated();
        continue;
      }
      advance = respond(controller, prompt, ladder).advance;
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

  activationChoice(prompt: PlayerPrompt): PromptChoice | undefined {
    if (prompt.kind !== "idleCommand") return undefined;
    return prompt.choices.find(
      (choice) => choice.action === "activate" && choice.card?.code === DANTE,
    );
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

interface AcceptedResponse {
  readonly advance: ReturnType<HeadlessDuelController["respond"]>;
  readonly choiceIds: readonly ChoiceId[];
}

function respond(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
  ladder: DanteActivationLadder,
): AcceptedResponse {
  let lastRejection: DuelOperationError | undefined;
  for (const ids of candidateResponses(prompt, ladder)) {
    try {
      return Object.freeze({
        advance: controller.respond(prompt.id, ids),
        choiceIds: Object.freeze([...ids]),
      });
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

function danteHost(
  state: PublicDuelState,
  player: PlayerIndex,
  sequence: number,
): PublicCard {
  const host = state.players[player].monsters.find(
    (card) =>
      card.code === DANTE &&
      card.controller === player &&
      card.location === "monster" &&
      card.sequence === sequence,
  );
  if (host === undefined)
    throw new Error(`Dante host missing for player ${player}`);
  return host;
}

function danteMaterials(
  state: PublicDuelState,
  player: PlayerIndex,
  hostInstanceId: CardInstanceId,
): readonly PublicOverlayMaterial[] {
  const host = state.players[player].monsters.find(
    ({ instanceId }) => instanceId === hostInstanceId,
  );
  if (host === undefined)
    throw new Error(`Dante host ${hostInstanceId} left player ${player} field`);
  return host.overlayMaterials;
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
