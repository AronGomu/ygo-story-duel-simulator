import type { CardCode, ChoiceId, PromptId } from "../../duel/contracts/ids.ts";
import type {
  ChoiceAction,
  PlayerPrompt,
  PromptChoice,
  PromptContribution,
  PromptKind,
} from "../../duel/contracts/player-prompt.ts";
import type {
  PlayerIndex,
  PublicDuelState,
  PublicLocation,
} from "../../duel/contracts/public-duel-state.ts";
import type {
  BoardTargetId,
  BoardViewModel,
} from "../../field/board-view-model.ts";
import { resolvePromptChoiceBoardTarget } from "../../field/card-mapping.ts";
import {
  promptControlFamily,
  type PromptControlFamily,
} from "./prompt-control-family.ts";

export interface InteractionKey {
  readonly workerGeneration: number;
  readonly sessionGeneration: number;
  readonly promptId: PromptId;
}

export interface InteractionContext {
  readonly workerGeneration: number;
  readonly sessionGeneration: number;
}

export interface InteractionChoice {
  readonly id: ChoiceId;
  readonly label: string;
  readonly action: ChoiceAction;
  readonly value?: number | string;
  readonly toggleState?: "selected" | "unselected";
  readonly allocationMaximum?: number;
  /** Engine-side address of the card this choice acts on, when it has one. */
  readonly cardAddress?: {
    readonly controller: PlayerIndex;
    readonly location: PublicLocation;
    readonly sequence: number;
  };
  /** Engine-attested card code for own-card (controller 0) choices. Never set for opponent cards. */
  readonly cardCode?: CardCode;
}

export interface InteractionConstraints {
  readonly controlFamily: PromptControlFamily;
  readonly minimum: number;
  readonly maximum: number;
  readonly cancelable: boolean;
  readonly ordered: boolean;
  readonly requiredTotal?: number;
  readonly sumMode?: "exact" | "atLeast";
  readonly mandatoryContributions: readonly PromptContribution[];
}

export type ActiveInteractionKind =
  | "cardAction"
  | "cardSelection"
  | "placeSelection"
  | "counterAllocation"
  | "order"
  | "nonField";

interface ActiveInteractionSpecBase<Kind extends ActiveInteractionKind> {
  readonly kind: Kind;
  readonly key: InteractionKey;
  readonly promptKind: PromptKind;
  readonly player: PlayerPrompt["player"];
  readonly title: string;
  readonly message?: string;
  readonly fieldCapable: boolean;
  readonly constraints: InteractionConstraints;
  readonly cardChoices: ReadonlyMap<
    BoardTargetId,
    readonly InteractionChoice[]
  >;
  readonly zoneChoices: ReadonlyMap<
    BoardTargetId,
    readonly InteractionChoice[]
  >;
  readonly stackChoices: ReadonlyMap<
    BoardTargetId,
    readonly InteractionChoice[]
  >;
  readonly globalChoices: ReadonlyMap<ChoiceId, InteractionChoice>;
  /* T10: every choice the engine addressed as an overlay unit (Xyz material).
     A material has no mounted control of its own — it rides on its host's
     zone — so it answers through the visual material dialog instead of the
     plain text prompt list. */
  readonly overlayChoices: ReadonlyMap<ChoiceId, InteractionChoice>;
  /* T16: every card-selection choice that lives off the mounted field, in raw
     prompt order. The same choice also stays in its launcher map (card or
     stack) so the hand card or pile that owns it can reopen the target list. */
  readonly offFieldChoices: readonly InteractionChoice[];
  /* Raw prompt order of every choice this spec kept, whatever category it
     landed in. The single authority for submission order and for the reducer's
     "is this id answerable" test. */
  readonly choiceOrder: readonly ChoiceId[];
}

export type CardActionSpec = ActiveInteractionSpecBase<"cardAction">;

export type CardSelectionSpec = ActiveInteractionSpecBase<"cardSelection">;

export type PlaceSelectionSpec = ActiveInteractionSpecBase<"placeSelection">;

