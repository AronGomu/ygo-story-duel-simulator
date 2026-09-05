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
const CACHE = new WeakMap<readonly DeckBuilderCardView[], DeckCatalogIndex>();

export function buildDeckCatalogIndex(
  cards: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  const cached = CACHE.get(cards);
  if (cached !== undefined) return cached;
  const sorted = Object.freeze(
    [...cards].sort(
      (left, right) =>
        COLLATOR.compare(left.name, right.name) || left.code - right.code,
    ),
  );
  const index = Object.freeze({
    cards: sorted,
    lowerNames: Object.freeze(
      sorted.map((card) => card.name.toLocaleLowerCase()),
    ),
  });
  CACHE.set(cards, index);
  return index;
}

export function filterQuickDeckCatalogIndex(
  index: DeckCatalogIndex,
  filters: DeckCatalogFilters,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  const name = filters.name.trim().toLocaleLowerCase();
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (let offset = 0; offset < index.cards.length; offset++) {
    const card = index.cards[offset]!;
    if (!isAvailable(card)) continue;
    if (name && !index.lowerNames[offset]!.includes(name)) continue;
    for (const tag of filters.types)
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    out.push(card);
  }
  return Object.freeze(out);
}
