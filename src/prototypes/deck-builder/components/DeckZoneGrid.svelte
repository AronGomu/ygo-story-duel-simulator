<script lang="ts">
  import type { DeckZone } from "../../../decks/deck-contracts.ts";
  import type { DeckGridPlan } from "../../../decks/deck-model.ts";
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
  import { quantityLimit } from "../../../decks/catalog/pinned-ruleset.ts";
  import CardTile from "./CardTile.svelte";

  export let zone: DeckZone;
  export let label: string;
  export let codes: readonly number[];
  export let plan: DeckGridPlan;
  export let catalog: ReadonlyMap<number, DeckBuilderCardView>;
  export let ruleset: PinnedDeckRuleset;
  export let totalCopies: ReadonlyMap<number, number>;
  export let selectedCode: number | null = null;
  export let picked = false;
  export let onselect: (
    card: DeckBuilderCardView | null,
    code: number,
  ) => void = () => undefined;
  export let ondragcard: (
    code: number,
    zone: DeckZone,
    event: DragEvent,
  ) => void = () => undefined;
  export let ondragcancel: () => void = () => undefined;
  export let onpickup: (code: number, zone: DeckZone) => void = () => undefined;
  export let ondropzone: (zone: DeckZone) => void = () => undefined;

  $: emptyCount = Math.max(0, plan.slots - codes.length);
</script>

<section class="zone" aria-labelledby={`${zone}-heading`}>
  <header>
    <h3 id={`${zone}-heading`} tabindex="-1">{label}</h3>
    <span class:error={codes.length > plan.slots}
      >{codes.length}/{plan.slots}</span
    >
  </header>
  {#if picked}
    <button
      type="button"
      class="keyboard-drop"
      onclick={() => ondropzone(zone)}
    >
      Drop picked card in {label}
    </button>
  {/if}
  <div
    class:picked
    class="drop-zone"
    role="group"
    aria-label={`${label} drop area`}
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => {
      event.preventDefault();
      ondropzone(zone);
    }}
  >
    <div
      class:compact={plan.compact}
      class="grid"
      style={`--columns:${plan.columns}`}
      data-columns={plan.columns}
      data-rows={plan.rows}
      data-slots={plan.slots}
      aria-label={`${label}: ${codes.length} cards in ${plan.slots} slots`}
    >
      {#each codes as code, index (`${code}-${index}`)}
        <CardTile
          card={catalog.get(code) ?? null}
          {code}
          {zone}
          limit={quantityLimit(ruleset, code)}
          currentCopies={totalCopies.get(code) ?? 0}
          selected={selectedCode === code}
          compact={plan.compact}
          onselect={() => onselect(catalog.get(code) ?? null, code)}
          ondragcard={(event) => ondragcard(code, zone, event)}
          {ondragcancel}
          onpickup={() => onpickup(code, zone)}
        />
      {/each}
      {#each Array.from({ length: emptyCount }) as slot, index (index)}
        <span
          class="empty-slot"
          data-empty-slot={slot === undefined ? index : slot}
          aria-hidden="true"
        ></span>
      {/each}
    </div>
  </div>
  {#if codes.length > plan.slots}
    <p class="overflow" role="alert">
      {codes.length - plan.slots} overflow card(s) remain invalid.
    </p>
  {/if}
</section>

<style>
  .zone {
    min-width: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.45rem;
  }

  h3 {
    margin: 0;
    font-size: 0.94rem;
  }

  header span {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 750;
  }

  header span.error,
  .overflow {
    color: var(--danger);
  }

  .drop-zone {
    width: 100%;
    min-height: 0;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.55rem;
    background: #0a1425;
  }

  .keyboard-drop {
    width: 100%;
    margin-bottom: 0.35rem;
  }

  .drop-zone:hover,
  .drop-zone.picked {
    border-color: var(--accent);
    background: #0d1b2e;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    gap: 0.3rem;
  }

  .grid.compact {
    gap: 0.22rem;
  }

  .empty-slot {
    aspect-ratio: 59 / 86;
    border: 1px dashed rgb(105 120 149 / 0.55);
    border-radius: 0.32rem;
    background: rgb(255 255 255 / 0.018);
  }

  .overflow {
    margin: 0.35rem 0 0;
    font-size: 0.76rem;
  }
</style>
