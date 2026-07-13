import {
  cardCode,
  cardInstanceId,
  type CardCode,
  type CardInstanceId,
  type SnapshotId,
} from "../../duel/contracts/ids.ts";
import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";
import type { DuelResult } from "../../duel/contracts/duel-result.ts";
import type {
  CardPosition,
  DuelPhase,
  PlayerIndex,
  PublicCard,
  PublicDuelState,
  PublicLocation,
  PublicPlayerState,
} from "../../duel/contracts/public-duel-state.ts";
import {
  EngineLocation,
  EngineMessageType,
  EnginePhase,
  EnginePosition,
} from "../engine/engine-constants.ts";
import type { EngineMessage } from "../engine/OcgCoreAdapter.ts";

interface MutableCard {
  instanceId: CardInstanceId;
  code?: CardCode;
  owner: PlayerIndex;
  controller: PlayerIndex;
  location: PublicLocation;
  sequence: number;
  position: CardPosition;
  faceUp: boolean;
  overlayMaterials: CardInstanceId[];
}

interface MutablePlayer {
  lifePoints: number;
  deckCount: number;
  extraDeckCount: number;
  handCount: number;
  hand: MutableCard[];
  monsters: MutableCard[];
  spellsAndTraps: MutableCard[];
  graveyard: MutableCard[];
  banished: MutableCard[];
}

export interface ProjectionUpdate {
  readonly events: readonly DuelPresentationEvent[];
  readonly result?: DuelResult;
}

export class DuelStateProjector {
  readonly #snapshotId: SnapshotId;
  readonly #players: [MutablePlayer, MutablePlayer];
  #revision = 0;
  #turn = 0;
  #turnPlayer: PlayerIndex = 0;
  #phase: DuelPhase = "unknown";
  #chainSize = 0;
  #cardSequence = 0;

