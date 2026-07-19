import { isCardIdentityVisible } from "../../duel/card-visibility.ts";
import { duelOperationError } from "../../duel/contracts/duel-error.ts";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
  type ChoiceId,
  type PromptId,
} from "../../duel/contracts/ids.ts";
import type {
  ChoiceAction,
  PlayerPrompt,
  PromptCard,
  PromptChoice,
  PromptKind,
  PromptPlace,
} from "../../duel/contracts/player-prompt.ts";
import type {
  CardPosition,
  PlayerIndex,
  PublicLocation,
} from "../../duel/contracts/public-duel-state.ts";
import type { ActiveDuelDependencies } from "../assets/active-duel-dependencies.ts";
import {
  EngineBattleAction,
  EngineIdleAction,
  EngineLocation,
  EngineMessageType,
  EnginePosition,
  EngineResponseType,
} from "../engine/engine-constants.ts";
import {
  engineCardMatchesOpcode,
  type EngineAttribute,
  type EngineFieldPlace,
  type EngineMessage,
  type EngineRace,
  type EngineResponse,
} from "../engine/OcgCoreAdapter.ts";
import {
  contributionOptions,
  decodeSumContribution,
  isValidContributionTotal,
} from "./sum-selection.ts";

interface ChoiceBinding {
  readonly choice: PromptChoice;
  readonly rawIndex: number;
}

export interface EnginePromptBinding {
  readonly prompt: PlayerPrompt;
  readonly resolve: (choiceIds: readonly ChoiceId[]) => EngineResponse;
}

export interface PromptDiagnostic {
  readonly type: "missing_text";
  readonly reference: string;
}

export type PromptDiagnosticSink = (diagnostic: PromptDiagnostic) => void;

export class PromptRegistry {
  readonly #dependencies: ActiveDuelDependencies;
  readonly #idNamespace: string;
  readonly #onDiagnostic: PromptDiagnosticSink;
  #sequence = 0;
  #current: EnginePromptBinding | null = null;

  constructor(
    dependencies: ActiveDuelDependencies,
    idNamespace = "",
    onDiagnostic: PromptDiagnosticSink = () => undefined,
  ) {
    this.#dependencies = dependencies;
    this.#idNamespace = idNamespace;
    this.#onDiagnostic = onDiagnostic;
  }

  publish(message: EngineMessage): PlayerPrompt | null {
    const binding = buildEnginePrompt(
      message,
      ++this.#sequence,
      this.#dependencies,
      this.#idNamespace,
      this.#onDiagnostic,
    );
    if (binding === null) return null;
    this.#current = binding;
    return binding.prompt;
  }

  respond(id: PromptId, choiceIds: readonly ChoiceId[]): EngineResponse {
    const current = this.#current;
    if (current === null) {
      throw duelOperationError(
        "invalid_response",
        "No prompt is awaiting a response",
      );
    }
    if (current.prompt.id !== id) {
      throw duelOperationError(
        "stale_prompt",
        `Stale or unknown prompt ID: ${id}`,
      );
    }
    try {
      const response = current.resolve(choiceIds);
      this.#current = null;
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw duelOperationError("invalid_response", message, error);
    }
  }

  clear(): void {
    this.#current = null;
  }

  get current(): PlayerPrompt | null {
    return this.#current?.prompt ?? null;
  }
}

export function buildEnginePrompt(
  message: EngineMessage,
  sequence: number,
  dependencies: ActiveDuelDependencies,
  idNamespace = "",
  onDiagnostic: PromptDiagnosticSink = () => undefined,
): EnginePromptBinding | null {
  const raw = buildRawEnginePrompt(
    message,
    sequence,
    dependencies,
    idNamespace,
    onDiagnostic,
  );
  if (raw === null) return null;
  const contextCard =
    message.type === EngineMessageType.SELECT_EFFECT_YES_NO
      ? toPromptCard(message)
      : raw.prompt.contextCard;
  const effectMessage =
    message.type === EngineMessageType.SELECT_EFFECT_YES_NO &&
    message.description !== 0n
      ? describeOption(message.description, dependencies, onDiagnostic)
      : undefined;
  return {
    ...raw,
    prompt: enrichPlayerPrompt(
      {
        ...raw.prompt,
        ...(contextCard === undefined ? {} : { contextCard }),
        ...(effectMessage === undefined ? {} : { message: effectMessage }),
      },
      dependencies,
    ),
  };
}

