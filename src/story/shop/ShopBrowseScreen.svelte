<script lang="ts">
  import { latestReleasedSets } from "./data/latest-sets.ts";
  import type { ShopSetEntry } from "./data/shop-set-data.ts";
  import SetTile from "./SetTile.svelte";
  import ShopSetDialog from "./ShopSetDialog.svelte";

  export let sets: readonly ShopSetEntry[] | null = null;
  export let error: string | null = null;
  export let dp = 0;
  export let onbuy: (setId: string, count: number) => void;
  export let onviewcards: (setId: string) => void = () => undefined;
  export let onretry: () => void = () => undefined;
  export let onback: () => void;
  export let imageUrlFor: (entry: ShopSetEntry) => string | null = (entry) =>
    `${import.meta.env.BASE_URL}runtime/sets/${entry.id}.jpg`;

  let dialogSetId: string | null = null;

  $: latestRow = latestReleasedSets(sets ?? []);

  /* Installed ChapterSet data supplies null when authoritative set art does
     not exist. Legacy shop data keeps the packaged-path default above. */

  function openDialog(entry: ShopSetEntry): void {
    if (!entry.released) return;
    dialogSetId = entry.id;
  }

  $: dialogEntry =
    dialogSetId !== null
      ? (sets ?? []).find((s) => s.id === dialogSetId)
      : undefined;
</script>

<section
  class="shop-browse"
  aria-label="Set browser"
  data-cy="story-shop-browse"
>
  <header class="browse-header" data-cy="story-shop-browse-header">
    <button
      type="button"
      class="story-danger"
      data-cy="story-shop-browse-back"
      onclick={onback}>← Back</button
    >
  </header>

  {#if error !== null}
    <div class="state-block" role="alert" data-cy="story-shop-browse-error">
      <p data-cy="story-shop-browse-error-message">{error}</p>
      <button type="button" data-cy="story-shop-browse-retry" onclick={onretry}
        >Retry</button
      >
    </div>
  {:else if sets === null}
    <div
      class="state-block"
      aria-busy="true"
      data-cy="story-shop-browse-loading"
    >
      <p data-cy="story-shop-browse-loading-text">Loading sets…</p>
    </div>
  {:else}
    {#if latestRow.length > 0}
      <section
        aria-label="Latest released sets"
        data-cy="story-shop-latest-row"
      >
        <h2 class="row-heading" data-cy="story-shop-latest-row-heading">
          Latest Released
        </h2>
        <div class="latest-scroll" data-cy="story-shop-latest-scroll">
          {#each latestRow as set (set.id)}
            <SetTile
              {set}
              imageUrl={imageUrlFor(set)}
              variant="latest"
              onselect={() => openDialog(set)}
            />
          {/each}
        </div>
      </section>
    {/if}

    <section aria-label="All sets" data-cy="story-shop-set-grid-section">
      <h2 class="row-heading" data-cy="story-shop-set-grid-heading">
        All Sets
      </h2>
      <div class="set-grid" data-cy="story-shop-set-grid">
        {#each sets as set (set.id)}
          <SetTile
            {set}
            imageUrl={imageUrlFor(set)}
            variant="set"
            onselect={() => openDialog(set)}
          />
        {/each}
      </div>
    </section>
  {/if}
</section>

{#if dialogSetId !== null && dialogEntry !== undefined}
  <ShopSetDialog
    set={dialogEntry}
    {dp}
    {onbuy}
    {onviewcards}
    onclose={() => {
      dialogSetId = null;
    }}
  />
{/if}

<style>
  .shop-browse {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: clamp(1rem, 4cqw, 2.5rem);
    background:
      radial-gradient(circle at 70% 20%, var(--field-glow), transparent 30%),
      var(--bg);
  }

  .browse-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .row-heading {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
  }

  .latest-scroll {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    margin-bottom: 2rem;
  }

  /* Two columns is the tablet shape; the desktop the owner sizes for shows
     exactly four with the rest below the fold, and one narrow column is the
     phone. Nothing here caps the height — the page scrolls. */
  .set-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 2rem;
  }

  @media (min-width: 1280px) {
    .set-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .set-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .state-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem;
    text-align: center;
  }
</style>
