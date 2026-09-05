import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  cardMatchesCatalogType,
  type DeckCatalogFilters,
} from "./deck-catalog-types.ts";

export interface DeckCatalogIndex {
  readonly cards: readonly DeckBuilderCardView[];
  readonly lowerNames: readonly string[];
}

const COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

export function compareDeckCatalogCards(
  left: DeckBuilderCardView,
  right: DeckBuilderCardView,
): number {
  return COLLATOR.compare(left.name, right.name) || left.code - right.code;
}

export function deckCatalogOrderIsSorted(
  cards: readonly DeckBuilderCardView[],
  order: readonly number[],
): boolean {
  const compare = COLLATOR.compare;
  for (let offset = 1; offset < order.length; offset++) {
    const left = cards[order[offset - 1]!]!;
    const right = cards[order[offset]!]!;
    if ((compare(left.name, right.name) || left.code - right.code) > 0)
      return false;
  }
  return true;
}

export function buildDeckCatalogIndex(
  source: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  const cards = new Array<DeckBuilderCardView>(source.length);
  const lowerNames = new Array<string>(source.length);
  for (let offset = 0; offset < source.length; offset++) {
    const card = source[offset]!;
    cards[offset] = card;
    lowerNames[offset] = card.name.toLowerCase();
  }
  return Object.freeze({
    cards: Object.freeze(cards),
    lowerNames: Object.freeze(lowerNames),
  });
}

export function filterQuickDeckCatalogIndex(
  index: DeckCatalogIndex,
  filters: DeckCatalogFilters,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  const name = filters.name.trim().toLowerCase();
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (let offset = 0; offset < index.cards.length; offset++) {
    const card = index.cards[offset]!;
    if (!isAvailable(card)) continue;
    if (name && !index.lowerNames[offset]!.includes(name)) continue;
    for (const tag of filters.types)
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    out.push(card);
  }
  return Object.freeze(out.sort(compareDeckCatalogCards));
}