function buildRawEnginePrompt(
  message: EngineMessage,
  sequence: number,
  dependencies: ActiveDuelDependencies,
  idNamespace = "",
  onDiagnostic: PromptDiagnosticSink = () => undefined,
): EnginePromptBinding | null {
  const id = promptId(
    idNamespace.length === 0
      ? `prompt-${sequence}`
      : `${idNamespace}-prompt-${sequence}`,
  );
  const text = (code: number): string => {
    const value = dependencies.texts.get(code)?.name;
    if (value !== undefined) return value;
    onDiagnostic({ type: "missing_text", reference: `card:${code}` });
    return `Card ${code}`;
  };

  switch (message.type) {
    case EngineMessageType.SELECT_IDLE_COMMAND: {
      const bindings: ChoiceBinding[] = [];
      addCardActions(bindings, id, message.summons, "summon", "Summon", text);
      addCardActions(
        bindings,
        id,
        message.special_summons,
        "specialSummon",
        "Special Summon",
        text,
      );
      addCardActions(
        bindings,
        id,
        message.pos_changes,
        "changePosition",
        "Change position",
        text,
      );
      addCardActions(
        bindings,
        id,
        message.monster_sets,
        "setMonster",
        "Set",
        text,
      );
      addCardActions(
        bindings,
        id,
        message.spell_sets,
        "setSpellTrap",
        "Set",
        text,
      );
      addCardActions(
        bindings,
        id,
        message.activates,
        "activate",
        "Activate",
        text,
      );
      if (message.to_bp)
        addSimpleChoice(bindings, id, "battlePhase", "Enter Battle Phase");
      if (message.to_ep) addSimpleChoice(bindings, id, "endPhase", "End turn");
      if (message.shuffle)
        addSimpleChoice(bindings, id, "shuffle", "Shuffle Deck");
      return binding(
        prompt(
          id,
          "idleCommand",
          asPlayer(message.player),
          "Choose a Main Phase action",
          bindings,
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          const action = idleAction(selected.choice.action);
          return {
            type: EngineResponseType.SELECT_IDLE_COMMAND,
            action,
            index: actionIndexRequired(action) ? selected.rawIndex : null,
          };
        },
      );
    }
    case EngineMessageType.SELECT_BATTLE_COMMAND: {
      const bindings: ChoiceBinding[] = [];
      addCardActions(
        bindings,
        id,
        message.chains,
        "activate",
        "Activate",
        text,
      );
      addCardActions(
        bindings,
        id,
        message.attacks,
        "attack",
        "Attack with",
        text,
      );
      if (message.to_m2)
        addSimpleChoice(bindings, id, "mainPhase2", "Enter Main Phase 2");
      if (message.to_ep)
        addSimpleChoice(bindings, id, "endPhase", "End Battle Phase");
      return binding(
        prompt(
          id,
          "battleCommand",
          asPlayer(message.player),
          "Choose a Battle Phase action",
          bindings,
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          const action = battleAction(selected.choice.action);
          return {
            type: EngineResponseType.SELECT_BATTLE_COMMAND,
            action,
            index:
              action === EngineBattleAction.ACTIVATE ||
              action === EngineBattleAction.ATTACK
                ? selected.rawIndex
                : null,
          };
        },
      );
    }
    case EngineMessageType.SELECT_YES_NO:
    case EngineMessageType.SELECT_EFFECT_YES_NO: {
      const kind: PromptKind =
        message.type === EngineMessageType.SELECT_EFFECT_YES_NO
          ? "effectYesNo"
          : "yesNo";
      const player = asPlayer(message.player);
      const bindings = yesNoChoices(id);
      return binding(prompt(id, kind, player, "Confirm", bindings), (ids) => {
        const selected = exactlyOne(ids, bindings);
        return message.type === EngineMessageType.SELECT_EFFECT_YES_NO
          ? {
              type: EngineResponseType.SELECT_EFFECT_YES_NO,
              yes: selected.choice.action === "yes",
            }
          : {
              type: EngineResponseType.SELECT_YES_NO,
              yes: selected.choice.action === "yes",
            };
      });
    }
    case EngineMessageType.SELECT_OPTION: {
      const bindings = message.options.map((option, index) =>
        makeBinding(
          id,
          index,
          "select",
          describeOption(option, dependencies, onDiagnostic),
          String(option),
        ),
      );
      return binding(
        prompt(
          id,
          "option",
          asPlayer(message.player),
          "Choose an option",
          bindings,
        ),
        (ids) => ({
          type: EngineResponseType.SELECT_OPTION,
          index: exactlyOne(ids, bindings).rawIndex,
        }),
      );
    }
    case EngineMessageType.SELECT_CHAIN: {
      const bindings: ChoiceBinding[] = [];
      addCardActions(bindings, id, message.selects, "activate", "Chain", text);
      if (!message.forced) addSimpleChoice(bindings, id, "pass", "Pass");
      return binding(
        prompt(
          id,
          "chain",
          asPlayer(message.player),
          "Choose a chain response",
          bindings,
          {
            cancelable: !message.forced,
          },
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          return {
            type: EngineResponseType.SELECT_CHAIN,
            index: selected.choice.action === "pass" ? null : selected.rawIndex,
          };
        },
      );
    }
    case EngineMessageType.SELECT_CARD:
      return multiCardPrompt(
        id,
        "selectCard",
        asPlayer(message.player),
        "Select card(s)",
        message.selects,
        message.min,
        message.max,
        message.can_cancel,
        EngineResponseType.SELECT_CARD,
        text,
      );
    case EngineMessageType.SELECT_TRIBUTE:
      return multiCardPrompt(
        id,
        "selectTribute",
        asPlayer(message.player),
        "Select tribute(s)",
        message.selects,
        message.min,
        message.max,
        message.can_cancel,
        EngineResponseType.SELECT_TRIBUTE,
        text,
      );
    case EngineMessageType.SELECT_SUM: {
      const bindings = message.selects.map((card, index) =>
        makeCardBinding(id, index, "select", text(card.code), card),
      );
      const sumMode = message.select_max === 0 ? "exact" : "atLeast";
      const minimum = sumMode === "exact" ? message.min : 0;
      const maximum = sumMode === "exact" ? message.max : bindings.length;
      const mandatoryContributions = Object.freeze(
        message.selects_must.map((card) =>
          Object.freeze(decodeSumContribution(card.amount)),
        ),
      );
      return binding(
        prompt(
          id,
          "selectSum",
          asPlayer(message.player),
          "Select a valid total",
          bindings,
          {
            minimum,
            maximum,
            requiredTotal: message.amount,
            sumMode,
            mandatoryContributions,
          },
        ),
        (ids) => {
          const selected = selectedBindings(ids, bindings);
          requireSelectionCount(selected, minimum, maximum, false);
          const selectedCards = selected.map((choice) => {
            const card = message.selects[choice.rawIndex];
            if (card === undefined)
              throw new Error("Unknown sum-selection card");
            return card;
          });
          const contributions = [...message.selects_must, ...selectedCards].map(
            (card) => contributionOptions(decodeSumContribution(card.amount)),
          );
          if (
            !isValidContributionTotal(contributions, message.amount, sumMode)
          ) {
            throw new Error(
              `Selected cards do not satisfy the ${sumMode === "exact" ? "exact" : "minimum"} total ${message.amount}`,
            );
          }
          return {
            type: EngineResponseType.SELECT_SUM,
            indicies: selected.map((choice) => choice.rawIndex),
          };
        },
      );
    }
    case EngineMessageType.SELECT_UNSELECT_CARD: {
      const cards = [...message.select_cards, ...message.unselect_cards];
      const bindings = cards.map((card, index) =>
        makeCardBinding(
          id,
          index,
          "select",
          text(card.code),
          card,
          index >= message.select_cards.length,
        ),
      );
      if (message.can_finish) addSimpleChoice(bindings, id, "finish", "Finish");
      if (message.can_cancel) addSimpleChoice(bindings, id, "cancel", "Cancel");
      return binding(
        prompt(
          id,
          "selectUnselectCard",
          asPlayer(message.player),
          "Select or unselect a card",
          bindings,
          {
            minimum: message.min,
            maximum: message.max,
            cancelable: message.can_cancel,
          },
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          return {
            type: EngineResponseType.SELECT_UNSELECT_CARD,
            index:
              selected.choice.action === "cancel" ||
              selected.choice.action === "finish"
                ? null
                : selected.rawIndex,
          };
        },
      );
    }
    case EngineMessageType.SELECT_PLACE:
    case EngineMessageType.SELECT_DISABLED_FIELD: {
      const places = decodeAvailablePlaces(
        message.field_mask,
        asPlayer(message.player),
      );
      const bindings = places.map((place, index) =>
        makePlaceBinding(id, index, place),
      );
      const kind: PromptKind =
        message.type === EngineMessageType.SELECT_PLACE
          ? "selectPlace"
          : "selectDisabledField";
      return binding(
        prompt(
          id,
          kind,
          asPlayer(message.player),
          "Select field location(s)",
          bindings,
          {
            minimum: message.count,
            maximum: message.count,
          },
        ),
        (ids) => {
          const selected = selectedBindings(ids, bindings);
          requireSelectionCount(selected, message.count, message.count, false);
          const rawPlaces = selected.map((selectedChoice) => {
            const place = places[selectedChoice.rawIndex];
            if (place === undefined)
              throw new Error("Unknown selected field location");
            return {
              player: place.player,
              location: publicToEngineLocation(place.location),
              sequence: place.sequence,
            };
          });
          return message.type === EngineMessageType.SELECT_PLACE
            ? { type: EngineResponseType.SELECT_PLACE, places: rawPlaces }
            : {
                type: EngineResponseType.SELECT_DISABLED_FIELD,
                places: rawPlaces,
              };
        },
      );
    }
    case EngineMessageType.SELECT_POSITION: {
      const positions = [
        EnginePosition.FACE_UP_ATTACK,
        EnginePosition.FACE_DOWN_ATTACK,
        EnginePosition.FACE_UP_DEFENSE,
        EnginePosition.FACE_DOWN_DEFENSE,
      ].filter((position) => (message.positions & position) !== 0);
      const bindings = positions.map((position, index) =>
        makeBinding(id, index, "select", positionLabel(position), position),
      );
      return binding(
        prompt(
          id,
          "selectPosition",
          asPlayer(message.player),
          `Choose position for ${text(message.code)}`,
          bindings,
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          const position = positions[selected.rawIndex];
          if (position === undefined)
            throw new Error("Unknown selected position");
          return { type: EngineResponseType.SELECT_POSITION, position };
        },
      );
    }
    case EngineMessageType.SORT_CARD:
    case EngineMessageType.SORT_CHAIN: {
      const bindings = message.cards.map((card, index) =>
        makeCardBinding(id, index, "select", text(card.code), card),
      );
      const kind: PromptKind =
        message.type === EngineMessageType.SORT_CARD ? "sortCard" : "sortChain";
      return binding(
        prompt(id, kind, asPlayer(message.player), "Choose order", bindings, {
          minimum: bindings.length,
          maximum: bindings.length,
          ordered: true,
          cancelable: true,
        }),
        (ids) => {
          if (ids.length === 0)
            return { type: EngineResponseType.SORT_CARD, order: null };
          const selected = selectedBindings(ids, bindings);
          requireSelectionCount(
            selected,
            bindings.length,
            bindings.length,
            false,
          );
          return {
            type: EngineResponseType.SORT_CARD,
            order: selected.map((choice) => choice.rawIndex),
          };
        },
      );
    }
    case EngineMessageType.SELECT_COUNTER: {
      const bindings = message.cards.map((card, index) => {
        const cardBinding = makeCardBinding(
          id,
          index,
          "select",
          `${text(card.code)} (${card.count} available)`,
          card,
        );
        return {
          ...cardBinding,
          choice: {
            ...cardBinding.choice,
            allocationMaximum: card.count,
          },
        };
      });
      return binding(
        prompt(
          id,
          "selectCounter",
          asPlayer(message.player),
          `Allocate ${message.count} counter(s)`,
          bindings,
          {
            minimum: message.count,
            maximum: message.count,
          },
        ),
        (ids) => {
          const selected = selectedBindings(ids, bindings, true);
          if (selected.length !== message.count)
            throw new Error(`Select exactly ${message.count} counters`);
          const counters = message.cards.map(() => 0);
          for (const choice of selected) {
            const card = message.cards[choice.rawIndex];
            if (
              card === undefined ||
              (counters[choice.rawIndex] ?? 0) >= card.count
            ) {
              throw new Error(
                "Counter allocation exceeds an available card count",
              );
            }
            counters[choice.rawIndex] = (counters[choice.rawIndex] ?? 0) + 1;
          }
          return { type: EngineResponseType.SELECT_COUNTER, counters };
        },
      );
    }
    case EngineMessageType.ANNOUNCE_NUMBER: {
      const bindings = message.options.map((option, index) =>
        makeBinding(id, index, "select", String(option), Number(option)),
      );
      return binding(
        prompt(
          id,
          "announceNumber",
          asPlayer(message.player),
          "Announce a number",
          bindings,
        ),
        (ids) => ({
          type: EngineResponseType.ANNOUNCE_NUMBER,
          value: Number(message.options[exactlyOne(ids, bindings).rawIndex]),
        }),
      );
    }
    case EngineMessageType.ANNOUNCE_ATTRIBUTE:
    case EngineMessageType.ANNOUNCE_RACE: {
      const available = BigInt(message.available);
      const values = bits(available);
      const bindings = values.map((value, index) =>
        makeBinding(
          id,
          index,
          "select",
          `${kindLabel(message.type)} ${value}`,
          value.toString(),
        ),
      );
      const kind: PromptKind =
        message.type === EngineMessageType.ANNOUNCE_ATTRIBUTE
          ? "announceAttribute"
          : "announceRace";
      return binding(
        prompt(
          id,
          kind,
          asPlayer(message.player),
          `Announce ${message.count}`,
          bindings,
          {
            minimum: message.count,
            maximum: message.count,
          },
        ),
        (ids) => {
          const selected = selectedBindings(ids, bindings);
          requireSelectionCount(selected, message.count, message.count, false);
          const selectedValues = selected.map(
            (choice) => values[choice.rawIndex] ?? 0n,
          );
          return message.type === EngineMessageType.ANNOUNCE_ATTRIBUTE
            ? {
                type: EngineResponseType.ANNOUNCE_ATTRIBUTE,
                attributes: selectedValues.map(asEngineAttribute),
              }
            : {
                type: EngineResponseType.ANNOUNCE_RACE,
                races: selectedValues.map(asEngineRace),
              };
        },
      );
    }
    case EngineMessageType.ANNOUNCE_CARD: {
      const candidates = [...dependencies.cards.values()].filter((card) =>
        engineCardMatchesOpcode(card, message.opcodes),
      );
      const bindings = candidates.map((card, index) =>
        makeBinding(id, index, "select", text(card.code), card.code),
      );
      return binding(
        prompt(
          id,
          "announceCard",
          asPlayer(message.player),
          "Announce a card",
          bindings,
        ),
        (ids) => {
          const selected = exactlyOne(ids, bindings);
          const candidate = candidates[selected.rawIndex];
          if (candidate === undefined)
            throw new Error("Unknown announced card");
          return {
            type: EngineResponseType.ANNOUNCE_CARD,
            card: candidate.code,
          };
        },
      );
    }
    case EngineMessageType.ROCK_PAPER_SCISSORS: {
      const bindings = [
        makeBinding(id, 0, "select", "Scissors", 1),
        makeBinding(id, 1, "select", "Rock", 2),
        makeBinding(id, 2, "select", "Paper", 3),
      ];
      return binding(
        prompt(
          id,
          "rockPaperScissors",
          asPlayer(message.player),
          "Choose",
          bindings,
        ),
        (ids) => {
          const value = Number(exactlyOne(ids, bindings).choice.value);
          if (value !== 1 && value !== 2 && value !== 3)
            throw new Error("Invalid hand choice");
          return { type: EngineResponseType.ROCK_PAPER_SCISSORS, value };
        },
      );
    }
    default:
      return null;
  }
}

