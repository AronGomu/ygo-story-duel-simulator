<script lang="ts">
  import {
    catalogFilterOptions,
    EMPTY_CATALOG_FILTERS,
    filterDeckCatalog,
    type DeckCatalogFilters,
  } from "../../../decks/catalog/deck-catalog.ts";
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
  import { quantityLimit } from "../../../decks/catalog/pinned-ruleset.ts";
  import CardTile from "./CardTile.svelte";

  export let cards: readonly DeckBuilderCardView[];
  export let ruleset: PinnedDeckRuleset;
  export let selectedCode: number | null = null;
  export let fixtureState: "live" | "loading" | "empty" | "error" = "live";
  export let copies: ReadonlyMap<number, number> = new Map();
  export let onselect: (card: DeckBuilderCardView) => void = () => undefined;
  export let ondragcard: (
    card: DeckBuilderCardView,
    event: DragEvent,
  ) => void = () => undefined;
  export let ondragcancel: () => void = () => undefined;
  export let onpickup: (card: DeckBuilderCardView) => void = () => undefined;
  export let onblocked: (
    card: DeckBuilderCardView,
    reason: string,
  ) => void = () => undefined;

  let filters: DeckCatalogFilters = { ...EMPTY_CATALOG_FILTERS };
  $: options = catalogFilterOptions(cards);
  $: results =
    fixtureState === "empty" ? [] : filterDeckCatalog(cards, filters);

  function setFilter<Key extends keyof DeckCatalogFilters>(
    key: Key,
    value: DeckCatalogFilters[Key],
  ): void {
    filters = { ...filters, [key]: value };
  }
</script>

<section class="catalog" aria-labelledby="catalog-heading">
  <header>
    <div>
      <p class="section-label">Card catalog</p>
      <h2 id="catalog-heading">Find cards</h2>
    </div>
    <span>{results.length} results</span>
  </header>

  {#if fixtureState === "loading"}
    <div
      class="catalog-skeleton"
      aria-busy="true"
      aria-label="Loading card catalog"
    >
      Loading card catalog…
    </div>
  {:else if fixtureState === "error"}
    <div class="empty-state" role="alert">
      <h3>Card catalog could not load</h3>
      <p>Simulated fixture error. Select Live data to retry.</p>
    </div>
  {:else}
    <label>
      <span>Name</span>
      <input
        type="search"
        value={filters.name}
        placeholder="Filter by card name"
        oninput={(event) => setFilter("name", event.currentTarget.value)}
      />
    </label>

    <div class="filters">
      <label>
        <span>Card type</span>
        <select
          value={filters.family ?? ""}
          onchange={(event) =>
            setFilter(
              "family",
              (event.currentTarget.value ||
                null) as DeckCatalogFilters["family"],
            )}
        >
          <option value="">All</option>
          <option value="monster">Monster</option>
          <option value="spell">Spell</option>
          <option value="trap">Trap</option>
        </select>
      </label>
      <label>
        <span>Subtype</span>
        <select
          value={filters.subtype ?? ""}
          onchange={(event) =>
            setFilter("subtype", event.currentTarget.value || null)}
        >
          <option value="">All</option>
          {#each options.subtypes as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Attribute</span>
        <select
          value={filters.attribute ?? ""}
          onchange={(event) =>
            setFilter("attribute", event.currentTarget.value || null)}
        >
          <option value="">All</option>
          {#each options.attributes as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Monster type</span>
        <select
          value={filters.race ?? ""}
          onchange={(event) =>
            setFilter("race", event.currentTarget.value || null)}
        >
          <option value="">All</option>
          {#each options.races as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if filters.name || filters.family || filters.subtype || filters.attribute || filters.race}
      <div class="filter-summary">
        <span>Filters active</span>
        <button
          type="button"
          class="secondary small"
          onclick={() => (filters = { ...EMPTY_CATALOG_FILTERS })}
          >Clear all</button
        >
      </div>
    {/if}

    {#if results.length === 0}
      <div class="empty-state">
        <h3>No matching cards</h3>
        <p>Clear filters or try another card name.</p>
        <button
          type="button"
          onclick={() => (filters = { ...EMPTY_CATALOG_FILTERS })}
          >Clear filters</button
        >
      </div>
    {:else}
      <div class="results" aria-label="Card catalog results">
        {#each results as card (card.code)}
          <CardTile
            {card}
            code={card.code}
            limit={quantityLimit(ruleset, card.code)}
            currentCopies={copies.get(card.code) ?? 0}
            selected={selectedCode === card.code}
            draggable={(copies.get(card.code) ?? 0) <
              quantityLimit(ruleset, card.code)}
            onselect={() => onselect(card)}
            ondragcard={(event) => ondragcard(card, event)}
            {ondragcancel}
            onpickup={() => onpickup(card)}
            onblocked={() =>
              onblocked(
                card,
                quantityLimit(ruleset, card.code) === 0
                  ? "Card is forbidden."
                  : `Copy limit ${quantityLimit(ruleset, card.code)} reached.`,
              )}
          />
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .catalog {
    min-width: 0;
    height: calc(100vh - 9.5rem);
    overflow: hidden;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--surface);
  }

  header,
  .filter-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .section-label,
  label span {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 750;
  }

  .catalog-skeleton {
    min-height: 28rem;
    margin-top: 0.75rem;
    padding: 1rem;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 0.55rem;
    background: linear-gradient(110deg, #0d1729 8%, #17253d 18%, #0d1729 33%);
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
    color: #e8edf8;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: #0d1729;
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

  .results {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
    max-height: calc(100vh - 29rem);
    overflow-y: auto;
    padding: 0.2rem 0.35rem 0.5rem 0.1rem;
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
