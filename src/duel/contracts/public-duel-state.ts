import type { CardCode, CardInstanceId, SnapshotId } from "./ids.ts";

export type PlayerIndex = 0 | 1;
export type DuelPhase =
  | "draw"
  | "standby"
  | "main1"
  | "battleStart"
  | "battleStep"
  | "damage"
  | "damageCalculation"
  | "battle"
  | "main2"
  | "end"
  | "unknown";
export type CardPosition =
  "faceUpAttack" | "faceDownAttack" | "faceUpDefense" | "faceDownDefense";
export type PublicLocation =
  | "deck"
  | "hand"
  | "monster"
  | "spellTrap"
  | "field"
  | "graveyard"
  | "banished"
  | "extra";

export interface PublicCard {
  readonly instanceId: CardInstanceId;
  readonly code?: CardCode;
  readonly owner: PlayerIndex;
  readonly controller: PlayerIndex;
  readonly location: PublicLocation;
  readonly sequence: number;
  readonly position: CardPosition;
  readonly faceUp: boolean;
  readonly overlayMaterials: readonly CardInstanceId[];
}

export interface PublicPlayerState {
  readonly player: PlayerIndex;
  readonly lifePoints: number;
  readonly deckCount: number;
  readonly extraDeckCount: number;
  readonly handCount: number;
  readonly hand: readonly PublicCard[];
  readonly monsters: readonly PublicCard[];
  readonly spellsAndTraps: readonly PublicCard[];
  readonly graveyard: readonly PublicCard[];
  readonly banished: readonly PublicCard[];
}

export interface PublicChainLink {
  readonly index: number;
  readonly controller: PlayerIndex;
  readonly card?: CardCode;
  readonly label: string;
}

export interface PublicDuelState {
  readonly snapshotId: SnapshotId;
  readonly revision: number;
  readonly turn: number;
  readonly turnPlayer: PlayerIndex;
  readonly phase: DuelPhase;
  readonly players: readonly [PublicPlayerState, PublicPlayerState];
  readonly chain: readonly PublicChainLink[];
}
