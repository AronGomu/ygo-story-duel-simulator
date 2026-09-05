<script lang="ts">
  import type { DeckTileModel } from "./deck-select-contracts.ts";

  export let tile: DeckTileModel;
  /** Visual selection halo: null = none. Selected focus uses orange (--selected). */
  export let halo: "you" | "opponent" | "focus" | null = null;
  /** "Yours" tag while filling the opponent seat. */
  export let yours = false;
  export let showMenu = true;
  export let disabled = false;
  export let canSetDefault = true;
  export let onpress: () => void = () => undefined;
  export let ondblpress: () => void = () => undefined;
  export let onrename: (() => void) | null = null;
  export let onsetdefault: () => void = () => undefined;
  /** Kebab pressed; anchor element passed so the menu can position. */
  export let onmenu: (anchor: HTMLElement) => void = () => undefined;
  /** Identity every `data-cy` here is built from; null uses the deck's key.
      One deck can render twice in a document — the grid tile and the seat card
      showing the same pick — and the element contract wants one value each. */
  export let cyKey: string | null = null;

  /* Availability stays one scan line. Specific refusal follows its category;
     repeated bundled copy is collapsed before rendering. */
  $: tagLine = [
    ...new Set([
      ...(tile.legal ? [] : ["Illegal"]),
      tile.meta,
      ...(tile.bundled && tile.meta !== "Bundled" ? ["Bundled"] : []),
      ...(tile.lockedBy === null ? [] : [`Locked: ${tile.lockedBy}`]),
      ...(yours ? ["Yours"] : []),
    ]),
  ].join(" · ");
  /* Keep visual tags unchanged while ensuring authoritative illegal reason is
     spoken even when host meta omits it. */
  $: accessibleTagLine = [
    tagLine,
    ...(tile.legal ||
    tile.blockReason === null ||
    tagLine.includes(tile.blockReason)
      ? []
      : [tile.blockReason]),
  ]
    .filter((tag) => tag.length > 0)
    .join(" · ");
  $: pressLabel = `Select ${tile.name}${
    accessibleTagLine.length > 0 ? `, ${accessibleTagLine}` : ""
  }`;
  $: renameLabel = `Rename ${tile.name}`;
  /* A deck that fails validation cannot be picked, so the press surface itself
     carries the fact — the dimming is the sighted echo, never the source. */
  let failedArtUrls: readonly string[] = [];
  $: fullCardFallbackUrl =
    tile.coverImageUrl?.replace(
      "/runtime/images-cropped/",
      "/runtime/images/",
    ) ?? null;
  $: artUrl =
    tile.coverImageUrl !== null && !failedArtUrls.includes(tile.coverImageUrl)
      ? tile.coverImageUrl
      : fullCardFallbackUrl !== null &&
          !failedArtUrls.includes(fullCardFallbackUrl)
        ? fullCardFallbackUrl
        : null;
  $: pressDisabled = disabled || !tile.legal;
  $: cyId = cyKey ?? tile.key;
</script>

<article
  class="deck-tile"
  class:halo-you={halo === "you"}
  class:halo-opponent={halo === "opponent"}
  class:halo-focus={halo === "focus"}
  class:is-default={tile.isDefault}
  class:illegal={!tile.legal}
  data-cy={`deck-tile-${cyId}`}
