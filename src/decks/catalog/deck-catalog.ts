import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  cardMatchesAdvancedFilters,
  cardNameMatches,
  compareDeckCatalogCards,
  type AdvancedDeckCatalogFilters,
} from "./deck-catalog-advanced.ts";
import {
  EMPTY_CATALOG_FILTERS,
  cardMatchesCatalogType,
  type DeckCatalogFilters,
} from "./deck-catalog-types.ts";

export * from "./deck-catalog-types.ts";
export {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  advancedDeckCatalogOptions,
  cardMatchesAdvancedFilters,
  cardNameMatches,
  cardTextMatches,
  compareDeckCatalogCards,
  matchesNumericCriterion,
  numericCriterionError,
  type AdvancedDeckCatalogFilters,
  type AdvancedDeckCatalogOptions,
  type CardTrait,
  type LinkMarkerRule,
  type NameMatch,
  type NumericCriterion,
  type NumericOperator,
  type SpellProperty,
  type SummonFrame,
  type TrapProperty,
} from "./deck-catalog-advanced.ts";

export interface DeckCatalogQuery extends DeckCatalogFilters {
  readonly advanced: AdvancedDeckCatalogFilters;
}

export const EMPTY_DECK_CATALOG_QUERY: DeckCatalogQuery = Object.freeze({
  ...EMPTY_CATALOG_FILTERS,
  advanced: EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
});

export function filterDeckCatalog(
  cards: readonly DeckBuilderCardView[],
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  return Object.freeze(
    cards
      .filter(
        (card) =>
          isAvailable(card) &&
          cardNameMatches(card.name, query.name, query.advanced.nameMatch) &&
          query.types.every((tag) => cardMatchesCatalogType(card, tag)) &&
          cardMatchesAdvancedFilters(card, query.advanced),
      )
      .sort(compareDeckCatalogCards),
  );
}