export type CounterAllocationSpec =
  ActiveInteractionSpecBase<"counterAllocation">;

export type OrderSpec = ActiveInteractionSpecBase<"order">;

export interface NonFieldSpec extends ActiveInteractionSpecBase<"nonField"> {
  readonly fieldCapable: false;
}

export type ActiveInteractionSpec =
  | CardActionSpec
  | CardSelectionSpec
  | PlaceSelectionSpec
  | CounterAllocationSpec
  | OrderSpec
  | NonFieldSpec;

export type InteractionSpec =
  { readonly kind: "inactive" } | ActiveInteractionSpec;

export const INTERACTION_SPEC_KINDS = {
  idleCommand: "cardAction",
  battleCommand: "cardAction",
  yesNo: "nonField",
  effectYesNo: "nonField",
  option: "nonField",
  chain: "cardAction",
  selectCard: "cardSelection",
  selectTribute: "cardSelection",
  selectSum: "cardSelection",
  selectUnselectCard: "cardSelection",
  selectPlace: "placeSelection",
  selectDisabledField: "placeSelection",
  selectPosition: "nonField",
  sortCard: "order",
  sortChain: "order",
  selectCounter: "counterAllocation",
  announceNumber: "nonField",
  announceAttribute: "nonField",
  announceRace: "nonField",
  announceCard: "nonField",
  rockPaperScissors: "nonField",
} as const satisfies Readonly<
  Record<PromptKind, ActiveInteractionSpec["kind"]>
>;

const CHOICE_ACTIONS = {
  summon: true,
  specialSummon: true,
  flipSummon: true,
  setMonster: true,
  setSpellTrap: true,
  activate: true,
  changePosition: true,
  attack: true,
  battlePhase: true,
  mainPhase2: true,
  endPhase: true,
  shuffle: true,
  yes: true,
  no: true,
  pass: true,
  cancel: true,
  finish: true,
  select: true,
} as const satisfies Readonly<Record<ChoiceAction, true>>;
const PUBLIC_LOCATIONS = {
  deck: true,
  hand: true,
  monster: true,
  spellTrap: true,
  field: true,
  graveyard: true,
  banished: true,
  extra: true,
} as const satisfies Readonly<Record<PublicLocation, true>>;
/** T16: the exact locations whose targets answer through the aggregate list. */
export const OFF_FIELD_TARGET_LOCATIONS: ReadonlySet<PublicLocation> =
  Object.freeze(
    new Set<PublicLocation>(["hand", "graveyard", "deck", "banished", "extra"]),
  );

const INACTIVE_SPEC = Object.freeze({ kind: "inactive" as const });

const PHASE_TRANSITION_ACTIONS = new Set<ChoiceAction>([
  "battlePhase",
  "mainPhase2",
  "endPhase",
]);

export function isPhaseTransitionChoice(
  choice: Pick<InteractionChoice, "action">,
): boolean {
  return PHASE_TRANSITION_ACTIONS.has(choice.action);
}

export function isImmediateSingleSelection(
  spec: ActiveInteractionSpec,
): boolean {
  return spec.constraints.minimum === 1 && spec.constraints.maximum === 1;
}

/**
 * Every choice this spec kept, in raw prompt order, deduped by id. Card, zone,
 * stack, global and off-field categories all flow through here, so a stack or
 * list-only choice can never be rejected as unknown by the session reducer.
 */
export function interactionChoicesInPromptOrder(
  spec: ActiveInteractionSpec,
): readonly InteractionChoice[] {
  const byId = new Map<ChoiceId, InteractionChoice>();
  for (const choices of [
    ...spec.cardChoices.values(),
    ...spec.zoneChoices.values(),
    ...spec.stackChoices.values(),
    spec.globalChoices.values(),
    spec.overlayChoices.values(),
    spec.offFieldChoices,
  ]) {
    for (const choice of choices)
      if (!byId.has(choice.id)) byId.set(choice.id, choice);
  }
  const ordered: InteractionChoice[] = [];
  const seen = new Set<ChoiceId>();
  for (const choiceId of spec.choiceOrder) {
    const choice = byId.get(choiceId);
    if (choice === undefined || seen.has(choiceId)) continue;
    seen.add(choiceId);
    ordered.push(choice);
  }
  return Object.freeze(ordered);
}