  constructor(
    snapshotId: SnapshotId,
    deckCounts: readonly [number, number],
    extraDeckCounts: readonly [number, number],
  ) {
    this.#snapshotId = snapshotId;
    this.#players = [
      mutablePlayer(deckCounts[0], extraDeckCounts[0]),
      mutablePlayer(deckCounts[1], extraDeckCounts[1]),
    ];
  }

  apply(message: EngineMessage): ProjectionUpdate {
    const events: DuelPresentationEvent[] = [];
    let result: DuelResult | undefined;

    switch (message.type) {
      case EngineMessageType.START:
        events.push({ type: "duelStarted" });
        break;
      case EngineMessageType.NEW_TURN:
        this.#turn += 1;
        this.#turnPlayer = asPlayer(message.player);
        events.push({
          type: "turnStarted",
          player: this.#turnPlayer,
          turn: this.#turn,
        });
        break;
      case EngineMessageType.NEW_PHASE:
        this.#phase = phase(message.phase);
        events.push({ type: "phaseChanged", phase: this.#phase });
        break;
      case EngineMessageType.DRAW:
        this.#draw(asPlayer(message.player), message.drawn);
        events.push({
          type: "cardDrawn",
          player: asPlayer(message.player),
          count: message.drawn.length,
        });
        break;
      case EngineMessageType.SHUFFLE_DECK:
      case EngineMessageType.SHUFFLE_HAND: {
        const player = asPlayer(message.player);
        if (message.type === EngineMessageType.SHUFFLE_HAND)
          this.#shuffleHand(player, message.cards);
        events.push({
          type: "cardsShuffled",
          player,
          location:
            message.type === EngineMessageType.SHUFFLE_DECK ? "deck" : "hand",
        });
        break;
      }
      case EngineMessageType.MOVE: {
        const moved = this.#move(message.card, message.from, message.to);
        events.push({
          type: "cardMoved",
          ...(moved.code === undefined ? {} : { card: moved.code }),
          instanceId: moved.instanceId,
          from: engineLocation(message.from.location),
          to: engineLocation(message.to.location),
        });
        break;
      }
      case EngineMessageType.SUMMONING:
        events.push({
          type: "summon",
          player: asPlayer(message.controller),
          card: cardCode(message.code),
        });
        break;
      case EngineMessageType.SPECIAL_SUMMONING:
        events.push({
          type: "specialSummon",
          player: asPlayer(message.controller),
          card: cardCode(message.code),
        });
        break;
      case EngineMessageType.FLIP_SUMMONING:
        events.push({
          type: "flipSummon",
          player: asPlayer(message.controller),
          card: cardCode(message.code),
        });
        break;
      case EngineMessageType.SET:
        events.push({
          type: "set",
          player: asPlayer(message.controller),
          card: cardCode(message.code),
        });
        break;
      case EngineMessageType.POSITION_CHANGE:
        this.#changePosition(
          message.controller,
          message.location,
          message.sequence,
          message.position,
        );
        events.push({
          type: "positionChanged",
          card: cardCode(message.code),
          position: enginePosition(message.position),
        });
        break;
      case EngineMessageType.ATTACK:
        events.push({
          type: "attack",
          player: asPlayer(message.card.controller),
          direct: message.target === null,
        });
        break;
      case EngineMessageType.DAMAGE:
        this.#players[asPlayer(message.player)].lifePoints = Math.max(
          0,
          this.#players[asPlayer(message.player)].lifePoints - message.amount,
        );
        events.push({
          type: "damage",
          player: asPlayer(message.player),
          amount: message.amount,
        });
        break;
      case EngineMessageType.RECOVER:
        this.#players[asPlayer(message.player)].lifePoints += message.amount;
        events.push({
          type: "recover",
          player: asPlayer(message.player),
          amount: message.amount,
        });
        break;
      case EngineMessageType.LIFE_POINTS_UPDATE:
        this.#players[asPlayer(message.player)].lifePoints = message.lp;
        events.push({
          type: "lifePointsChanged",
          player: asPlayer(message.player),
          lifePoints: message.lp,
        });
        break;
      case EngineMessageType.CHAINING:
        this.#chainSize = message.chain_size;
        events.push({ type: "chainChanged", size: this.#chainSize });
        break;
      case EngineMessageType.CHAINED:
      case EngineMessageType.CHAIN_SOLVING:
      case EngineMessageType.CHAIN_SOLVED:
      case EngineMessageType.CHAIN_NEGATED:
      case EngineMessageType.CHAIN_DISABLED:
        this.#chainSize = message.chain_size;
        events.push({ type: "chainChanged", size: this.#chainSize });
        break;
      case EngineMessageType.CHAIN_END:
        this.#chainSize = 0;
        events.push({ type: "chainChanged", size: 0 });
        break;
      case EngineMessageType.HINT:
        events.push({ type: "hint", message: `System hint ${message.hint}` });
        break;
      case EngineMessageType.WIN: {
        const winner = asPlayer(message.player);
        result = {
          type: "completed",
          winner,
          loser: winner === 0 ? 1 : 0,
          reason: message.reason,
        };
        break;
      }
      case EngineMessageType.RETRY:
        throw new Error("ocgcore rejected the previous response");
      default:
        break;
    }

    this.#revision += 1;
    return result === undefined ? { events } : { events, result };
  }

  snapshot(): PublicDuelState {
    const players: [PublicPlayerState, PublicPlayerState] = [
      immutablePlayer(0, this.#players[0], true),
      immutablePlayer(1, this.#players[1], false),
    ];
    const allVisibleCards = players.flatMap((player) => [
      ...player.hand,
      ...player.monsters,
      ...player.spellsAndTraps,
      ...player.graveyard,
      ...player.banished,
    ]);
    const ids = new Set(allVisibleCards.map((card) => card.instanceId));
    if (ids.size !== allVisibleCards.length)
      throw new Error("A card instance occupies multiple public zones");

    return Object.freeze({
      snapshotId: this.#snapshotId,
      revision: this.#revision,
      turn: this.#turn,
      turnPlayer: this.#turnPlayer,
      phase: this.#phase,
      players: Object.freeze(players),
      chain: Object.freeze(
        Array.from({ length: this.#chainSize }, (_, index) =>
          Object.freeze({
            index,
            controller: this.#turnPlayer,
            label: `Chain Link ${index + 1}`,
          }),
        ),
      ),
    });
  }

  #draw(
    player: PlayerIndex,
    drawn: readonly { code: number; position: number }[],
  ): void {
    const state = this.#players[player];
    state.deckCount = Math.max(0, state.deckCount - drawn.length);
    for (const draw of drawn) {
      state.hand.push(
        this.#createCard(
          player,
          "hand",
          state.hand.length,
          draw.position,
          player === 0 ? draw.code : undefined,
        ),
      );
    }
    state.handCount = state.hand.length;
  }

  #shuffleHand(player: PlayerIndex, codes: readonly number[]): void {
    if (player !== 0) return;
    const hand = this.#players[player].hand;
    if (codes.length !== hand.length) return;

    const remaining = [...hand];
    const reordered: MutableCard[] = [];
    for (const code of codes) {
      let index = remaining.findIndex((card) => card.code === code);
      if (index < 0)
        index = remaining.findIndex((card) => card.code === undefined);
      const [card] = index < 0 ? [] : remaining.splice(index, 1);
      if (card === undefined) return;
      reordered.push(card);
    }
    reordered.forEach((card, index) => {
      const code = codes[index];
      if (code !== undefined && code > 0) card.code = cardCode(code);
    });
    hand.splice(0, hand.length, ...reordered);
    resequence(hand);
  }

  #move(
    rawCode: number,
    from: {
      controller: 0 | 1;
      location: number;
      sequence: number;
      position: number;
    },
    to: {
      controller: 0 | 1;
      location: number;
      sequence: number;
      position: number;
    },
  ): MutableCard {
    const fromPlayer = this.#players[from.controller];
    const fromLocation = engineLocation(from.location);
    const source = publicZone(fromPlayer, fromLocation);
    let card = source?.splice(from.sequence, 1)[0];
    if (card === undefined) {
      card = this.#createCard(
        from.controller,
        fromLocation,
        from.sequence,
        from.position,
        isPublicCard(from.controller, fromLocation, from.position)
          ? rawCode
          : undefined,
      );
      if (fromLocation === "deck")
        fromPlayer.deckCount = Math.max(0, fromPlayer.deckCount - 1);
    }
    resequence(source);

    const toPlayer = this.#players[to.controller];
    const toLocation = engineLocation(to.location);
    card.controller = to.controller;
    card.location = toLocation;
    card.sequence = to.sequence;
    card.position = enginePosition(to.position);
    card.faceUp = isFaceUp(to.position);
    if (rawCode > 0 && isPublicCard(to.controller, toLocation, to.position)) {
      card.code = cardCode(rawCode);
    } else {
      delete card.code;
    }
    const destination = publicZone(toPlayer, toLocation);
    if (destination !== null) {
      destination.splice(Math.min(to.sequence, destination.length), 0, card);
      resequence(destination);
    } else if (toLocation === "deck") {
      toPlayer.deckCount += 1;
    }
    fromPlayer.handCount = fromPlayer.hand.length;
    toPlayer.handCount = toPlayer.hand.length;
    return card;
  }

  #changePosition(
    controller: number,
    location: number,
    sequence: number,
    position: number,
  ): void {
    const player = this.#players[asPlayer(controller)];
    const card = publicZone(player, engineLocation(location))?.[sequence];
    if (card === undefined) return;
    card.position = enginePosition(position);
    card.faceUp = isFaceUp(position);
    if (!card.faceUp && controller === 1) delete card.code;
  }

  #createCard(
    owner: PlayerIndex,
    location: PublicLocation,
    sequence: number,
    position: number,
    code?: number,
  ): MutableCard {
    this.#cardSequence += 1;
    return {
      instanceId: cardInstanceId(`card-${this.#cardSequence}`),
      ...(code === undefined || code <= 0 ? {} : { code: cardCode(code) }),
      owner,
      controller: owner,
      location,
      sequence,
      position: enginePosition(position),
      faceUp: isFaceUp(position),
      overlayMaterials: [],
    };
  }
}

