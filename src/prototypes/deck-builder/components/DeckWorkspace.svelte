<script lang="ts">
  import { tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { DeckRecord, DeckZone } from "../../../decks/deck-contracts.ts";
  import type { PickedCard } from "../drag-state.ts";
  import {
    FIFTEEN_CARD_GRID,
    mainDeckGridPlan,
  } from "../../../decks/deck-model.ts";
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
  import DeckZoneGrid from "./DeckZoneGrid.svelte";
  import ValidationIssues from "./ValidationIssues.svelte";

  export let deck: DeckRecord;
  export let catalog: ReadonlyMap<number, DeckBuilderCardView>;
  export let ruleset: PinnedDeckRuleset;
  export let selectedCode: number | null = null;
  export let picked: PickedCard | null = null;
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
  export let onremove: () => void = () => undefined;

  let workspaceElement: HTMLElement;
  $: totalCopies = countCopies(deck);
  $: mainDropAllowed = canDrop("main", picked, catalog);
  $: extraDropAllowed = canDrop("extra", picked, catalog);
  $: sideDropAllowed = canDrop("side", picked, catalog);

  function canDrop(
    zone: DeckZone,
    active: PickedCard | null,
    cards: ReadonlyMap<number, DeckBuilderCardView>,
  ): boolean {
    if (active === null) return false;
    const card = cards.get(active.code);
    if (card === undefined) return false;
    if (active.source === "catalog" || active.source === "side")
      return zone === card.canonicalZone;
    return zone === "side";
  }

  async function dropAndRestoreFocus(zone: DeckZone): Promise<void> {
    ondropzone(zone);
    await tick();
    document.getElementById(`${zone}-heading`)?.focus();
  }

  async function focusIssue(
    cardCode: number | null,
    zone: string | null,
  ): Promise<void> {
    if (cardCode !== null) onselect(catalog.get(cardCode) ?? null, cardCode);
    await tick();
    const zoneSelector = zone === null ? "" : `[data-deck-zone="${zone}"]`;
    const card =
      cardCode === null
        ? null
        : workspaceElement.querySelector<HTMLElement>(
            `[data-card-code="${cardCode}"]${zoneSelector}`,
          );
    if (card !== null) card.focus();
    else if (zone !== null) document.getElementById(`${zone}-heading`)?.focus();
  }

  function countCopies(value: DeckRecord): ReadonlyMap<number, number> {
    const counts = new SvelteMap<number, number>();
    for (const code of [...value.main, ...value.extra, ...value.side])
      counts.set(code, (counts.get(code) ?? 0) + 1);
    return counts;
  }
</script>

<section
  class="workspace"
  aria-labelledby="workspace-heading"
  bind:this={workspaceElement}
>
  <header class="workspace-header">
    <div>
      <p>Deck workspace</p>
      <h2 id="workspace-heading">Build deck</h2>
    </div>
    {#if picked && picked.source !== "catalog"}
      <button
        type="button"
        class="danger remove"
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => {
          event.preventDefault();
          onremove();
        }}
        onclick={onremove}
      >
        Remove picked card
      </button>
    {/if}
  </header>

  <DeckZoneGrid
    zone="main"
    label="Main Deck"
    codes={deck.main}
    plan={mainDeckGridPlan(deck.main.length)}
    {catalog}
    {ruleset}
    {totalCopies}
    {selectedCode}
    picked={mainDropAllowed}
    {onselect}
    {ondragcard}
    {ondragcancel}
    {onpickup}
    ondropzone={(zone) => void dropAndRestoreFocus(zone)}
  />

  <div class="secondary-zones">
    <DeckZoneGrid
      zone="extra"
      label="Extra Deck"
      codes={deck.extra}
      plan={FIFTEEN_CARD_GRID}
      {catalog}
      {ruleset}
      {totalCopies}
      {selectedCode}
      picked={extraDropAllowed}
      {onselect}
      {ondragcard}
      {ondragcancel}
      {onpickup}
      ondropzone={(zone) => void dropAndRestoreFocus(zone)}
    />
    <DeckZoneGrid
      zone="side"
      label="Side Deck"
      codes={deck.side}
      plan={FIFTEEN_CARD_GRID}
      {catalog}
      {ruleset}
      {totalCopies}
      {selectedCode}
      picked={sideDropAllowed}
      {onselect}
      {ondragcard}
      {ondragcancel}
      {onpickup}
      ondropzone={(zone) => void dropAndRestoreFocus(zone)}
    />
  </div>

  <ValidationIssues
    validation={deck.validation}
    onfocusissue={(code, zone) => void focusIssue(code, zone)}
  />
</section>

<style>
  .workspace {
    min-width: 0;
    height: calc(100vh - 9.5rem);
    overflow-y: auto;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--surface);
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .workspace-header p,
  .workspace-header h2 {
    margin: 0;
  }

  .workspace-header p {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 750;
  }

  .remove {
    min-height: 2.25rem;
    padding: 0.45rem 0.65rem;
  }

  .secondary-zones {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 0.8rem;
  }
</style>