function enrichPlayerPrompt(
  value: PlayerPrompt,
  dependencies: ActiveDuelDependencies,
): PlayerPrompt {
  const enrichCard = (card: PromptCard): PromptCard => {
    if (!isPromptCardIdentityVisible(card, value.player)) {
      const redacted = { ...card };
      delete redacted.code;
      delete redacted.name;
      delete redacted.description;
      return Object.freeze(redacted);
    }
    const cardText =
      card.code === undefined ? undefined : dependencies.texts.get(card.code);
    if (cardText === undefined) return card;
    return Object.freeze({
      ...card,
      name: cardText.name,
      description: cardText.description,
    });
  };
  return Object.freeze({
    ...value,
    ...(value.contextCard === undefined
      ? {}
      : { contextCard: enrichCard(value.contextCard) }),
    choices: Object.freeze(
      value.choices.map((choice) => {
        const card =
          choice.card === undefined ? undefined : enrichCard(choice.card);
        const identityRedacted =
          choice.card !== undefined &&
          !isPromptCardIdentityVisible(choice.card, value.player);
        return Object.freeze({
          ...choice,
          ...(identityRedacted ? { label: "Hidden card" } : {}),
          ...(card === undefined ? {} : { card }),
        });
      }),
    ),
  });
}

function isPromptCardIdentityVisible(
  card: PromptCard,
  viewer: PlayerIndex,
): boolean {
  return isCardIdentityVisible(
    viewer,
    card.controller,
    card.location,
    card.position,
  );
}