function nonPhaseGlobalChoiceCount(spec: ActiveInteractionSpec): number {
  return [...spec.globalChoices.values()].filter(
    (choice) => !isPhaseTransitionChoice(choice),
  ).length;
}

export function fieldActionBarRequired(spec: ActiveInteractionSpec): boolean {
  if (spec.kind === "nonField") return false;
  /* A genuine global choice (Finish, Cancel, Pass) has no field control of its
     own, so it keeps the window even in target mode: suppressing it would make
     an engine choice unanswerable, which is the exact defect T16 exists to
     fix. Phase transitions have the phase bar and never count. */
  if (nonPhaseGlobalChoiceCount(spec) > 0) return true;
  switch (spec.kind) {
    case "cardAction":
      return false;
    /* Feedback item 6: a selection prompt always keeps its status bar, so the
       count and sum stay visible from the first pick; the target window and
       the bar coexist. */
    case "cardSelection":
      return true;
    case "placeSelection":
      return !isImmediateSingleSelection(spec);
    case "counterAllocation":
    case "order":
      return true;
  }
}

export function endPhaseChoice(
  spec: ActiveInteractionSpec | null,
): InteractionChoice | null {
  if (spec === null) return null;
  for (const choice of spec.globalChoices.values()) {
    if (choice.action === "endPhase") return choice;
  }
  return null;
}

export function interactionKey(
  workerGeneration: number,
  sessionGeneration: number,
  promptId: PromptId,
): InteractionKey {
  return Object.freeze({ workerGeneration, sessionGeneration, promptId });
}

