import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  cardMatchesCatalogType,
  type DeckCatalogFilters,
} from "./deck-catalog.ts";

export interface DeckCatalogIndex {
  readonly cards: readonly DeckBuilderCardView[];
  /** `cards[i].name.toLocaleLowerCase()`, computed once. */
  readonly lowerNames: readonly string[];
}

export function buildDeckCatalogIndex(
  cards: readonly DeckBuilderCardView[],
): DeckCatalogIndex {
  return {
    cards,
    lowerNames: cards.map((card) => card.name.toLocaleLowerCase()),
  };
}

export function filterDeckCatalogIndex(
  index: DeckCatalogIndex,
  filters: DeckCatalogFilters,
): readonly DeckBuilderCardView[] {
  const name = filters.name.trim().toLocaleLowerCase();
  const { cards, lowerNames } = index;
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!;
    if (name.length > 0 && !lowerNames[index]!.includes(name)) continue;
    for (const tag of filters.types) {
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    }
    out.push(card);
  }
  return Object.freeze(out);
}
