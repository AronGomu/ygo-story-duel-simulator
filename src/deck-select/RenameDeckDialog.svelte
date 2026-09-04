<script lang="ts">
  import { onMount } from "svelte";
  import { handleModalKeydown } from "./focus-trap.ts";

  export let deckName: string;
  export let maxLength = 64;
  export let unavailableNames: readonly string[] = [];
  export let oncancel: () => void = () => undefined;
  export let onsubmit: (name: string) => void = () => undefined;

  let name = deckName;
  let field: HTMLInputElement;

  onMount(() => {
    field.focus();
    field.select();
  });

  /* The trimmed name is both what the host receives and what decides whether
     there is anything to send, so it is derived once. */
  $: trimmed = name.trim();
  $: duplicateName = unavailableNames.includes(trimmed);

  function submit(): void {
    if (trimmed.length === 0 || duplicateName) return;
    onsubmit(trimmed);
  }
</script>

<div
  class="dialog"
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-labelledby="deck-select-rename-heading"
  data-cy="deck-select-rename-dialog"
  onkeydown={(event) => handleModalKeydown(event, oncancel)}
>
  <h2 id="deck-select-rename-heading" data-cy="deck-select-rename-heading">
    Rename deck
  </h2>
  <form
    data-cy="deck-select-rename-form"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <label data-cy="deck-select-rename-field"
      ><span data-cy="deck-select-rename-label">Deck name</span><input
        data-cy="deck-select-rename-input"
        aria-invalid={duplicateName ? "true" : undefined}
        aria-describedby={duplicateName
          ? "deck-select-rename-error"
          : undefined}
        bind:this={field}
        bind:value={name}
        maxlength={maxLength}
      /></label
    >
    {#if duplicateName}
      <p
        id="deck-select-rename-error"
        role="alert"
        data-cy="deck-select-rename-error"
      >
        A deck with this name already exists.
      </p>
    {/if}
    <div class="actions" data-cy="deck-select-rename-actions">
      <button
        type="button"
        class="secondary"
        data-cy="deck-select-rename-cancel"
        onclick={oncancel}>Cancel</button
      >
      <button
        type="submit"
        disabled={trimmed.length === 0 || duplicateName}
        data-cy="deck-select-rename-submit">Rename</button
      >
    </div>
  </form>
</div>

<style>
  .dialog {
    position: fixed;
    z-index: 30;
    inset: 50% auto auto 50%;
    width: min(22rem, 92vw);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    transform: translate(-50%, -50%);
  }

  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  label {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  input {
    width: 100%;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
