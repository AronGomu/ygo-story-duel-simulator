import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import { compareDeckCatalogCards } from "./deck-catalog-order.ts";
import {
  cardMatchesCatalogType,
  type DeckCatalogFilters,
} from "./deck-catalog-types.ts";

export { compareDeckCatalogCards } from "./deck-catalog-order.ts";

export interface DeckCatalogIndex {
  readonly cards: readonly DeckBuilderCardView[];
  readonly lowerNames: readonly string[];
}

const SORT_ORDERS = new WeakMap<DeckCatalogIndex, readonly number[]>();

export function deckCatalogOrderIsSorted(
  cards: readonly DeckBuilderCardView[],
  order: readonly number[],
): boolean {
  for (let offset = 1; offset < order.length; offset++) {
    const left = cards[order[offset - 1]!]!;
    const right = cards[order[offset]!]!;
    if (compareDeckCatalogCards(left, right) > 0) return false;
  }
  return true;
}

function exactSortOrder(index: DeckCatalogIndex): readonly number[] {
  return Object.freeze(
    Array.from({ length: index.cards.length }, (_, offset) => offset).sort(
      (left, right) =>
        compareDeckCatalogCards(index.cards[left]!, index.cards[right]!),
    ),
  );
}

export function deckCatalogSortOrder(
  index: DeckCatalogIndex,
): readonly number[] {
  const cached = SORT_ORDERS.get(index);
  if (cached !== undefined) return cached;
  const order = exactSortOrder(index);
  SORT_ORDERS.set(index, order);
  return order;
}

export function buildDeckCatalogIndex(
  source: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  const cards = new Array<DeckBuilderCardView>(source.length);
  const lowerNames = new Array<string>(source.length);
  const order = new Array<number>(source.length);
  let sourceSorted = true;
  for (let offset = 0; offset < source.length; offset++) {
    const card = source[offset]!;
    cards[offset] = card;
    lowerNames[offset] = card.name.toLowerCase();
    order[offset] = offset;
    if (
      sourceSorted &&
      offset > 0 &&
      compareDeckCatalogCards(source[offset - 1]!, card) > 0
    )
      sourceSorted = false;
  }
  if (!sourceSorted)
    order.sort((left, right) =>
      compareDeckCatalogCards(cards[left]!, cards[right]!),
    );
  const index = Object.freeze({
    cards: Object.freeze(cards),
    lowerNames: Object.freeze(lowerNames),
  });
  SORT_ORDERS.set(index, Object.freeze(order));
  return index;
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
