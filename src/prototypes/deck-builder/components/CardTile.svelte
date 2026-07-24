<script lang="ts">
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";

  export let card: DeckBuilderCardView | null;
  export let code: number;
  export let limit: 0 | 1 | 2 | 3 = 3;
  export let currentCopies = 0;
  export let selected = false;
  export let draggable = true;
  export let compact = false;
  export let zone: string | null = null;
  export let onselect: () => void = () => undefined;
  export let ondragcard: (event: DragEvent) => void = () => undefined;
  export let ondragcancel: () => void = () => undefined;
  export let onpickup: () => void = () => undefined;
  export let onblocked: () => void = () => undefined;

  $: name = card?.name ?? `Missing card ${code}`;
  $: limitLabel =
    limit === 0
      ? "Forbidden"
      : limit === 1
        ? "Limited"
        : limit === 2
          ? "Semi-Limited"
          : "Unlimited";
</script>

<button
  type="button"
  class:compact
  class:selected
  class:missing={card === null}
  class="card-tile"
  {draggable}
  aria-label={`${name}. ${limitLabel}, maximum ${limit}. ${currentCopies} copies in deck.`}
  aria-pressed={selected}
  data-card-code={code}
  data-deck-zone={zone}
  onclick={onselect}
  ondragstart={ondragcard}
  ondragend={ondragcancel}
  onkeydown={(event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (draggable) onpickup();
      else onblocked();
    }
  }}
>
  <span class={`limit-badge limit-${limit}`} aria-hidden="true">{limit}</span>
  {#if card?.imageUrl}
    <img src={card.imageUrl} alt="" />
  {:else}
    <span class="art-placeholder" aria-hidden="true">
      <span>{card === null ? "!" : card.family.slice(0, 1).toUpperCase()}</span>
    </span>
  {/if}
  <span class="card-name">{name}</span>
</button>

<style>
  .card-tile {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 0;
    aspect-ratio: 59 / 86;
    padding: 0;
    overflow: hidden;
    color: #eef3ff;
    border: 1px solid #697895;
    border-radius: 0.38rem;
    background: #18243b;
    font-weight: 650;
    isolation: isolate;
  }

  .card-tile:hover:not(:disabled),
  .card-tile.selected {
    border-color: #73daca;
    background: #22324e;
  }

  .card-tile.missing {
    border-style: dashed;
    border-color: #ff8c9b;
    background: #321825;
  }

  .art-placeholder {
    display: grid;
    min-height: 0;
    place-items: center;
    background:
      linear-gradient(145deg, rgb(115 218 202 / 0.16), transparent 52%), #101a2c;
    font-size: clamp(1rem, 2vw, 2rem);
  }

  .missing .art-placeholder {
    background: #321825;
  }

  .card-name {
    display: -webkit-box;
    min-height: 2.1rem;
    padding: 0.3rem;
    overflow: hidden;
    font-size: clamp(0.56rem, 0.72vw, 0.74rem);
    line-height: 1.15;
    text-align: left;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .compact .card-name {
    font-size: 0.58rem;
  }

  .limit-badge {
    position: absolute;
    z-index: 1;
    top: 0.22rem;
    left: 0.22rem;
    display: grid;
    width: 1.35rem;
    height: 1.35rem;
    place-items: center;
    border: 2px solid currentColor;
    border-radius: 999px;
    color: #08101f;
    background: #e8edf8;
    font-size: 0.72rem;
    font-weight: 900;
  }

  .limit-0 {
    color: #fff;
    background: #b52140;
  }

  .limit-1 {
    background: #ff8c9b;
  }

  .limit-2 {
    background: #ffd580;
  }

  .limit-3 {
    background: #73daca;
  }
</style>
