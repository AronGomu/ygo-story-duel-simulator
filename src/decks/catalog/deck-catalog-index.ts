import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  cardMatchesAdvancedFilters,
  cardMatchesCatalogType,
  type DeckCatalogQuery,
} from "./deck-catalog.ts";
import type { DeckCatalogIndex } from "./deck-catalog-index-base.ts";

export {
  buildDeckCatalogIndex,
  filterQuickDeckCatalogIndex,
  type DeckCatalogIndex,
} from "./deck-catalog-index-base.ts";

function indexedNameMatches(
  value: string,
  query: string,
  mode: DeckCatalogQuery["advanced"]["nameMatch"],
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  switch (mode) {
    case "contains":
      return value.includes(needle);
    case "exact":
      return value === needle;
    case "starts-with":
      return value.startsWith(needle);
    case "exclude":
      return !value.includes(needle);
  }
}

export function filterDeckCatalogIndex(
  index: DeckCatalogIndex,
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  const { cards, lowerNames } = index;
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (let offset = 0; offset < cards.length; offset++) {
    const card = cards[offset]!;
    if (!isAvailable(card)) continue;
    if (
      !indexedNameMatches(
        lowerNames[offset]!,
        query.name,
        query.advanced.nameMatch,
      )
    )
      continue;
    for (const tag of query.types)
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    if (!cardMatchesAdvancedFilters(card, query.advanced)) continue;
    out.push(card);
  }
  return Object.freeze(out);
}