function prompt(
  id: PromptId,
  kind: PromptKind,
  player: PlayerIndex,
  title: string,
  bindings: readonly ChoiceBinding[],
  overrides: Partial<
    Pick<
      PlayerPrompt,
      | "minimum"
      | "maximum"
      | "cancelable"
      | "ordered"
      | "requiredTotal"
      | "sumMode"
      | "mandatoryContributions"
    >
  > = {},
): PlayerPrompt {
  return Object.freeze({
    id,
    kind,
    player,
    title,
    choices: Object.freeze(bindings.map(({ choice }) => Object.freeze(choice))),
    minimum: overrides.minimum ?? 1,
    maximum: overrides.maximum ?? 1,
    cancelable: overrides.cancelable ?? false,
    ordered: overrides.ordered ?? false,
    ...(overrides.requiredTotal === undefined
      ? {}
      : { requiredTotal: overrides.requiredTotal }),
    ...(overrides.sumMode === undefined ? {} : { sumMode: overrides.sumMode }),
    ...(overrides.mandatoryContributions === undefined
      ? {}
      : { mandatoryContributions: overrides.mandatoryContributions }),
  });
}

function binding(
  promptValue: PlayerPrompt,
  resolve: EnginePromptBinding["resolve"],
): EnginePromptBinding {
  return { prompt: promptValue, resolve };
}

