import { mount, unmount } from "svelte";
import AdvancedCardSearch from "./components/AdvancedCardSearch.svelte";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  advancedDeckCatalogOptions,
  type DeckCatalogQuery,
} from "../decks/catalog/deck-catalog.ts";
import { prepareAdvancedDeckCatalogIndex } from "../decks/catalog/deck-catalog-advanced.ts";
import {
  filterDeckCatalogIndex,
  type DeckCatalogIndex,
} from "../decks/catalog/deck-catalog-index.ts";
import type { DeckBuilderCardView } from "../decks/catalog/ocg-card-mapper.ts";

interface AdvancedSearchHandle {
  setResultCount(resultCount: number): void;
}

interface OpenInput {
  readonly filters: DeckCatalogQuery;
  readonly resultCount: number;
  readonly onchange: (filters: DeckCatalogQuery) => void;
  readonly onreset: () => void;
}

export function loadAdvancedSearch(
  cards: readonly DeckBuilderCardView[],
  index: DeckCatalogIndex,
) {
  prepareAdvancedDeckCatalogIndex(index);
  let mounted: (ReturnType<typeof mount> & AdvancedSearchHandle) | null = null;
  const close = async () => {
    if (mounted === null) return;
    const current = mounted;
    mounted = null;
    await unmount(current);
  };
  return {
    emptyFilters: EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
    filter: filterDeckCatalogIndex,
    open(input: OpenInput) {
      mounted = mount(AdvancedCardSearch, {
        target: document.body,
        props: {
          filters: input.filters,
          options: advancedDeckCatalogOptions(cards),
          resultCount: input.resultCount,
          onchange: input.onchange,
          onreset: input.onreset,
          onclose: () => void close(),
        },
      }) as ReturnType<typeof mount> & AdvancedSearchHandle;
    },
    setResultCount(resultCount: number) {
      mounted?.setResultCount(resultCount);
    },
    destroy() {
      if (mounted !== null) void unmount(mounted);
      mounted = null;
    },
  } as const;
}
