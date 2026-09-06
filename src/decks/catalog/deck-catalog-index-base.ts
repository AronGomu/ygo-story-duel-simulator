import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  cardMatchesCatalogType,
  type DeckCatalogFilters,
} from "./deck-catalog-types.ts";

export interface DeckCatalogIndex {
  readonly cards: readonly DeckBuilderCardView[];
  readonly lowerNames: readonly string[];
}

const SORT_ORDERS = new WeakMap<DeckCatalogIndex, readonly number[]>();
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
  lowerNames?: readonly string[],
): boolean {
  const compare = COLLATOR.compare;
  for (let offset = 1; offset < order.length; offset++) {
    const leftIndex = order[offset - 1]!;
    const rightIndex = order[offset]!;
    const left = cards[leftIndex]!;
    const right = cards[rightIndex]!;
    if (
      (compare(
        lowerNames?.[leftIndex] ?? left.name,
        lowerNames?.[rightIndex] ?? right.name,
      ) || left.code - right.code) > 0
    )
      return false;
  }
  return true;
}

export function deckCatalogSortOrder(
  index: DeckCatalogIndex,
): readonly number[] {
  return SORT_ORDERS.get(index)!;
}

export function buildDeckCatalogIndex(
  source: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  const cards = new Array<DeckBuilderCardView>(source.length);
  const lowerNames = new Array<string>(source.length);
  const sortBuckets = new Map<number, number[]>();
  for (let offset = 0; offset < source.length; offset++) {
    const card = source[offset]!;
    const lowerName = card.name.toLowerCase();
    let prefix = 0;
    const prefixLength = Math.min(6, lowerName.length);
    for (let index = 0; index < prefixLength; index++)
      prefix = (Math.imul(prefix, 31) + lowerName.charCodeAt(index)) | 0;
    const bucket = sortBuckets.get(prefix);
    cards[offset] = card;
    lowerNames[offset] = lowerName;
    if (bucket === undefined) sortBuckets.set(prefix, [offset]);
    else bucket.push(offset);
  }
  const order = new Array<number>(cards.length);
  const compareOffsets = (left: number, right: number) => {
    const leftName = lowerNames[left]!;
    const rightName = lowerNames[right]!;
    return leftName < rightName
      ? -1
      : leftName > rightName
        ? 1
        : cards[left]!.code - cards[right]!.code;
  };
  const buckets = [...sortBuckets.values()];
  for (const bucket of buckets) bucket.sort(compareOffsets);
  buckets.sort((left, right) => compareOffsets(left[0]!, right[0]!));
  let position = 0;
  for (const bucket of buckets)
    for (let offset = 0; offset < bucket.length; offset++)
      order[position++] = bucket[offset]!;
  if (!deckCatalogOrderIsSorted(cards, order, lowerNames))
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