function multiCardPrompt(
  id: PromptId,
  kind: "selectCard" | "selectTribute",
  player: PlayerIndex,
  title: string,
  cards: readonly {
    code: number;
    controller: 0 | 1;
    location: number;
    sequence: number;
    position?: number;
    release_param?: number;
  }[],
  minimum: number,
  maximum: number,
  cancelable: boolean,
  responseType:
    | typeof EngineResponseType.SELECT_CARD
    | typeof EngineResponseType.SELECT_TRIBUTE,
  text: (code: number) => string,
): EnginePromptBinding {
  const bindings = cards.map((card, index) =>
    makeCardBinding(id, index, "select", text(card.code), card),
  );
  return binding(
    prompt(id, kind, player, title, bindings, { minimum, maximum, cancelable }),
    (ids) => {
      const selected = selectedBindings(ids, bindings);
      requireSelectionCount(selected, minimum, maximum, cancelable);
      const indicies =
        selected.length === 0
          ? null
          : selected.map((choice) => choice.rawIndex);
      return responseType === EngineResponseType.SELECT_CARD
        ? { type: EngineResponseType.SELECT_CARD, indicies }
        : { type: EngineResponseType.SELECT_TRIBUTE, indicies };
    },
  );
}

function addCardActions(
  bindings: ChoiceBinding[],
  id: PromptId,
  cards: readonly {
    code: number;
    controller: 0 | 1;
    location: number;
    sequence: number;
    position?: number;
  }[],
  action: ChoiceAction,
  verb: string,
  text: (code: number) => string,
): void {
  cards.forEach((card, index) =>
    bindings.push(
      makeCardBinding(id, index, action, `${verb} ${text(card.code)}`, card),
    ),
  );
}