>
  <button
    type="button"
    class="press"
    disabled={pressDisabled}
    aria-label={pressLabel}
    onclick={() => onpress()}
    ondblclick={() => ondblpress()}
    data-cy={`deck-tile-press-${cyId}`}
  >
    {#if artUrl !== null}
      <img
        class="art"
        loading="lazy"
        decoding="async"
        src={artUrl}
        alt=""
        onerror={() =>
          artUrl !== null && (failedArtUrls = [...failedArtUrls, artUrl])}
        data-cy={`deck-tile-art-${cyId}`}
      />
    {:else}
      <!-- Authored geometry rather than a packaged asset: a deck with no cover
           card still has to fill the whole tile behind its content. -->
      <svg
        class="art"
        viewBox="0 0 200 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        data-cy={`deck-tile-art-placeholder-${cyId}`}
      >
        <rect
          class="art-field"
          width="200"
          height="100"
          data-cy={`deck-tile-art-field-${cyId}`}
        />
        <path
          class="art-sigil"
          d="M140 18 L178 50 L140 82 L102 50 Z"
          data-cy={`deck-tile-art-sigil-${cyId}`}
        />
      </svg>
    {/if}
    {#if onrename === null}
      <span class="name text-backdrop" data-cy={`deck-tile-name-${cyId}`}
        >{tile.name}</span
      >
    {/if}
    <span class="tag-line text-backdrop" data-cy={`deck-tile-tags-${cyId}`}
      >{tagLine}</span
    >
  </button>

  {#if onrename !== null}
    <button
      type="button"
      class="name text-backdrop"
      aria-label={renameLabel}
      onclick={() => onrename?.()}
      data-cy={`deck-tile-name-${cyId}`}>{tile.name}</button
    >
  {/if}

  {#if canSetDefault}
    <button
      type="button"
      class="corner star"
      class:filled={tile.isDefault}
      class:outline={!tile.isDefault}
      disabled={tile.isDefault}
      aria-label={tile.isDefault
        ? "Default deck"
        : `Set ${tile.name} as default deck`}
      aria-pressed={tile.isDefault ? "true" : "false"}
      onclick={(event) => {
        event.stopPropagation();
        onsetdefault();
      }}
      data-cy={`deck-tile-default-star-${cyId}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-cy={`deck-tile-default-star-icon-${cyId}`}
      >
        <path
          d="M12 2.75 14.77 8.36 20.96 9.26 16.48 13.63 17.54 19.8 12 16.89 6.46 19.8 7.52 13.63 3.04 9.26 9.23 8.36Z"
          fill={tile.isDefault ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
          data-cy={`deck-tile-default-star-path-${cyId}`}
        />
      </svg>
    </button>
  {/if}

  {#if showMenu}
    <button
      type="button"
      class="corner kebab"
      aria-label={`Actions for ${tile.name}`}
      onclick={(event) => {
        event.stopPropagation();
        onmenu(event.currentTarget);
      }}
      data-cy={`deck-tile-menu-${cyId}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-cy={`deck-tile-menu-icon-${cyId}`}
      >
        <circle
          cx="12"
          cy="5"
          r="1.5"
          data-cy={`deck-tile-menu-dot-1-${cyId}`}
        />
        <circle
          cx="12"
          cy="12"
          r="1.5"
          data-cy={`deck-tile-menu-dot-2-${cyId}`}
        />
        <circle
          cx="12"
          cy="19"
          r="1.5"
          data-cy={`deck-tile-menu-dot-3-${cyId}`}
        />
      </svg>
    </button>
  {/if}
</article>

<style>
  .deck-tile {
    --corner-size: 2.75rem;
    --deck-tile-tag-width: calc(
      100% - var(--corner-size) - var(--space-2) - var(--space-2) -
        var(--space-2)
    );

    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    isolation: isolate;
  }

  .press {
    display: grid;
    grid-template-areas: "tile";
    grid-template-rows: minmax(0, 1fr);
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    color: inherit;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .press > * {
    grid-area: tile;
    min-width: 0;
  }

  .press:disabled {
    cursor: default;
  }

  .art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0.8;
  }

  .art-field {
    fill: var(--surface-panel);
  }

  .art-sigil {
    fill: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .name {
    z-index: 1;
    display: -webkit-box;
    max-width: 70%;
    margin: var(--space-2);
    padding: var(--space-1) var(--space-2);
    overflow: hidden;
    align-self: start;
    justify-self: start;
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.15;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .tag-line {
    z-index: 1;
    box-sizing: border-box;
    width: var(--deck-tile-tag-width);
    margin: var(--space-2);
    padding: var(--space-2);
    overflow: hidden;
    align-self: end;
    justify-self: start;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text-backdrop {
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--shadow) 65%, transparent);
  }

  .name,
  .tag-line {
    text-shadow:
      0 1px 2px var(--shadow),
      0 0 0.4rem var(--shadow);
  }

  button.name {
    position: absolute;
    z-index: 3;
    top: 0;
    left: 0;
    min-height: 0;
    border: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.name:hover {
    color: var(--selected);
  }

  button.name:hover:not(:disabled) {
    background: color-mix(in srgb, var(--shadow) 65%, transparent);
  }

  .corner {
    position: absolute;
    z-index: 2;
    display: grid;
    width: var(--corner-size);
    height: var(--corner-size);
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: color-mix(in srgb, var(--shadow) 65%, transparent);
    line-height: 1;
  }

  .corner svg {
    width: 1.2rem;
    height: 1.2rem;
  }

  .star {
    top: var(--space-2);
    right: var(--space-2);
    color: var(--accent);
    cursor: pointer;
  }

  .star:hover:not(:disabled) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--shadow));
  }

  .star:disabled {
    border-color: var(--gold-line);
    color: var(--accent);
    cursor: default;
    opacity: 1;
  }

  .kebab {
    right: var(--space-2);
    bottom: var(--space-2);
    cursor: pointer;
  }

  .kebab circle {
    fill: currentColor;
  }

  .deck-tile.halo-you {
    border-color: var(--seat-you);
    box-shadow: 0 0 0.55rem color-mix(in srgb, var(--seat-you) 55%, transparent);
  }

  .deck-tile.halo-opponent {
    border-color: var(--seat-opponent);
    box-shadow: 0 0 0.55rem
      color-mix(in srgb, var(--seat-opponent) 55%, transparent);
  }

  .deck-tile.halo-focus {
    border-color: var(--selected);
    box-shadow: 0 0 0.55rem color-mix(in srgb, var(--selected) 65%, transparent);
  }

  /* Default remains independently visible when selection halo moves. */
  .deck-tile.is-default {
    border-color: var(--accent);
  }

  .deck-tile.illegal {
    opacity: 0.55;
  }
</style>