function mutablePlayer(
  deckCount: number,
  extraDeckCount: number,
): MutablePlayer {
  return {
    lifePoints: 8000,
    deckCount,
    extraDeckCount,
    handCount: 0,
    hand: [],
    monsters: [],
    spellsAndTraps: [],
    graveyard: [],
    banished: [],
  };
}

function immutablePlayer(
  player: PlayerIndex,
  value: MutablePlayer,
  includeHandIdentities: boolean,
): PublicPlayerState {
  return Object.freeze({
    player,
    lifePoints: value.lifePoints,
    deckCount: value.deckCount,
    extraDeckCount: value.extraDeckCount,
    handCount: value.handCount,
    hand: Object.freeze(
      includeHandIdentities ? value.hand.map(immutableCard) : [],
    ),
    monsters: Object.freeze(value.monsters.map(immutableCard)),
    spellsAndTraps: Object.freeze(value.spellsAndTraps.map(immutableCard)),
    graveyard: Object.freeze(value.graveyard.map(immutableCard)),
    banished: Object.freeze(value.banished.map(immutableCard)),
  });
}

function immutableCard(value: MutableCard): PublicCard {
  return Object.freeze({
    ...value,
    overlayMaterials: Object.freeze([...value.overlayMaterials]),
  });
}

function publicZone(
  player: MutablePlayer,
  location: PublicLocation,
): MutableCard[] | null {
  switch (location) {
    case "hand":
      return player.hand;
    case "monster":
      return player.monsters;
    case "spellTrap":
    case "field":
      return player.spellsAndTraps;
    case "graveyard":
      return player.graveyard;
    case "banished":
      return player.banished;
    case "deck":
    case "extra":
      return null;
  }
}

