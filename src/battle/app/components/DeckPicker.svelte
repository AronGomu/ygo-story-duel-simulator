<script lang="ts">
  import type { SelectableDeck } from "../../decks/selectable-decks.ts";

  export let decks: readonly SelectableDeck[] = [];
  export let playerKey = "";
  export let disabled = false;
  /* Set once by the host when a persisted key no longer resolves, so the
     player is told their deck went away rather than left wondering why a
     different one is selected. */
  export let fallbackNotice = false;
  export let startError: string | null = null;
  export let onselect: (playerKey: string) => void = () => undefined;
  export let onstart: () => void = () => undefined;

  let filter = "";

  $: needle = filter.trim().toLocaleLowerCase();
  $: matches = decks.filter((deck) =>
    deck.label.toLocaleLowerCase().includes(needle),
  );
  /* The chosen deck is listed whether or not it matches: a select whose value
     names no option shows nothing selected, and Start would then run a deck
     the player cannot see. Filtering narrows the view, never the choice. */
  $: matchedKeys = new Set(matches.map((deck) => deck.key));
  $: listed = decks.filter(
    (deck) => deck.key === playerKey || matchedKeys.has(deck.key),
  );
  /* The host has already dropped every deck this build cannot play, so the
     local group is either legal rows or nothing at all: there is no disabled
     row here to explain, and no way to choose a deck the duel would refuse. */
  $: presetDecks = listed.filter((deck) => deck.source === "preset");
  $: localDecks = listed.filter((deck) => deck.source === "local");
</script>

<section aria-labelledby="deck-picker-heading" data-cy="deck-picker">
  <h1 id="deck-picker-heading" data-cy="deck-picker-heading">
    Choose your deck
  </h1>

  {#if fallbackNotice}
    <p class="notice" role="status" data-cy="deck-picker-fallback-notice">
      A deck you had chosen is no longer available, so a bundled deck is
      selected again.
    </p>
  {/if}

  {#if startError !== null}
    <p class="notice error" role="alert" data-cy="deck-picker-start-error">
      {startError}
    </p>
  {/if}

  <label
    class="visually-hidden"
    for="deck-picker-filter"
    data-cy="deck-picker-filter-label">Filter decks</label
  >
  <input
    id="deck-picker-filter"
    type="search"
    {disabled}
    bind:value={filter}
    placeholder="Filter decks"
    data-cy="deck-picker-filter"
  />

  {#if matches.length === 0}
    <p class="notice" role="status" data-cy="deck-picker-no-matches">
      No deck matches that filter.
    </p>
  {/if}

  <label
    class="visually-hidden"
    for="deck-picker-player-select"
    data-cy="deck-picker-player-label">Your deck</label
  >
  <select
    id="deck-picker-player-select"
    size="8"
    {disabled}
    value={playerKey}
    data-cy="deck-picker-player-select"
    onchange={(event) => onselect(event.currentTarget.value)}
  >
    {#if presetDecks.length > 0}
      <optgroup label="Bundled decks" data-cy="deck-picker-group-preset">
        {#each presetDecks as deck (deck.key)}
          <option value={deck.key} data-cy={`deck-picker-option-${deck.key}`}
            >{deck.label}</option
          >
        {/each}
      </optgroup>
    {/if}
    <!-- No local deck qualifies is the ordinary state before a player has
         built one, so it renders as the absence of a group rather than an
         empty heading. -->
    {#if localDecks.length > 0}
      <optgroup label="Your decks" data-cy="deck-picker-group-local">
        {#each localDecks as deck (deck.key)}
          <option value={deck.key} data-cy={`deck-picker-option-${deck.key}`}
            >{deck.label}</option
          >
        {/each}
      </optgroup>
    {/if}
  </select>

  <p data-cy="deck-picker-opponent-fixed">
    Opponent deck: Chapter 1 Practice (auto-assigned)
  </p>

  <button
    type="button"
    {disabled}
    data-cy="deck-picker-start-button"
    onclick={onstart}>Start</button
  >
</section>

<style>
  section {
    display: grid;
    gap: 1rem;
    width: min(48rem, 100%);
    margin: 1.5rem auto;
  }

  h1 {
    margin: 0;
  }

  select {
    width: 100%;
  }

  .notice {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--muted);
  }

  .notice.error {
    border-color: var(--danger-border);
    background: var(--danger-surface);
    color: var(--danger);
  }
</style>
