<script lang="ts">
  import {
    PROTOTYPE_REVIEW_STATE_GROUPS,
    reviewStateLabel,
    type PrototypeReviewState,
  } from "../fixtures/states.ts";

  export let value: PrototypeReviewState = "live";
  export let onchange: (value: PrototypeReviewState) => void;

  $: detail = fixtureDetail(value);

  function fixtureDetail(state: PrototypeReviewState): string {
    if (state.startsWith("resolver-"))
      return `resolveDeck(deckId) → ${state.slice("resolver-".length)}`;
    if (state === "history-50") return "50 updates retained · Undo available";
    if (state.startsWith("history-"))
      return `History controls: ${state.slice("history-".length)}`;
    if (state.startsWith("drag-"))
      return `Keyboard/pointer drag: ${state.slice("drag-".length)}`;
    if (state.startsWith("import-"))
      return `YDK import: ${state.slice("import-".length)}`;
    if (state.startsWith("export-"))
      return `YDK export: ${state.slice("export-".length)}`;
    if (state.startsWith("delete-"))
      return `Delete flow: ${state.slice("delete-".length)}`;
    if (state.startsWith("details-"))
      return `Pinned details: ${state.slice("details-".length)}`;
    if (state.startsWith("validation-"))
      return `Deck validation: ${state.slice("validation-".length)}`;
    if (state.startsWith("catalog-"))
      return `Catalog panel: ${state.slice("catalog-".length)}`;
    return reviewStateLabel(state);
  }
</script>

<details class="harness">
  <summary>Prototype review states</summary>
  <label>
    <span>State fixture</span>
    <select
      {value}
      onchange={(event) =>
        onchange(event.currentTarget.value as PrototypeReviewState)}
    >
      <option value="live">Live data</option>
      {#each PROTOTYPE_REVIEW_STATE_GROUPS as group (group.area)}
        <optgroup label={group.area}>
          {#each group.states as fixture (fixture[0])}
            <option value={fixture[0]}>{fixture[1]}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </label>
  {#if value !== "live"}
    <section
      class="fixture-preview"
      aria-label="Deterministic state preview"
      data-review-state={value}
    >
      <strong>{reviewStateLabel(value)}</strong>
      <p role="status">{detail}</p>
      {#if value === "drag-valid" || value === "drag-invalid"}
        <button type="button" disabled={value === "drag-invalid"}>
          {value === "drag-valid" ? "Drop target available" : "Invalid target"}
        </button>
      {:else if value === "import-malformed" || value === "export-failure" || value === "delete-failure"}
        <p role="alert">Simulated failure is visible and recoverable.</p>
      {/if}
    </section>
  {/if}
</details>

<style>
  .harness {
    position: fixed;
    z-index: 40;
    right: 0.75rem;
    bottom: 0.75rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: #111b2f;
    box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 0.35);
    font-size: 0.74rem;
  }

  summary {
    cursor: pointer;
    font-weight: 800;
  }

  label {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  label span,
  .fixture-preview {
    color: var(--muted);
  }

  .fixture-preview {
    display: grid;
    max-width: 18rem;
    gap: 0.3rem;
    margin: 0.5rem 0 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .fixture-preview p {
    margin: 0;
  }

  select {
    min-height: 2rem;
    color: #e8edf8;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: #08101f;
  }
</style>