function addSimpleChoice(
  bindings: ChoiceBinding[],
  id: PromptId,
  action: ChoiceAction,
  label: string,
): void {
  bindings.push(makeBinding(id, bindings.length, action, label));
}

function makeCardBinding(
  id: PromptId,
  rawIndex: number,
  action: ChoiceAction,
  label: string,
  card: {
    code: number;
    controller: 0 | 1;
    location: number;
    sequence: number;
    position?: number;
    amount?: number;
    release_param?: number;
  },
  selected = false,
): ChoiceBinding {
  return {
    rawIndex,
    choice: {
      id: choiceId(`${id}-choice-${rawIndex}-${action}`),
      label,
      action,
      card: toPromptCard(card),
      selected,
    },
  };
}

function makePlaceBinding(
  id: PromptId,
  rawIndex: number,
  place: PromptPlace,
): ChoiceBinding {
  return {
    rawIndex,
    choice: {
      id: choiceId(`${id}-choice-place-${rawIndex}`),
      label: `${place.player === 0 ? "Your" : "Opponent"} ${place.location} ${place.sequence + 1}`,
      action: "select",
      place,
    },
  };
}

function makeBinding(
  id: PromptId,
  rawIndex: number,
  action: ChoiceAction,
  label: string,
  value?: number | string,
): ChoiceBinding {
  return {
    rawIndex,
    choice: {
      id: choiceId(`${id}-choice-${rawIndex}-${action}`),
      label,
      action,
      ...(value === undefined ? {} : { value }),
    },
  };
}

