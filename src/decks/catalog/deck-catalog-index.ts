import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  compileAdvancedDeckCatalogMatcher,
  prepareAdvancedDeckCatalogIndex,
} from "./deck-catalog-advanced.ts";
import {
  cardMatchesCatalogType,
  type DeckCatalogQuery,
} from "./deck-catalog.ts";
import {
  compareDeckCatalogCards,
  type DeckCatalogIndex,
} from "./deck-catalog-index-base.ts";

export {
  buildDeckCatalogIndex,
  filterQuickDeckCatalogIndex,
  type DeckCatalogIndex,
} from "./deck-catalog-index-base.ts";

export function filterDeckCatalogIndex(
  index: DeckCatalogIndex,
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  const needle = query.name.trim().toLowerCase();
  const nameMode = query.advanced.nameMatch;
  const matchesAdvanced =
    query.advanced === EMPTY_ADVANCED_DECK_CATALOG_FILTERS
      ? null
      : compileAdvancedDeckCatalogMatcher(query.advanced);
  const advanced = prepareAdvancedDeckCatalogIndex(index);
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (const offset of advanced.order) {
    const card = index.cards[offset]!;
    if (!isAvailable(card)) continue;
    if (needle) {
      const name = index.lowerNames[offset]!;
      if (
        nameMode === "contains"
          ? !name.includes(needle)
          : nameMode === "exact"
            ? name !== needle
            : nameMode === "starts-with"
              ? !name.startsWith(needle)
              : name.includes(needle)
      )
        continue;
    }
    for (const tag of query.types)
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    if (matchesAdvanced !== null && !matchesAdvanced(card)) continue;
    out.push(card);
  }
  return Object.freeze(out.sort(compareDeckCatalogCards));
}
