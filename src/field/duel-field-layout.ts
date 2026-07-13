import type { PlayerIndex } from "../duel/contracts/public-duel-state.ts";

export const DUEL_FIELD_WIDTH = 1280;
export const DUEL_FIELD_HEIGHT = 720;
export const CARD_WIDTH = 72;
export const CARD_HEIGHT = 104;

export type FieldZoneKind =
  | "hand"
  | "monster"
  | "spellTrap"
  | "field"
  | "deck"
  | "extra"
  | "graveyard"
  | "banished";

export interface FieldZoneLayout {
  readonly id: string;
  readonly player: PlayerIndex;
  readonly kind: FieldZoneKind;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

export function fieldZoneId(
  player: PlayerIndex,
  kind: FieldZoneKind,
  sequence = 0,
): string {
  return `p${player}:${kind}:${sequence}`;
}

export function createDuelFieldLayout(): readonly FieldZoneLayout[] {
  const zones: FieldZoneLayout[] = [];
  for (const player of [0, 1] as const) {
    const mirrored = player === 1;
    const monsterY = mirrored ? 250 : 470;
    const spellY = mirrored ? 135 : 585;
    for (let sequence = 0; sequence < 8; sequence += 1) {
      const x =
        sequence < 5 ? 440 + sequence * 100 : 290 + (sequence - 5) * 470;
      zones.push(zone(player, "monster", sequence, x, monsterY, "Monster"));
      zones.push(
        zone(player, "spellTrap", sequence, x, spellY, "Spell / Trap"),
      );
    }
    zones.push(zone(player, "field", 0, 330, monsterY, "Field"));
    zones.push(zone(player, "deck", 0, 1030, spellY, "Deck"));
    zones.push(zone(player, "extra", 0, 230, spellY, "Extra Deck"));
    zones.push(zone(player, "graveyard", 0, 1030, monsterY, "GY"));
    zones.push(zone(player, "banished", 0, 1130, monsterY, "Banished"));
    zones.push({
      ...zone(player, "hand", 0, 640, mirrored ? 42 : 678, "Hand"),
      width: 720,
      height: 72,
    });
  }
  return Object.freeze(zones.map((value) => Object.freeze(value)));
}

function zone(
  player: PlayerIndex,
  kind: FieldZoneKind,
  sequence: number,
  x: number,
  y: number,
  label: string,
): FieldZoneLayout {
  return {
    id: fieldZoneId(player, kind, sequence),
    player,
    kind,
    sequence,
    x,
    y,
    width: CARD_WIDTH + 10,
    height: CARD_HEIGHT + 10,
    label: `${player === 0 ? "Your" : "Opponent"} ${label}${sequence > 0 || kind === "monster" || kind === "spellTrap" ? ` ${sequence + 1}` : ""}`,
  };
}