function yesNoChoices(id: PromptId): ChoiceBinding[] {
  return [makeBinding(id, 0, "yes", "Yes"), makeBinding(id, 1, "no", "No")];
}

function exactlyOne(
  ids: readonly ChoiceId[],
  bindings: readonly ChoiceBinding[],
): ChoiceBinding {
  if (ids.length !== 1) throw new Error("Select exactly one choice");
  const selected = bindings.find(({ choice }) => choice.id === ids[0]);
  if (selected === undefined)
    throw new Error(`Unknown choice ID: ${String(ids[0])}`);
  return selected;
}

function selectedBindings(
  ids: readonly ChoiceId[],
  bindings: readonly ChoiceBinding[],
  allowDuplicates = false,
): ChoiceBinding[] {
  if (!allowDuplicates && new Set(ids).size !== ids.length)
    throw new Error("Duplicate choice IDs are not allowed");
  return ids.map((id) => {
    const selected = bindings.find(({ choice }) => choice.id === id);
    if (selected === undefined) throw new Error(`Unknown choice ID: ${id}`);
    return selected;
  });
}

function requireSelectionCount(
  selected: readonly ChoiceBinding[],
  minimum: number,
  maximum: number,
  cancelable: boolean,
): void {
  if (selected.length === 0 && cancelable) return;
  if (selected.length < minimum || selected.length > maximum) {
    throw new Error(`Select between ${minimum} and ${maximum} choices`);
  }
}

function idleAction(action: ChoiceAction): number {
  switch (action) {
    case "summon":
      return EngineIdleAction.SUMMON;
    case "specialSummon":
      return EngineIdleAction.SPECIAL_SUMMON;
    case "changePosition":
    case "flipSummon":
      return EngineIdleAction.CHANGE_POSITION;
    case "setMonster":
      return EngineIdleAction.SET_MONSTER;
    case "setSpellTrap":
      return EngineIdleAction.SET_SPELL_TRAP;
    case "activate":
      return EngineIdleAction.ACTIVATE;
    case "battlePhase":
      return EngineIdleAction.BATTLE_PHASE;
    case "endPhase":
      return EngineIdleAction.END_PHASE;
    case "shuffle":
      return EngineIdleAction.SHUFFLE;
    default:
      throw new Error(`Choice action is not an idle command: ${action}`);
  }
}

function actionIndexRequired(action: number): boolean {
  return (
    action >= EngineIdleAction.SUMMON && action <= EngineIdleAction.ACTIVATE
  );
}

function battleAction(action: ChoiceAction): number {
  switch (action) {
    case "activate":
      return EngineBattleAction.ACTIVATE;
    case "attack":
      return EngineBattleAction.ATTACK;
    case "mainPhase2":
      return EngineBattleAction.MAIN_PHASE_2;
    case "endPhase":
      return EngineBattleAction.END_PHASE;
    default:
      throw new Error(`Choice action is not a battle command: ${action}`);
  }
}

function toPromptCard(card: {
  code: number;
  controller: 0 | 1;
  location: number;
  sequence: number;
  position?: number;
  amount?: number;
  release_param?: number;
}): PromptCard {
  return {
    instanceId: cardInstanceId(
      `p${card.controller}-l${card.location}-s${card.sequence}`,
    ),
    ...(card.code > 0 ? { code: cardCode(card.code) } : {}),
    controller: card.controller,
    location: engineToPublicLocation(card.location),
    sequence: card.sequence,
    ...(card.position === undefined
      ? {}
      : { position: engineToPublicPosition(card.position) }),
    ...(card.amount === undefined
      ? card.release_param === undefined
        ? {}
        : { contribution: card.release_param }
      : decodeSumContribution(card.amount)),
  };
}

