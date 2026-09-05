<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type {
    AdvancedDeckCatalogFilters,
    AdvancedDeckCatalogOptions,
    DeckCatalogQuery,
  } from "../../decks/catalog/deck-catalog.ts";
  import {
    catalogTypeOptions,
    EMPTY_CATALOG_FILTERS,
    type DeckCatalogFilters,
  } from "../../decks/catalog/deck-catalog-types.ts";
  import {
    buildDeckCatalogIndex,
    filterQuickDeckCatalogIndex,
    type DeckCatalogIndex,
  } from "../../decks/catalog/deck-catalog-index-base.ts";
  import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../decks/catalog/pinned-ruleset.ts";
  import { quantityLimit } from "../../decks/catalog/pinned-ruleset.ts";
  import {
    unlimitedCardOwnership,
    type CardOwnership,
  } from "../../decks/card-ownership.ts";
  import { availableCopies } from "../catalog-availability.ts";
  import {
    INITIAL_RESULT_WINDOW,
    initialResultWindow,
    nextResultWindow,
    RESULT_WINDOW_CEILING,
  } from "../layout/result-window.ts";
  import { OverlayScrollbar } from "../../shell/index.ts";
  import CardTile from "./CardTile.svelte";
  import CatalogTypeInput from "./CatalogTypeInput.svelte";

  export let cards: readonly DeckBuilderCardView[];
  export let ruleset: PinnedDeckRuleset;
  /* What the context being edited owns. The list handed in is already narrowed
     to it; this is the second half of the same answer, the copy count, which
     only the add path can ask. Free play's is the default. */
  export let ownership: CardOwnership = unlimitedCardOwnership();
  export let selectedCode: number | null = null;
  export let copies: ReadonlyMap<number, number> = new Map();
  export let onselect: (card: DeckBuilderCardView) => void = () => undefined;
  export let ondragcard: (
    card: DeckBuilderCardView,
    event: DragEvent,
  ) => void = () => undefined;
  export let ondragcancel: () => void = () => undefined;
  /* `null` above the breakpoint, where a tile click only selects. */
  export let ontap: ((card: DeckBuilderCardView) => void) | null = null;
  export let ondoubleclick: ((card: DeckBuilderCardView) => void) | null = null;
  /* The catalog is a pane of its own below the breakpoint, so it fills the
     stage instead of reserving room for the two panels beside it. */
  export let filled = false;
  export let onhovercard: (card: DeckBuilderCardView) => void = () => undefined;
  export let onhoverend: () => void = () => undefined;
  export let oncontextadd: (card: DeckBuilderCardView) => void = () =>
    undefined;
  export let onnameinputmount: (element: HTMLInputElement) => void = () =>
    undefined;

  /* Without an observer nothing ever appends, so the window can only be what
     the first render mounts. Every result would be 14,551 tiles at once, which
     is the one unbounded render this component would otherwise have. Chromium
     always has an observer, so this is a ceiling for anything else. */
  const FALLBACK_RESULT_CAP = 200;

  let resultsScroller: HTMLElement | null = null;
  let nameInput: HTMLInputElement | null = null;
  interface AdvancedSession {
    readonly component: typeof import("./AdvancedCardSearch.svelte").default;
    readonly emptyFilters: AdvancedDeckCatalogFilters;
    readonly options: AdvancedDeckCatalogOptions;
    readonly filter: (
      index: DeckCatalogIndex,
      query: DeckCatalogQuery,
      isAvailable: (card: DeckBuilderCardView) => boolean,
    ) => readonly DeckBuilderCardView[];
    readonly filters: AdvancedDeckCatalogFilters;
  }

  let advancedTrigger: HTMLButtonElement | null = null;
  let advanced: AdvancedSession | null = null;
  let filters: DeckCatalogFilters = { ...EMPTY_CATALOG_FILTERS };
  let advancedOpen = false;
  let results: readonly DeckBuilderCardView[] = [];
  let visibleCount = INITIAL_RESULT_WINDOW;
  let sentinel: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let observerSupported = typeof IntersectionObserver === "function";

  $: typeOptions = catalogTypeOptions(cards);
  $: index = buildDeckCatalogIndex(cards);
  $: {
    void copies;
    void ownership;
    void ruleset;
    results =
      advanced === null
        ? filterQuickDeckCatalogIndex(index, filters, isAvailable)
        : advanced.filter(
            index,
            { ...filters, advanced: advanced.filters },
            isAvailable,
          );
  }
  $: filterKey = JSON.stringify({ filters, advanced: advanced?.filters });
  $: {
    // depend on filterKey so a same-length filter change still resets
    void filterKey;
    visibleCount = initialResultWindow(results.length);
  }
  $: visible = observerSupported
    ? results.slice(0, visibleCount)
    : results.slice(0, FALLBACK_RESULT_CAP);
  $: fallbackTruncated =
    !observerSupported && results.length > FALLBACK_RESULT_CAP;
  $: ceilingTruncated =
    observerSupported &&
    visibleCount >= RESULT_WINDOW_CEILING &&
    results.length > RESULT_WINDOW_CEILING;
  /* `filled` gives the catalog the whole stage, and with it `overflow-y:
     visible` on `.results`: the region grows to its content and an ancestor
     scrolls instead. An observer rooted on a box that never clips watches a
     sentinel that never leaves it, so the callback stops arriving. Measured in
     Chromium at 390x844: the window burst to 543 tiles with no gesture, then
     stalled at 599 of 14,551 across six scrolls to the bottom. The viewport is
     the root that still moves in that layout. */
  function observeSentinel(
    element: HTMLElement | null,
    scroller: HTMLElement | null,
    viewportRooted: boolean,
  ): void {
    observer?.disconnect();
    observer = null;
    if (!element) return;
    if (!viewportRooted && !scroller) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visibleCount = nextResultWindow(visibleCount, results.length);
        }
      },
      { root: viewportRooted ? null : scroller, rootMargin: "200px" },
    );
    observer.observe(element);
  }

  $: observeSentinel(sentinel, resultsScroller, filled);

  onMount(() => {
    if (nameInput !== null) onnameinputmount(nameInput);
  });

  onDestroy(() => observer?.disconnect());

  function setFilter<Key extends "name" | "types">(
    key: Key,
    value: DeckCatalogFilters[Key],
  ): void {
    filters = { ...filters, [key]: value };
  }

  function isAvailable(card: DeckBuilderCardView): boolean {
    const limit = quantityLimit(ruleset, card.code);
    return (
      (advanced?.filters.restriction == null ||
        limit === advanced.filters.restriction) &&
      availableCopies(card.code, ownership, limit, copies.get(card.code) ?? 0) >
        0
    );
  }

  async function openAdvancedSearch(): Promise<void> {
    const loaded = (
      await import("../advanced-search-loader.ts")
    ).loadAdvancedSearch(cards);
    advanced = {
      ...loaded,
      filters: advanced?.filters ?? { ...loaded.emptyFilters },
    };
    advancedOpen = true;
  }

  async function closeAdvancedSearch(): Promise<void> {
    advancedOpen = false;
    await tick();
    advancedTrigger?.focus();
  }

  function resetFilters(): void {
    filters = { ...EMPTY_CATALOG_FILTERS };
    if (advanced !== null)
      advanced = { ...advanced, filters: { ...advanced.emptyFilters } };
  }