export function mapPromptToInteractionSpec(
  prompt: PlayerPrompt | null,
  snapshot: PublicDuelState | null,
  board: BoardViewModel | null,
  context: InteractionContext,
): InteractionSpec {
  if (prompt === null) return INACTIVE_SPEC;

  const kind: ActiveInteractionKind | undefined = (
    INTERACTION_SPEC_KINDS as Partial<Record<string, ActiveInteractionKind>>
  )[prompt.kind];
  if (kind === undefined) return INACTIVE_SPEC;

  const cardEntries = new Map<BoardTargetId, InteractionChoice[]>();
  const zoneEntries = new Map<BoardTargetId, InteractionChoice[]>();
  const stackEntries = new Map<BoardTargetId, InteractionChoice[]>();
  const globalEntries = new Map<ChoiceId, InteractionChoice>();
  const overlayEntries = new Map<ChoiceId, InteractionChoice>();
  const offFieldEntries: InteractionChoice[] = [];
  const orderedIds: ChoiceId[] = [];
  const duplicateIds = duplicateChoiceIds(prompt.choices);

  for (const rawChoice of prompt.choices) {
    const choice = sanitizeChoice(rawChoice);
    if (choice === undefined || duplicateIds.has(choice.id)) continue;

    const targetKind = targetKindFor(kind, rawChoice);
    if (targetKind === "invalid") continue;
    orderedIds.push(choice.id);
    /* T10: a material's engine address is its host's monster zone, so leaving
       it to resolve below would either answer as the host or fall through to
       the text prompt list. Diverted before either, real engine choices reach
       the visual dialog; auto-detach emits no choice. */
    if (kind === "cardSelection" && rawChoice.card?.overlay === true) {
      overlayEntries.set(choice.id, choice);
      continue;
    }
    /* An off-field target is collected here and still resolved below, so the
       hand card or pile holding it keeps its halo and stays a launcher. */
    if (
      kind === "cardSelection" &&
      choice.cardAddress !== undefined &&
      OFF_FIELD_TARGET_LOCATIONS.has(choice.cardAddress.location)
    ) {
      offFieldEntries.push(choice);
    }
    if (targetKind === "global" || board === null) {
      globalEntries.set(choice.id, choice);
      continue;
    }

    const resolution = resolvePromptChoiceBoardTarget(
      rawChoice,
      snapshot,
      board,
    );
    if (resolution.kind === "nonField") {
      globalEntries.set(choice.id, choice);
      continue;
    }
    if (resolution.kind === "stack") {
      appendChoice(stackEntries, resolution.targetId, choice);
      continue;
    }
    const entries = targetKind === "card" ? cardEntries : zoneEntries;
    appendChoice(entries, resolution.targetId, choice);
  }

  const cardChoices = freezeChoiceMap(cardEntries);
  const zoneChoices = freezeChoiceMap(zoneEntries);
  const stackChoices = freezeChoiceMap(stackEntries);
  const globalChoices = Object.freeze(new Map(globalEntries));
  const overlayChoices = Object.freeze(new Map(overlayEntries));
  const offFieldChoices = Object.freeze([...offFieldEntries]);
  const choiceOrder = Object.freeze([...orderedIds]);
  // T8: the zone list dialog makes a stack clickable and able to answer a
  // choice, so stackChoices now counts towards fieldCapable too.
  // T16: a target reachable only through the aggregate list counts as well.
  const fieldCapable =
    cardChoices.size > 0 ||
    zoneChoices.size > 0 ||
    stackChoices.size > 0 ||
    overlayChoices.size > 0 ||
    offFieldChoices.length > 0;
  const base = {
    key: interactionKey(
      context.workerGeneration,
      context.sessionGeneration,
      prompt.id,
    ),
    promptKind: prompt.kind,
    player: prompt.player,
    title: prompt.title,
    ...(prompt.message === undefined ? {} : { message: prompt.message }),
    fieldCapable,
    constraints: constraintsFor(prompt),
    cardChoices,
    zoneChoices,
    stackChoices,
    globalChoices,
    overlayChoices,
    offFieldChoices,
    choiceOrder,
  };

  switch (kind) {
    case "cardAction":
      return Object.freeze({ kind, ...base });
    case "cardSelection":
      return Object.freeze({ kind, ...base });
    case "placeSelection":
      return Object.freeze({ kind, ...base });
    case "counterAllocation":
      return Object.freeze({ kind, ...base });
    case "order":
      return Object.freeze({ kind, ...base });
    case "nonField":
      return Object.freeze({ kind, ...base, fieldCapable: false });
  }
}

function constraintsFor(prompt: PlayerPrompt): InteractionConstraints {
  const mandatoryContributions = Object.freeze(
    (prompt.mandatoryContributions ?? []).map((value) =>
      Object.freeze({ ...value }),
    ),
  );
  return Object.freeze({
    controlFamily: promptControlFamily(prompt.kind),
    minimum: prompt.minimum,
    maximum: prompt.maximum,
    cancelable: prompt.cancelable,
    ordered: prompt.ordered,
    ...(prompt.requiredTotal === undefined
      ? {}
      : { requiredTotal: prompt.requiredTotal }),
    ...(prompt.sumMode === undefined ? {} : { sumMode: prompt.sumMode }),
    mandatoryContributions,
  });
}