function engineToPublicLocation(location: number): PublicLocation {
  switch (location & ~EngineLocation.OVERLAY) {
    case EngineLocation.DECK:
      return "deck";
    case EngineLocation.HAND:
      return "hand";
    case EngineLocation.MONSTER:
      return "monster";
    case EngineLocation.SPELL_TRAP:
      return "spellTrap";
    case EngineLocation.FIELD:
      return "field";
    case EngineLocation.GRAVEYARD:
      return "graveyard";
    case EngineLocation.BANISHED:
      return "banished";
    case EngineLocation.EXTRA:
      return "extra";
    default:
      return "hand";
  }
}

function engineToPublicPosition(position: number): CardPosition {
  if ((position & EnginePosition.FACE_UP_ATTACK) !== 0) return "faceUpAttack";
  if ((position & EnginePosition.FACE_DOWN_ATTACK) !== 0)
    return "faceDownAttack";
  if ((position & EnginePosition.FACE_UP_DEFENSE) !== 0) return "faceUpDefense";
  return "faceDownDefense";
}

function decodeAvailablePlaces(
  mask: number,
  selectingPlayer: PlayerIndex,
): PromptPlace[] {
  const otherPlayer: PlayerIndex = selectingPlayer === 0 ? 1 : 0;
  const groups: readonly [
    offset: number,
    player: PlayerIndex,
    location: PromptPlace["location"],
  ][] = [
    [0, selectingPlayer, "monster"],
    [8, selectingPlayer, "spellTrap"],
    [16, otherPlayer, "monster"],
    [24, otherPlayer, "spellTrap"],
  ];
  const places: PromptPlace[] = [];
  for (const [offset, player, location] of groups) {
    for (let sequence = 0; sequence < 8; sequence += 1) {
      if ((mask & (1 << (offset + sequence))) === 0)
        places.push({ player, location, sequence });
    }
  }
  return places;
}

function publicToEngineLocation(
  location: PromptPlace["location"],
): EngineFieldPlace["location"] {
  switch (location) {
    case "monster":
      return EngineLocation.MONSTER;
    case "spellTrap":
      return EngineLocation.SPELL_TRAP;
    case "field":
      return EngineLocation.FIELD;
    case "pendulum":
      return EngineLocation.PENDULUM;
  }
}

function asEngineAttribute(value: bigint): EngineAttribute {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 64) {
    throw new Error(`Invalid engine attribute: ${value}`);
  }
  return numeric as EngineAttribute;
}

function asEngineRace(value: bigint): EngineRace {
  if (value < 1n || value > 0x80000000n)
    throw new Error(`Invalid engine race: ${value}`);
  return value as EngineRace;
}

function positionLabel(position: number): string {
  switch (position) {
    case EnginePosition.FACE_UP_ATTACK:
      return "Face-up Attack";
    case EnginePosition.FACE_DOWN_ATTACK:
      return "Face-down Attack";
    case EnginePosition.FACE_UP_DEFENSE:
      return "Face-up Defense";
    case EnginePosition.FACE_DOWN_DEFENSE:
      return "Face-down Defense";
    default:
      return `Position ${position}`;
  }
}

function describeOption(
  option: bigint,
  dependencies: ActiveDuelDependencies,
  onDiagnostic: PromptDiagnosticSink,
): string {
  const code = Number(option >> 20n);
  const index = Number(option & 0xfffffn);
  const text = dependencies.texts.get(code);
  const value =
    text?.strings[index] ||
    text?.name ||
    (code === 0 ? dependencies.strings.system[String(index)] : undefined);
  if (value !== undefined) return value;
  onDiagnostic({
    type: "missing_text",
    reference: `option:${option.toString()}`,
  });
  return `Option ${option}`;
}

function bits(mask: bigint): bigint[] {
  const result: bigint[] = [];
  for (let bit = 0n; bit < 64n; bit += 1n) {
    const value = 1n << bit;
    if ((mask & value) !== 0n) result.push(value);
  }
  return result;
}

function kindLabel(type: number): string {
  return type === EngineMessageType.ANNOUNCE_ATTRIBUTE ? "Attribute" : "Race";
}

function asPlayer(value: number): PlayerIndex {
  if (value !== 0 && value !== 1)
    throw new Error(`Unsupported player index: ${value}`);
  return value;
}
