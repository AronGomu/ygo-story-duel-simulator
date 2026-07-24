<script lang="ts">
  import { tick } from "svelte";
  import { trapTabWithin } from "../overlays/focus-trap.ts";

  export let showCorrupt = false;
  export let onload: (slot: "manual" | "autosave") => void = () => undefined;
  export let ondelete: () => boolean = () => true;
  export let onconfirmchange: (open: boolean) => void = () => undefined;
  export let onback: () => void = () => undefined;
  let confirmingDelete = false;
  let manualDeleted = false;
  let deleteTrigger: HTMLButtonElement;
  let cancelDelete: HTMLButtonElement;
  let deleteDialog: HTMLDivElement;

  async function openDelete(): Promise<void> {
    confirmingDelete = true;
    onconfirmchange(true);
    await tick();
    cancelDelete.focus();
  }
  async function closeDelete(): Promise<void> {
    confirmingDelete = false;
    onconfirmchange(false);
    await tick();
    deleteTrigger.focus();
  }
  function confirmDelete(): void {
    if (ondelete()) manualDeleted = true;
    confirmingDelete = false;
    onconfirmchange(false);
  }
  function handleDeleteKeydown(event: KeyboardEvent): void {
    if (!confirmingDelete) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void closeDelete();
      return;
    }
    trapTabWithin(deleteDialog, event);
  }
</script>

<svelte:window onkeydown={handleDeleteKeydown} />

<section
  class="screen load-screen"
  aria-labelledby="load-heading"
  inert={confirmingDelete}
>
  <header>
    <p class="eyebrow">Mock local progress</p>
    <h1 id="load-heading">Load</h1>
  </header>
  <div class="slots">
    {#if manualDeleted}
      <article class="empty">
        <h2>Manual slot 1 · Empty</h2>
        <p>Save deleted for this review session.</p>
        <button type="button" disabled>Load manual slot 1</button>
      </article>
    {:else}
      <article>
        <div
          class="slot-preview"
          role="img"
          aria-label="Old Arena save preview"
        >
          Old Arena preview
        </div>
        <h2>Manual slot 1</h2>
        <p>Chapter 1 · Old Arena</p>
        <p>Playtime 00:18:42 · Yesterday, 21:14</p>
        <div class="actions">
          <button type="button" onclick={() => onload("manual")}
            >Load manual slot 1</button
          ><button
            type="button"
            class="secondary"
            bind:this={deleteTrigger}
            onclick={() => void openDelete()}>Delete manual slot 1</button
          >
        </div>
      </article>
    {/if}
    <article>
      <div
        class="slot-preview"
        role="img"
        aria-label="Concourse autosave preview"
      >
        Concourse preview
      </div>
      <h2>Autosave</h2>
      <p>Chapter 1 · City Map</p>
      <p>Playtime 00:21:08 · Today, 00:04</p>
      <button type="button" onclick={() => onload("autosave")}
        >Load autosave</button
      >
    </article>
    <article class="empty">
      <h2>Empty slot</h2>
      <p>No manual save yet.</p>
      <button type="button" disabled>Load empty slot</button>
    </article>
    {#if showCorrupt}<article class="error">
        <h2>Reviewer example</h2>
        <p>Save is incompatible or corrupt. Reset this mock slot.</p>
        <button type="button" class="secondary">Reset corrupt example</button>
      </article>{/if}
  </div>
  <button type="button" class="secondary" onclick={onback}>Back</button>
</section>

{#if confirmingDelete}
  <div class="dialog-backdrop">
    <div
      role="alertdialog"
      aria-labelledby="delete-heading"
      class="dialog"
      tabindex="-1"
      bind:this={deleteDialog}
    >
      <h2 id="delete-heading">Delete save?</h2>
      <p>This mock manual slot will become empty.</p>
      <div class="actions">
        <button type="button" class="danger" onclick={confirmDelete}
          >Delete save</button
        ><button
          type="button"
          class="secondary"
          bind:this={cancelDelete}
          onclick={() => void closeDelete()}>Cancel delete</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .load-screen {
    padding: clamp(1rem, 4vw, 3rem);
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    gap: 1rem;
    margin-block: 1rem;
  }
  article {
    padding: 1rem;
    border: 1px solid var(--prototype-border);
    border-radius: 0.75rem;
    background: var(--prototype-panel);
  }
  .slot-preview {
    min-height: 6rem;
    display: grid;
    place-items: center;
    border-radius: 0.4rem;
    background: linear-gradient(135deg, #234a63, #101724);
    color: var(--prototype-muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .empty {
    opacity: 0.8;
  }
  .error {
    border-color: #f5a3a3;
  }
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: #000b;
  }
  .dialog {
    width: min(30rem, 100%);
    padding: 1.5rem;
    border: 1px solid var(--prototype-border);
    border-radius: 0.75rem;
    background: var(--prototype-panel);
  }
  .danger {
    background: #d85d6a;
    border-color: #ff9ba5;
    color: #fff;
  }
</style>