</script>

<section
  class="catalog ui-glass-panel ui-chamfer"
  class:filled
  aria-label="Card catalog"
  data-cy="deck-catalog"
>
  <header data-cy="deck-catalog-header">
    <span class="panel-title" data-cy="deck-catalog-result-count"
      >{results.length} results</span
    >
    <button
      bind:this={advancedTrigger}
      type="button"
      class="secondary"
      data-cy="deck-catalog-advanced-search"
      onclick={() => void openAdvancedSearch()}>Advanced Search</button
    >
  </header>

  <div class="name-field" data-cy="deck-catalog-name-field">
    <input
      type="search"
      value={filters.name}
      aria-label="Name"
      placeholder="Name"
      data-cy="deck-catalog-name-input"
      bind:this={nameInput}
      oninput={(event) => setFilter("name", event.currentTarget.value)}
    />
  </div>

  <div class="filters" data-cy="deck-catalog-filters">
    <CatalogTypeInput
      options={typeOptions}
      value={filters.types}
      onchange={(types) => setFilter("types", types)}
    />
  </div>

  {#if filters.name || filters.types.length > 0}
    <div class="filter-summary" data-cy="deck-catalog-filter-summary">
      <span data-cy="deck-catalog-filter-summary-label">Filters active</span>
      <button
        type="button"
        class="secondary small"
        data-cy="deck-catalog-clear-all"
        onclick={resetFilters}>Clear all</button
      >
    </div>
  {/if}

  {#if results.length === 0}
    <div class="empty-state" data-cy="deck-catalog-empty">
      <h3 data-cy="deck-catalog-empty-heading">No matching cards</h3>
      <p data-cy="deck-catalog-empty-message">
        Clear filters or try another card name.
      </p>
      <button
        type="button"
        data-cy="deck-catalog-clear-filters"
        onclick={resetFilters}>Clear filters</button
      >
    </div>
  {:else}
    {#if fallbackTruncated}
      <p class="fallback-notice" data-cy="deck-catalog-fallback-notice">
        Showing the first {FALLBACK_RESULT_CAP} of {results.length} cards. Narrow
        the filters to reach the rest.
      </p>
    {/if}
    {#if ceilingTruncated}
      <p class="ceiling-notice" data-cy="deck-catalog-ceiling-notice">
        Showing {RESULT_WINDOW_CEILING} of {results.length} cards. Narrow the filters
        to reach the rest.
      </p>
    {/if}
    <div class="results-region" data-cy="deck-catalog-results-region">
      <div
        class="results"
        aria-label="Card catalog results"
        data-cy="deck-catalog-results"
        onmouseleave={() => onhoverend()}
        bind:this={resultsScroller}
      >
        {#each visible as card (card.code)}
          <CardTile
            {card}
            code={card.code}
            limit={quantityLimit(ruleset, card.code)}
            currentCopies={copies.get(card.code) ?? 0}
            selected={selectedCode === card.code}
            draggable={true}
            describedby={null}
            dataCyPrefix="catalog"
            dataCyId={card.code}
            onselect={() => onselect(card)}
            ontap={ontap === null ? null : () => ontap(card)}
            ondoubleclick={ondoubleclick === null
              ? null
              : () => ondoubleclick(card)}
            ondragcard={(event) => ondragcard(card, event)}
            {ondragcancel}
            onhover={() => onhovercard(card)}
            maxed={false}
            oncontext={() => oncontextadd(card)}
          />
        {/each}
        {#if observerSupported && visibleCount < results.length && visibleCount < RESULT_WINDOW_CEILING}
          <div
            class="sentinel"
            aria-hidden="true"
            data-cy="deck-catalog-results-sentinel"
            bind:this={sentinel}
          ></div>
        {/if}
      </div>
      <OverlayScrollbar
        axis="vertical"
        scrollElement={resultsScroller}
        contentSizeKey={`${results.length}:${visibleCount}`}
        dataCyPrefix="deck-catalog-results"
      />
    </div>
  {/if}
</section>

{#if advancedOpen && advanced !== null}
  {@const AdvancedSearch = advanced.component}
  <AdvancedSearch
    filters={{ ...filters, advanced: advanced.filters }}
    options={advanced.options}
    resultCount={results.length}
    onchange={(next) => {
      filters = { name: next.name, types: next.types };
      advanced = { ...advanced!, filters: next.advanced };
    }}
    onreset={resetFilters}
    onclose={() => void closeAdvancedSearch()}
  />
{/if}

<style>
  .catalog {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: 1rem;
  }

  .catalog.filled {
    height: auto;
    overflow: visible;
  }

  header,
  .filter-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h3,
  p {
    margin: 0;
  }

  .panel-title {
    color: var(--accent);
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: var(--ls-display);
    text-transform: uppercase;
  }

  .name-field {
    margin-top: 0.5rem;
  }

  input {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.65rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-chain);
  }

  .filters {
    margin-top: 0.4rem;
  }

  .filter-summary {
    margin-block: 0.65rem;
  }

  .small {
    min-height: 2rem;
    padding: 0.3rem 0.55rem;
  }

  .results-region {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    margin-top: var(--space-3);
  }

  .results {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    /* A tile's height comes from its `aspect-ratio`, which an `auto` row does
       not see: the row sizes itself to the card name alone (~22 px) and every
       tile then overflows into the rows below it, so the last row painted wins
       the click. Invisible while a search returned one row; the whole database
       returns thirteen. `max-content` sizes the row to the tile it holds. */
    grid-auto-rows: max-content;
    gap: 0.55rem;
    height: 100%;
    max-height: none;
    overflow-y: auto;
    padding: 0.2rem 0.35rem 0.5rem 0.1rem;
    scrollbar-width: none;
  }

  .results::-webkit-scrollbar {
    display: none;
  }

  .filled .results-region {
    flex: none;
  }

  .filled .results {
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    max-height: none;
    overflow-y: visible;
  }

  .sentinel {
    grid-column: 1 / -1;
    height: 1px;
  }

  .fallback-notice,
  .ceiling-notice {
    margin: 0 0 0.5rem;
    color: var(--muted);
  }

  .empty-state {
    margin-top: 1rem;
    padding: 1.5rem 0.75rem;
    text-align: center;
  }

  .empty-state p {
    margin: 0.4rem 0 1rem;
    color: var(--muted);
  }
</style>
