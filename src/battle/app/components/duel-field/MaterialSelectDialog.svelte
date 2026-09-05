<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { ChoiceId } from "../../../duel/contracts/ids.ts";
  import type {
    CardImageLease,
    CardImageLibrary,
  } from "../../images/card-image-cache.ts";
  import type { InteractionChoice } from "../../prompts/interaction-spec.ts";

  /* An engine-issued material choice has no control of its own on the field —
     it rides on its host's zone. Answer it here, as art, instead of in the
     plain text prompt list where a material reads as an identical label. */
  export let choices: readonly InteractionChoice[];
  export let minSelections: number;
  export let maxSelections: number;
  export let imageLibrary: Pick<CardImageLibrary, "lease"> | null;
  export let cardBackUrl: string;
  export let disabled: boolean;
  export let onconfirm: (choiceIds: readonly string[]) => void;
  /** Null for a mandatory prompt, which offers no way out. */
  export let oncancel: (() => void) | null;

  let panel: HTMLDivElement | undefined;
  let selectedChoiceIds: readonly ChoiceId[] = [];
  let syncedChoices: readonly InteractionChoice[] | null = null;
  let activeImageLibrary: Pick<CardImageLibrary, "lease"> | null = null;
  let leases = new SvelteMap<ChoiceId, CardImageLease>();

  $: synchronizeSelection(choices);
  $: synchronizeLeases(imageLibrary, choices);
  $: tiles = choices.map((choice) => ({
    choice,
    url: leases.get(choice.id)?.url ?? cardBackUrl,
    identityVisible: choice.cardCode !== undefined,
    selected: selectedChoiceIds.includes(choice.id),
  }));
  $: confirmEnabled =
    !disabled &&
    selectedChoiceIds.length >= minSelections &&
    selectedChoiceIds.length <= maxSelections;

  onMount(() => {
    panel?.querySelector("button")?.focus({ preventScroll: true });
  });

  onDestroy(() => releaseLeases(leases));

  function synchronizeSelection(values: readonly InteractionChoice[]): void {
    if (values === syncedChoices) return;
    syncedChoices = values;
    selectedChoiceIds = Object.freeze(
      values
        .filter(({ toggleState }) => toggleState === "selected")
        .map(({ id }) => id),
    );
  }

  /* One lease per attested material, dropped as soon as the prompt changes,
     so the dialog never holds an image the next decision cannot use. */
  function synchronizeLeases(
    library: Pick<CardImageLibrary, "lease"> | null,
    values: readonly InteractionChoice[],
  ): void {
    const wanted = new SvelteMap<ChoiceId, CardImageLease>();
    const previous =
      library === activeImageLibrary
        ? leases
        : new SvelteMap<ChoiceId, CardImageLease>();
    if (library !== activeImageLibrary) releaseLeases(leases);
    activeImageLibrary = library;
    for (const { id, cardCode } of values) {
      if (library === null || cardCode === undefined) continue;
      const existing = previous.get(id);
      wanted.set(id, existing ?? library.lease(cardCode));
      previous.delete(id);
    }
    releaseLeases(previous);
    leases = wanted;
  }

  function releaseLeases(values: ReadonlyMap<ChoiceId, CardImageLease>): void {
    for (const lease of values.values()) lease.release();
  }

  function toggle(choiceId: ChoiceId): void {
    if (disabled) return;
    if (selectedChoiceIds.includes(choiceId)) {
      selectedChoiceIds = selectedChoiceIds.filter((id) => id !== choiceId);
      return;
    }
    const next = [...selectedChoiceIds, choiceId];
    /* At the cap the newest pick displaces the oldest, so the common
       "detach 1" question is answered by clicking the material you want
       rather than by deselecting the one you do not. */
    selectedChoiceIds =
      next.length > maxSelections
        ? next.slice(next.length - Math.max(maxSelections, 0))
        : next;
  }
</script>

<div
  class="dialog-backdrop material-select-backdrop"
  data-cy="material-select-backdrop"
>
  <div
    class="dialog-panel material-select-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="material-select-heading"
    data-cy="material-select-dialog"
    bind:this={panel}
  >
    <h2 id="material-select-heading" data-cy="material-select-heading">
      Select material
    </h2>
    <div class="material-select-dialog__tiles" data-cy="material-select-tiles">
      {#each tiles as tile (tile.choice.id)}
        <button
          type="button"
          class="material-select-tile"
          class:is-selected={tile.selected}
          aria-pressed={tile.selected}
          aria-label={tile.choice.label}
          {disabled}
          onclick={() => toggle(tile.choice.id)}
          data-cy={`material-select-tile-${tile.choice.id}`}
        >
          <img
            src={tile.url}
            alt={tile.identityVisible ? tile.choice.label : ""}
            aria-hidden={!tile.identityVisible}
            decoding="async"
            data-cy={`material-select-tile-image-${tile.choice.id}`}
          />
          {#if tile.identityVisible}
            <span
              class="material-select-tile__name"
              data-cy={`material-select-tile-name-${tile.choice.id}`}
              >{tile.choice.label}</span
            >
          {/if}
        </button>
      {/each}
    </div>
    <div
      class="material-select-dialog__footer"
      data-cy="material-select-footer"
    >
      <output data-cy="material-select-count"
        >{selectedChoiceIds.length} of {minSelections === maxSelections
          ? minSelections
          : `${minSelections}-${maxSelections}`} selected</output
      >
      <button
        type="button"
        disabled={!confirmEnabled}
        onclick={() => onconfirm(selectedChoiceIds)}
        data-cy="material-select-confirm">Confirm</button
      >
      {#if oncancel !== null}
        <button
          type="button"
          class="danger"
          {disabled}
          onclick={() => oncancel?.()}
          data-cy="material-select-cancel">Cancel</button
        >
      {/if}
    </div>
  </div>
</div>