function sanitizeChoice(choice: PromptChoice): InteractionChoice | undefined {
  if (
    typeof choice !== "object" ||
    choice === null ||
    typeof choice.id !== "string" ||
    choice.id.length === 0 ||
    typeof choice.label !== "string" ||
    typeof choice.action !== "string" ||
    !Object.hasOwn(CHOICE_ACTIONS, choice.action) ||
    (choice.value !== undefined &&
      typeof choice.value !== "string" &&
      (typeof choice.value !== "number" || !Number.isFinite(choice.value))) ||
    (choice.selected !== undefined && typeof choice.selected !== "boolean") ||
    (choice.allocationMaximum !== undefined &&
      (!Number.isSafeInteger(choice.allocationMaximum) ||
        choice.allocationMaximum < 0))
  ) {
    return undefined;
  }
  return Object.freeze({
    id: choice.id,
    label: choice.label,
    action: choice.action,
    ...(choice.value === undefined ? {} : { value: choice.value }),
    ...(choice.selected === undefined
      ? {}
      : { toggleState: choice.selected ? "selected" : "unselected" }),
    ...(choice.allocationMaximum === undefined
      ? {}
      : { allocationMaximum: choice.allocationMaximum }),
    ...(isValidCardTarget(choice.card)
      ? {
          cardAddress: Object.freeze({
            controller: choice.card!.controller,
            location: choice.card!.location,
            sequence: choice.card!.sequence,
          }),
        }
      : {}),
    ...(isValidCardTarget(choice.card) &&
    choice.card!.controller === 0 &&
    choice.card!.code !== undefined
      ? { cardCode: choice.card!.code as CardCode }
      : {}),
  });
}

function targetKindFor(
  specKind: ActiveInteractionKind,
  choice: PromptChoice,
): "card" | "zone" | "global" | "invalid" {
  const hasCard = choice.card !== undefined;
  const hasPlace = choice.place !== undefined;
  if (hasCard && hasPlace) return "invalid";

  switch (specKind) {
    case "cardAction":
    case "cardSelection":
    case "order":
      if (hasPlace) return "invalid";
      return hasCard
        ? isValidCardTarget(choice.card)
          ? "card"
          : "invalid"
        : "global";
    case "counterAllocation":
      return hasCard && choice.allocationMaximum !== undefined
        ? isValidCardTarget(choice.card)
          ? "card"
          : "invalid"
        : hasCard
          ? "invalid"
          : "global";
    case "placeSelection":
      if (hasCard) return "invalid";
      return hasPlace
        ? isValidPlaceTarget(choice.place)
          ? "zone"
          : "invalid"
        : "global";
    case "nonField":
      return hasCard || hasPlace ? "invalid" : "global";
  }
}

function isValidCardTarget(card: PromptChoice["card"]): boolean {
  return (
    card !== undefined &&
    typeof card === "object" &&
    typeof card.instanceId === "string" &&
    card.instanceId.length > 0 &&
    (card.controller === 0 || card.controller === 1) &&
    typeof card.location === "string" &&
    Object.hasOwn(PUBLIC_LOCATIONS, card.location) &&
    Number.isSafeInteger(card.sequence) &&
    card.sequence >= 0
  );
}

function isValidPlaceTarget(place: PromptChoice["place"]): boolean {
  return (
    place !== undefined &&
    typeof place === "object" &&
    (place.player === 0 || place.player === 1) &&
    (place.location === "monster" ||
      place.location === "spellTrap" ||
      place.location === "field" ||
      place.location === "pendulum") &&
    Number.isSafeInteger(place.sequence) &&
    place.sequence >= 0
  );
}

function duplicateChoiceIds(
  choices: readonly PromptChoice[],
): ReadonlySet<ChoiceId> {
  const seen = new Set<ChoiceId>();
  const duplicates = new Set<ChoiceId>();
  for (const choice of choices) {
    if (typeof choice?.id !== "string") continue;
    if (seen.has(choice.id)) duplicates.add(choice.id);
    seen.add(choice.id);
  }
  return duplicates;
}

function appendChoice(
  entries: Map<BoardTargetId, InteractionChoice[]>,
  targetId: BoardTargetId,
  choice: InteractionChoice,
): void {
  const current = entries.get(targetId);
  if (current === undefined) entries.set(targetId, [choice]);
  else current.push(choice);
}

function freezeChoiceMap(
  entries: ReadonlyMap<BoardTargetId, readonly InteractionChoice[]>,
): ReadonlyMap<BoardTargetId, readonly InteractionChoice[]> {
  return Object.freeze(
    new Map(
      [...entries].map(([targetId, choices]) => [
        targetId,
        Object.freeze([...choices]),
      ]),
    ),
  );
}
