<script lang="ts">
  import { tick } from "svelte";
  import { handleModalKeydown } from "../focus-trap.ts";
  import type { DeckId, DeckRecord } from "../../../decks/deck-contracts.ts";
  import { MAXIMUM_DECK_NAME_LENGTH } from "../../../decks/deck-model.ts";

  export let decks: readonly DeckRecord[];
  export let message: string | null = null;
  export let oncreate: (name: string) => unknown | Promise<unknown>;
  export let onopen: (id: DeckId) => unknown | Promise<unknown>;
  export let onrename: (
    deck: DeckRecord,
    name: string,
  ) => unknown | Promise<unknown>;
  export let onduplicate: (id: DeckId) => unknown | Promise<unknown>;
  export let ondelete: (deck: DeckRecord) => unknown | Promise<unknown>;
  export let onexport: (deck: DeckRecord) => void;
  export let onimport: () => void;

  let search = "";
  let sort: "modified" | "name" = "modified";
  let creating = false;
  let createName = "";
  let renaming: DeckRecord | null = null;
  let renameName = "";
  let deleting: DeckRecord | null = null;
  let dialogHeading: HTMLHeadingElement;
  let dialogInput: HTMLInputElement;
  let dialogOpener: HTMLElement | null = null;
  let dialogBusy = false;

  $: createNameDuplicate = decks.some(
    (deck) =>
      createName.trim().length > 0 &&
      deck.name.toLocaleLowerCase() === createName.trim().toLocaleLowerCase(),
  );
  $: renameNameDuplicate = decks.some(
    (deck) =>
      renaming !== null &&
      deck.id !== renaming.id &&
      renameName.trim().length > 0 &&
      deck.name.toLocaleLowerCase() === renameName.trim().toLocaleLowerCase(),
  );
  $: filtered = decks
    .filter((deck) =>
      deck.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    )
    .sort((left, right) =>
      sort === "name"
        ? left.name.localeCompare(right.name)
        : right.updatedAt.localeCompare(left.updatedAt),
    );

  async function focusDialog(): Promise<void> {
    dialogOpener = document.activeElement as HTMLElement | null;
    await tick();
    if (creating || renaming !== null) dialogInput?.focus();
    else dialogHeading?.focus();
  }

  async function submitCreate(): Promise<void> {
    if (dialogBusy || createName.trim().length === 0) return;
    dialogBusy = true;
    try {
      await oncreate(createName);
      await closeDialog(() => (creating = false));
    } finally {
      dialogBusy = false;
    }
  }

  async function submitRename(): Promise<void> {
    if (dialogBusy || renaming === null || renameName.trim().length === 0)
      return;
    dialogBusy = true;
    try {
      await onrename(renaming, renameName);
      await closeDialog(() => (renaming = null));
    } finally {
      dialogBusy = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (dialogBusy || deleting === null) return;
    dialogBusy = true;
    try {
      await ondelete(deleting);
      await closeDialog(() => (deleting = null));
    } finally {
      dialogBusy = false;
    }
  }

  async function closeDialog(close: () => void): Promise<void> {
    close();
    await tick();
    dialogOpener?.focus();
    dialogOpener = null;
  }
</script>

<section class="library" aria-labelledby="deck-library-heading">
  <header>
    <div>
      <p>Local decks</p>
      <h1 id="deck-library-heading">Deck Library</h1>
      <span
        >Visual Novel chooses a deck ID. This module stores and resolves decks.</span
      >
    </div>
    <div class="actions">
      <button type="button" class="secondary" onclick={onimport}
        >Import YDK</button
      >
      <button
        type="button"
        onclick={() => {
          creating = true;
          createName = "";
          void focusDialog();
        }}>Create deck</button
      >
    </div>
  </header>

  {#if message}<p class="message" role="status">{message}</p>{/if}

  <div class="tools">
    <label>
      <span>Search decks</span>
      <input type="search" bind:value={search} placeholder="Deck name" />
    </label>
    <label>
      <span>Sort</span>
      <select bind:value={sort}>
        <option value="modified">Last modified</option>
        <option value="name">Name</option>
      </select>
    </label>
  </div>

  {#if decks.length === 0}
    <div class="empty">
      <h2>No local decks</h2>
      <p>Create a blank deck or import YDK text.</p>
      <button
        type="button"
        onclick={() => {
          creating = true;
          void focusDialog();
        }}>Create blank deck</button
      >
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      <h2>No matching decks</h2>
      <button type="button" class="secondary" onclick={() => (search = "")}
        >Clear search</button
      >
    </div>
  {:else}
    <ul class="deck-list">
      {#each filtered as deck (deck.id)}
        <li>
          <button
            type="button"
            class="deck-open"
            onclick={() => onopen(deck.id)}
          >
            <strong>{deck.name}</strong>
            <span
              >Main {deck.main.length} · Extra {deck.extra.length} · Side {deck
                .side.length}</span
            >
            <span class:error={deck.validation.status === "errors"}
              >{deck.validation.status}</span
            >
            <small>Updated {new Date(deck.updatedAt).toLocaleString()}</small>
          </button>
          <div class="row-actions">
            <button
              type="button"
              class="secondary"
              onclick={() => {
                renaming = deck;
                renameName = deck.name;
                void focusDialog();
              }}>Rename</button
            >
            <button
              type="button"
              class="secondary"
              onclick={() => onduplicate(deck.id)}>Duplicate</button
            >
            <button
              type="button"
              class="secondary"
              onclick={() => onexport(deck)}>Export</button
            >
            <button
              type="button"
              class="danger"
              onclick={() => {
                deleting = deck;
                void focusDialog();
              }}>Delete</button
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if creating}
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="create-heading"
    onkeydown={(event) =>
      handleModalKeydown(
        event,
        () => void closeDialog(() => (creating = false)),
      )}
  >
    <h2 id="create-heading" tabindex="-1" bind:this={dialogHeading}>
      Create blank deck
    </h2>
    <form
      aria-busy={dialogBusy}
      onsubmit={(event) => {
        event.preventDefault();
        void submitCreate();
      }}
    >
      <label
        ><span>Deck name</span><input
          bind:this={dialogInput}
          bind:value={createName}
          maxlength={MAXIMUM_DECK_NAME_LENGTH}
        /></label
      >
      {#if createNameDuplicate}
        <p class="name-warning" role="status">
          Another deck already uses this name. IDs remain independent.
        </p>
      {/if}
      <div class="actions">
        <small>Enter to create · Esc to cancel</small>
        <button
          type="button"
          class="secondary"
          disabled={dialogBusy}
          onclick={() => void closeDialog(() => (creating = false))}
          >Cancel</button
        >
        <button
          type="submit"
          disabled={dialogBusy || createName.trim().length === 0}
          >{dialogBusy ? "Creating…" : "Create"}</button
        >
      </div>
    </form>
  </div>
{/if}

{#if renaming}
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="rename-heading"
    onkeydown={(event) =>
      handleModalKeydown(
        event,
        () => void closeDialog(() => (renaming = null)),
      )}
  >
    <h2 id="rename-heading" tabindex="-1" bind:this={dialogHeading}>
      Rename {renaming.name}
    </h2>
    <form
      aria-busy={dialogBusy}
      onsubmit={(event) => {
        event.preventDefault();
        void submitRename();
      }}
    >
      <label
        ><span>Deck name</span><input
          bind:this={dialogInput}
          bind:value={renameName}
          maxlength={MAXIMUM_DECK_NAME_LENGTH}
        /></label
      >
      {#if renameNameDuplicate}
        <p class="name-warning" role="status">
          Another deck already uses this name. IDs remain independent.
        </p>
      {/if}
      <div class="actions">
        <small>Enter to rename · Esc to cancel</small>
        <button
          type="button"
          class="secondary"
          disabled={dialogBusy}
          onclick={() => void closeDialog(() => (renaming = null))}
          >Cancel</button
        >
        <button
          type="submit"
          disabled={dialogBusy || renameName.trim().length === 0}
          >{dialogBusy ? "Renaming…" : "Rename"}</button
        >
      </div>
    </form>
  </div>
{/if}

{#if deleting}
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-busy={dialogBusy}
    aria-labelledby="delete-heading"
    onkeydown={(event) =>
      handleModalKeydown(
        event,
        () => void closeDialog(() => (deleting = null)),
      )}
  >
    <h2 id="delete-heading" tabindex="-1" bind:this={dialogHeading}>
      Delete {deleting.name}?
    </h2>
    <p>Local deck and retained history will be removed.</p>
    <div class="actions">
      <button
        type="button"
        class="secondary"
        disabled={dialogBusy}
        onclick={() => void closeDialog(() => (deleting = null))}>Cancel</button
      >
      <button
        type="button"
        class="danger"
        disabled={dialogBusy}
        onclick={() => void confirmDelete()}
        >{dialogBusy ? "Deleting…" : `Delete ${deleting.name}`}</button
      >
    </div>
  </div>
{/if}

<style>
  .library {
    width: min(78rem, calc(100% - 2rem));
    margin-inline: auto;
    padding-block: 2rem;
  }

  header,
  .tools,
  .actions,
  .row-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  header p,
  header span,
  label span,
  .deck-open span,
  .deck-open small {
    color: var(--muted);
  }

  header p {
    margin-bottom: 0.25rem;
    font-size: 0.78rem;
    font-weight: 750;
  }

  .tools {
    margin-block: 1.5rem 1rem;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  input,
  select {
    min-height: 2.5rem;
    padding: 0.5rem 0.65rem;
    color: #e8edf8;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: #0d1729;
  }

  .deck-list {
    display: grid;
    gap: 0.7rem;
    padding: 0;
    list-style: none;
  }

  .deck-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    background: var(--surface);
  }

  .deck-open {
    display: grid;
    min-width: 0;
    color: #e8edf8;
    background: transparent;
    text-align: left;
  }

  .deck-open:hover {
    background: #18243b;
  }

  .deck-open .error {
    color: var(--danger);
  }

  .row-actions button {
    min-height: 2.2rem;
    padding: 0.4rem 0.6rem;
  }

  .empty,
  .message {
    padding: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 0.7rem;
    background: var(--surface);
    text-align: center;
  }

  .dialog {
    position: fixed;
    z-index: 30;
    inset: 50% auto auto 50%;
    width: min(30rem, calc(100vw - 3rem));
    padding: 1rem;
    transform: translate(-50%, -50%);
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: #111b2f;
    box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 0.55);
  }

  .dialog label {
    margin-bottom: 1rem;
  }

  .dialog input {
    width: 100%;
  }

  .name-warning {
    color: var(--warning);
    font-size: 0.8rem;
  }
</style>
