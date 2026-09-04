<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    catalogFilterOptions,
    EMPTY_CATALOG_FILTERS,
    // filterDeckCatalog is the reference implementation; the UI uses the index path below.
    type DeckCatalogFilters,
  } from "../../decks/catalog/deck-catalog.ts";
  import {
    buildDeckCatalogIndex,
    filterDeckCatalogIndex,
  } from "../../decks/catalog/deck-catalog-index.ts";
  import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../decks/catalog/pinned-ruleset.ts";
  import { quantityLimit } from "../../decks/catalog/pinned-ruleset.ts";
  import {
    unlimitedCardOwnership,
    type CardOwnership,
  } from "../../decks/card-ownership.ts";
  import {
    availableCopies,
    unavailableReason,
  } from "../catalog-availability.ts";
  import {
    INITIAL_RESULT_WINDOW,
    initialResultWindow,
    nextResultWindow,
    RESULT_WINDOW_CEILING,
  } from "../layout/result-window.ts";
  import { OverlayScrollbar } from "../../shell/index.ts";
  import CardTile from "./CardTile.svelte";

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
  export let onblocked: (
    card: DeckBuilderCardView,
    reason: string,
  ) => void = () => undefined;
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
  let filters: DeckCatalogFilters = { ...EMPTY_CATALOG_FILTERS };
  let visibleCount = INITIAL_RESULT_WINDOW;
  let sentinel: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let observerSupported = typeof IntersectionObserver === "function";

  $: options = catalogFilterOptions(cards);
  $: index = buildDeckCatalogIndex(cards);
  $: results = filterDeckCatalogIndex(index, filters);
  $: filterKey = `${filters.name}|${filters.family}|${filters.subtype}|${filters.attribute}|${filters.race}`;
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
  /* Pre-compute spent codes for the visible slice. Tiles still re-render when
     `copies` changes, but each tile now does one Set.has instead of two
     function calls + arithmetic. */
  $: spentCodes = new Set(
    visible
      .filter(
        (card) =>
          availableCopies(
            card.code,
            ownership,
            quantityLimit(ruleset, card.code),
            copies.get(card.code) ?? 0,
          ) === 0,
      )
      .map((card) => card.code),
  );

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

  function addable(card: DeckBuilderCardView): boolean {
    return (
      availableCopies(
        card.code,
        ownership,
        quantityLimit(ruleset, card.code),
        copies.get(card.code) ?? 0,
      ) > 0
    );
  }

  function blockedReason(card: DeckBuilderCardView): string {
    return unavailableReason(
      ownership.ownedCount(card.code),
      quantityLimit(ruleset, card.code),
    );
  }

  function capReasonId(code: number): string {
    return `deck-catalog-cap-reason-${code}`;
  }

  function setFilter<Key extends keyof DeckCatalogFilters>(
    key: Key,
    value: DeckCatalogFilters[Key],
  ): void {
    filters = { ...filters, [key]: value };
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
  </header>

  <label data-cy="deck-catalog-name-field">
    <span data-cy="deck-catalog-name-label">Name</span>
    <input
      type="search"
      value={filters.name}
      placeholder="Filter by card name"
      data-cy="deck-catalog-name-input"
      bind:this={nameInput}
      oninput={(event) => setFilter("name", event.currentTarget.value)}
    />
  </label>

  <div class="filters" data-cy="deck-catalog-filters">
    <label data-cy="deck-catalog-family-field">
      <span data-cy="deck-catalog-family-label">Card type</span>
      <select
        data-cy="deck-catalog-family-select"
        value={filters.family ?? ""}
        onchange={(event) =>
          setFilter(
            "family",
            (event.currentTarget.value || null) as DeckCatalogFilters["family"],
          )}
      >
        <option value="" data-cy="deck-catalog-family-option-all">All</option>
        <option value="monster" data-cy="deck-catalog-family-option-monster"
          >Monster</option
        >
        <option value="spell" data-cy="deck-catalog-family-option-spell"
          >Spell</option
        >
        <option value="trap" data-cy="deck-catalog-family-option-trap"
          >Trap</option
        >
      </select>
    </label>
    <label data-cy="deck-catalog-subtype-field">
      <span data-cy="deck-catalog-subtype-label">Subtype</span>
      <select
        data-cy="deck-catalog-subtype-select"
        value={filters.subtype ?? ""}
        onchange={(event) =>
          setFilter("subtype", event.currentTarget.value || null)}
      >
        <option value="" data-cy="deck-catalog-subtype-option-all">All</option>
        {#each options.subtypes as option (option)}
          <option
            value={option}
            data-cy={`deck-catalog-subtype-option-${option}`}>{option}</option
          >
        {/each}
      </select>
    </label>
    <label data-cy="deck-catalog-attribute-field">
      <span data-cy="deck-catalog-attribute-label">Attribute</span>
      <select
        data-cy="deck-catalog-attribute-select"
        value={filters.attribute ?? ""}
        onchange={(event) =>
          setFilter("attribute", event.currentTarget.value || null)}
      >
        <option value="" data-cy="deck-catalog-attribute-option-all">All</option
        >
        {#each options.attributes as option (option)}
          <option
            value={option}
            data-cy={`deck-catalog-attribute-option-${option}`}>{option}</option
          >
        {/each}
      </select>
    </label>
    <label data-cy="deck-catalog-race-field">
      <span data-cy="deck-catalog-race-label">Monster type</span>
      <select
        data-cy="deck-catalog-race-select"
        value={filters.race ?? ""}
        onchange={(event) =>
          setFilter("race", event.currentTarget.value || null)}
      >
        <option value="" data-cy="deck-catalog-race-option-all">All</option>
        {#each options.races as option (option)}
          <option value={option} data-cy={`deck-catalog-race-option-${option}`}
            >{option}</option
          >
        {/each}
      </select>
    </label>
  </div>

  {#if filters.name || filters.family || filters.subtype || filters.attribute || filters.race}
    <div class="filter-summary" data-cy="deck-catalog-filter-summary">
      <span data-cy="deck-catalog-filter-summary-label">Filters active</span>
      <button
        type="button"
        class="secondary small"
        data-cy="deck-catalog-clear-all"
        onclick={() => (filters = { ...EMPTY_CATALOG_FILTERS })}
        >Clear all</button
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
        onclick={() => (filters = { ...EMPTY_CATALOG_FILTERS })}
        >Clear filters</button
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
          {@const spent = spentCodes.has(card.code)}
          <CardTile
            {card}
            code={card.code}
            limit={quantityLimit(ruleset, card.code)}
            currentCopies={copies.get(card.code) ?? 0}
            selected={selectedCode === card.code}
            draggable={!spent}
            describedby={spent ? capReasonId(card.code) : null}
            dataCyPrefix="catalog"
            dataCyId={card.code}
            onselect={() => onselect(card)}
            ontap={ontap === null
              ? null
              : () =>
                  addable(card)
                    ? ontap(card)
                    : onblocked(card, blockedReason(card))}
            ondoubleclick={ondoubleclick === null
              ? null
              : () =>
                  addable(card)
                    ? ondoubleclick(card)
                    : onblocked(card, blockedReason(card))}
            ondragcard={(event) => ondragcard(card, event)}
            {ondragcancel}
            onhover={() => onhovercard(card)}
            maxed={spent}
            oncontext={() => oncontextadd(card)}
          />
          <!-- Out of flow, so it takes no cell in the results grid, and read to
               a screen reader through the tile's `aria-describedby` rather than
               printed under every spent card. -->
          {#if spent}
            <span
              class="visually-hidden"
              id={capReasonId(card.code)}
              data-cy={capReasonId(card.code)}>{blockedReason(card)}</span
            >
          {/if}
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

  label span {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 750;
  }

  label {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.75rem;
  }

  input,
  select {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.65rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-chain);
  }

  .filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 0.55rem;
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
