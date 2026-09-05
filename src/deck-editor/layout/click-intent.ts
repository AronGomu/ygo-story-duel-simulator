import type { DeckZone } from "../../decks/deck-contracts.ts";

/* What a double-click on a tile means. Derived from the target and the deck's
   fill, never from anything the layout happens to be showing. */
export type ClickIntent =
  | Readonly<{ kind: "remove" }>
  | Readonly<{ kind: "add"; zone: DeckZone }>
  | Readonly<{ kind: "blocked"; reason: string }>;

export interface ZoneCounts {
  readonly main: number;
  readonly extra: number;
  readonly side: number;
}

const MAIN_ZONE_CAPACITY = 60;
const FIFTEEN_ZONE_CAPACITY = 15;

const FULL_REASON: Readonly<Record<DeckZone, string>> = {
  main: "Main Deck is full.",
  extra: "Extra Deck is full.",
  side: "Side Deck is full.",
};

function capacityOf(zone: DeckZone): number {
  return zone === "main" ? MAIN_ZONE_CAPACITY : FIFTEEN_ZONE_CAPACITY;
}

function isFull(zone: DeckZone, counts: ZoneCounts): boolean {
  return counts[zone] >= capacityOf(zone);
}

export function deckCardClickIntent(): ClickIntent {
  return { kind: "remove" };
}

export function catalogCardClickIntent(
  canonicalZone: "main" | "extra",
  counts: ZoneCounts,
): ClickIntent {
  return isFull(canonicalZone, counts)
    ? { kind: "blocked", reason: FULL_REASON[canonicalZone] }
    : { kind: "add", zone: canonicalZone };
}

export function catalogCardContextIntent(
  canonicalZone: "main" | "extra",
  counts: ZoneCounts,
): ClickIntent {
  return catalogCardClickIntent(canonicalZone, counts);
}
