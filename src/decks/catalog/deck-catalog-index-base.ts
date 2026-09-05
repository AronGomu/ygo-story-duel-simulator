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

export function buildDeckCatalogIndex(
  source: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  const cards = [...source];
  return Object.freeze({
    cards: Object.freeze(cards),
    lowerNames: Object.freeze(cards.map((card) => card.name.toLowerCase())),
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
