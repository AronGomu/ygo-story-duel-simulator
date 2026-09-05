import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  compileAdvancedDeckCatalogMatcher,
  prepareAdvancedDeckCatalogIndex,
} from "./deck-catalog-advanced.ts";
import {
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
  needle: string,
  mode: DeckCatalogQuery["advanced"]["nameMatch"],
): boolean {
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
  const needle = query.name.trim().toLowerCase();
  const matchesAdvanced = compileAdvancedDeckCatalogMatcher(query.advanced);
  const advanced = prepareAdvancedDeckCatalogIndex(index);
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (const offset of advanced.order) {
    const card = index.cards[offset]!;
    if (!isAvailable(card)) continue;
    if (
      !indexedNameMatches(
        index.lowerNames[offset]!,
        needle,
        query.advanced.nameMatch,
      )
    )
      continue;
    for (const tag of query.types)
      if (!cardMatchesCatalogType(card, tag)) continue cardLoop;
    if (!matchesAdvanced(card, advanced.cards[offset]!)) continue;
    out.push(card);
  }
  return Object.freeze(out);
}
