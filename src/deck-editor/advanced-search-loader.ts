import AdvancedCardSearch from "./components/AdvancedCardSearch.svelte";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  advancedDeckCatalogOptions,
} from "../decks/catalog/deck-catalog.ts";
import { filterDeckCatalogIndex } from "../decks/catalog/deck-catalog-index.ts";
import type { DeckBuilderCardView } from "../decks/catalog/ocg-card-mapper.ts";

export function loadAdvancedSearch(cards: readonly DeckBuilderCardView[]) {
  return {
    component: AdvancedCardSearch,
    emptyFilters: EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
    options: advancedDeckCatalogOptions(cards),
    filter: filterDeckCatalogIndex,
  } as const;
}