function engineLocation(value: number): PublicLocation {
  switch (value & ~EngineLocation.OVERLAY) {
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
      throw new Error(`Unsupported card location: ${value}`);
  }
}

function enginePosition(value: number): CardPosition {
  if ((value & EnginePosition.FACE_UP_ATTACK) !== 0) return "faceUpAttack";
  if ((value & EnginePosition.FACE_DOWN_ATTACK) !== 0) return "faceDownAttack";
  if ((value & EnginePosition.FACE_UP_DEFENSE) !== 0) return "faceUpDefense";
  return "faceDownDefense";
}

function isFaceUp(value: number): boolean {
  return (
    (value &
      (EnginePosition.FACE_UP_ATTACK | EnginePosition.FACE_UP_DEFENSE)) !==
    0
  );
}

function isPublicCard(
  controller: number,
  location: PublicLocation,
  position: number,
): boolean {
  return (
    controller === 0 ||
    location === "graveyard" ||
    location === "banished" ||
    isFaceUp(position)
  );
}

function phase(value: number): DuelPhase {
  switch (value) {
    case EnginePhase.DRAW:
      return "draw";
    case EnginePhase.STANDBY:
      return "standby";
    case EnginePhase.MAIN_1:
      return "main1";
    case EnginePhase.BATTLE_START:
      return "battleStart";
    case EnginePhase.BATTLE_STEP:
      return "battleStep";
    case EnginePhase.DAMAGE:
      return "damage";
    case EnginePhase.DAMAGE_CALCULATION:
      return "damageCalculation";
    case EnginePhase.BATTLE:
      return "battle";
    case EnginePhase.MAIN_2:
      return "main2";
    case EnginePhase.END:
      return "end";
    default:
      return "unknown";
  }
}

function resequence(cards: MutableCard[] | null | undefined): void {
  cards?.forEach((card, index) => {
    card.sequence = index;
  });
}

function asPlayer(value: number): PlayerIndex {
  if (value !== 0 && value !== 1)
    throw new Error(`Unsupported player index: ${value}`);
  return value;
}
