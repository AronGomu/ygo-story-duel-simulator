import { mount, unmount } from "svelte";
import AdvancedCardSearch from "./components/AdvancedCardSearch.svelte";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  advancedDeckCatalogOptions,
  type DeckCatalogQuery,
} from "../decks/catalog/deck-catalog.ts";
import { filterDeckCatalogIndex } from "../decks/catalog/deck-catalog-index.ts";
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

export interface AdvancedSearchSession {
  readonly emptyFilters: typeof EMPTY_ADVANCED_DECK_CATALOG_FILTERS;
  readonly filter: typeof filterDeckCatalogIndex;
  open(input: OpenInput): void;
  setResultCount(resultCount: number): void;
  destroy(): void;
}

export interface AdvancedSearchHost {
  disposed: boolean;
  generation: number;
  session: AdvancedSearchSession | null;
  read(): {
    readonly cards: readonly DeckBuilderCardView[];
    readonly filters: Omit<DeckCatalogQuery, "advanced"> & {
      readonly advanced: DeckCatalogQuery["advanced"] | null;
    };
    readonly resultCount: number;
  };
  onchange(filters: DeckCatalogQuery): void;
  reset(): void;
}

export async function openAdvancedSearch(
  host: AdvancedSearchHost,
): Promise<void> {
  const generation = ++host.generation;
  await Promise.resolve();
  if (host.disposed || generation !== host.generation) return;
  const state = host.read();
  const session =
    host.session ?? (host.session = loadAdvancedSearch(state.cards));
  const advanced = state.filters.advanced ?? session.emptyFilters;
  host.onchange({ ...state.filters, advanced });
  session.open({
    filters: { ...state.filters, advanced },
    resultCount: state.resultCount,
    onchange: host.onchange,
    onreset: host.reset,
  });
}

export function loadAdvancedSearch(cards: readonly DeckBuilderCardView[]) {
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
      if (mounted !== null) return;
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
