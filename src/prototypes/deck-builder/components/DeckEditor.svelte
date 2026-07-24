<script lang="ts">
  import { MAXIMUM_DECK_NAME_LENGTH } from "../../../decks/deck-model.ts";
  import type {
    DeckCardLists,
    DeckRecord,
    DeckZone,
  } from "../../../decks/deck-contracts.ts";
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
  import { tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { DeckBuilderState } from "../deck-builder-store.ts";
  import CardCatalog from "./CardCatalog.svelte";
  import CardDetails from "./CardDetails.svelte";
  import DeckWorkspace from "./DeckWorkspace.svelte";
  import type { PickedCard } from "../drag-state.ts";
  import type { PrototypeReviewState } from "../fixtures/states.ts";
  import YdkExport from "./YdkExport.svelte";
  import YdkImport from "./YdkImport.svelte";

  export let state: DeckBuilderState;
  export let cards: readonly DeckBuilderCardView[];
  export let catalog: ReadonlyMap<number, DeckBuilderCardView>;
  export let ruleset: PinnedDeckRuleset;
  export let reviewState: PrototypeReviewState = "live";
  export let onlibrary: () => void;
  export let onrename: (name: string) => void;
  export let onmutate: (
    command: import("../../../decks/deck-model.ts").DeckCommand,
  ) => void | Promise<void>;
  export let onundo: () => void;
  export let onredo: () => void;
  export let onretrysave: () => void;
  export let onreload: () => void;
  export let onpreservecopy: () => void;

  let selected: DeckBuilderCardView | null = null;
  let selectedCode: number | null = null;
  let picked: PickedCard | null = null;
  let announcement = "";
  let showImport = false;
  let showExport = false;
  let modalOpener: HTMLElement | null = null;
  let catalogFixture: "live" | "loading" | "empty" | "error";
  let deckName = state.current?.deck.name ?? "";

  $: deck = state.current?.deck ?? null;
  $: if (
    deck !== null &&
    deck.name !== deckName &&
    document.activeElement?.id !== "deck-name"
  )
    deckName = deck.name;
  $: copies = deck === null ? new Map<number, number>() : countCopies(deck);
  $: catalogFixture =
    reviewState === "catalog-loading"
      ? "loading"
      : reviewState === "catalog-error"
        ? "error"
        : reviewState === "catalog-empty"
          ? "empty"
          : "live";
  $: selectedCopies =
    selectedCode === null || deck === null
      ? { main: 0, extra: 0, side: 0 }
      : {
          main: deck.main.filter((code) => code === selectedCode).length,
          extra: deck.extra.filter((code) => code === selectedCode).length,
          side: deck.side.filter((code) => code === selectedCode).length,
        };

  function countCopies(value: DeckRecord): ReadonlyMap<number, number> {
    const result = new SvelteMap<number, number>();
    for (const code of [...value.main, ...value.extra, ...value.side])
      result.set(code, (result.get(code) ?? 0) + 1);
    return result;
  }

  function selectCard(card: DeckBuilderCardView | null, code: number): void {
    selectedCode = code;
    selected = card ?? catalog.get(code) ?? null;
  }

  function startCatalogDrag(
    card: DeckBuilderCardView,
    event?: DragEvent,
  ): void {
    selected = card;
    selectedCode = card.code;
    picked = { code: card.code, source: "catalog" };
    event?.dataTransfer?.setData("text/plain", String(card.code));
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    announcement = `${card.name} picked up. Drop in ${card.canonicalZone === "main" ? "Main Deck" : "Extra Deck"}.`;
  }

  function startZoneDrag(
    code: number,
    zone: DeckZone,
    event?: DragEvent,
  ): void {
    selected = catalog.get(code) ?? null;
    selectedCode = code;
    picked = { code, source: zone };
    event?.dataTransfer?.setData("text/plain", String(code));
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = "move";
    announcement = `${selected?.name ?? `Card ${code}`} picked up from ${zone}.`;
  }

  function dropInZone(zone: DeckZone): void {
    if (picked === null) return;
    const card = catalog.get(picked.code);
    if (picked.source === "catalog") {
      if (card === undefined || zone !== card.canonicalZone) {
        announcement = `Card cannot be added to ${zone}.`;
        return;
      }
      onmutate({ type: "add", cardCode: picked.code });
    } else if (card === undefined) {
      announcement = `Missing card ${picked.code} can only be removed.`;
      return;
    } else if (picked.source !== zone) {
      onmutate({
        type: "move",
        cardCode: picked.code,
        from: picked.source,
        to: zone,
      });
    }
    announcement = `${card?.name ?? `Card ${picked.code}`} dropped in ${zone}.`;
    picked = null;
  }

  function cancelPicked(): void {
    if (picked === null) return;
    picked = null;
    announcement = "Card movement canceled.";
  }

  function removePicked(): void {
    if (picked === null || picked.source === "catalog") {
      picked = null;
      return;
    }
    const code = picked.code;
    const source = picked.source;
    onmutate({ type: "remove", cardCode: code, zone: source });
    announcement = `${catalog.get(code)?.name ?? `Card ${code}`} removed.`;
    picked = null;
  }

  function openModal(kind: "import" | "export"): void {
    modalOpener = document.activeElement as HTMLElement | null;
    showImport = kind === "import";
    showExport = kind === "export";
  }

  async function closeModal(): Promise<void> {
    showImport = false;
    showExport = false;
    await tick();
    modalOpener?.focus();
    modalOpener = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (showImport || showExport) {
      void closeModal();
      announcement = "Dialog closed.";
    } else if (picked !== null) {
      picked = null;
      announcement = "Card move cancelled.";
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if deck}
  <header class="editor-header">
    <button type="button" class="secondary" onclick={onlibrary}
      >Deck Library</button
    >
    <label class="name-field">
      <span>Deck name</span>
      <input
        id="deck-name"
        bind:value={deckName}
        maxlength={MAXIMUM_DECK_NAME_LENGTH}
        onblur={() => {
          if (deckName.trim() && deckName.trim() !== deck?.name)
            onrename(deckName);
        }}
      />
    </label>
    <dl class="counts" aria-label="Deck counts">
      <div>
        <dt>Main</dt>
        <dd>{deck.main.length}</dd>
      </div>
      <div>
        <dt>Extra</dt>
        <dd>{deck.extra.length}</dd>
      </div>
      <div>
        <dt>Side</dt>
        <dd>{deck.side.length}</dd>
      </div>
    </dl>
    <div class={`status status-${deck.validation.status}`}>
      <span>Deck</span>
      <strong>{deck.validation.status}</strong>
    </div>
    <div class={`status save-${state.saveState}`} aria-live="polite">
      <span>Autosave</span>
      <strong
        >{state.saveState === "saved"
          ? "Saved locally"
          : state.saveState}</strong
      >
    </div>
    <button
      type="button"
      class="secondary"
      disabled={state.current?.history.undo.length === 0}
      onclick={onundo}
      aria-keyshortcuts="Control+Z">Undo</button
    >
    <button
      type="button"
      class="secondary"
      disabled={state.current?.history.redo.length === 0}
      onclick={onredo}
      aria-keyshortcuts="Control+Shift+Z">Redo</button
    >
    <button type="button" class="secondary" onclick={() => openModal("import")}
      >Import</button
    >
    <button type="button" class="secondary" onclick={() => openModal("export")}
      >Export</button
    >
  </header>

  {#if state.saveState === "failed"}
    <section class="message error" role="alert">
      <p>{state.message}</p>
      <button type="button" onclick={onretrysave}>Retry autosave</button>
      <button type="button" class="secondary" onclick={onreload}
        >Reload saved deck</button
      >
    </section>
  {:else if state.saveState === "conflict"}
    <section class="message error" role="alert">
      <p>{state.message}</p>
      <button type="button" onclick={onreload}>Reload newer revision</button>
      <button type="button" class="secondary" onclick={onpreservecopy}
        >Preserve local edits as copy</button
      >
    </section>
  {:else if state.message}
    <p class="message" role="status">{state.message}</p>
  {/if}

  <p
    class="visually-hidden"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {announcement}
  </p>

  <main class="editor-layout" aria-busy={state.saveState === "saving"}>
    <CardCatalog
      {cards}
      {ruleset}
      fixtureState={catalogFixture}
      {selectedCode}
      {copies}
      onselect={(card) => {
        selected = card;
        selectedCode = card.code;
      }}
      ondragcard={(card, event) => startCatalogDrag(card, event)}
      ondragcancel={cancelPicked}
      onpickup={(card) => startCatalogDrag(card)}
      onblocked={(card, reason) => {
        selected = card;
        selectedCode = card.code;
        announcement = `${card.name}: ${reason}`;
      }}
    />
    <DeckWorkspace
      {deck}
      {catalog}
      {ruleset}
      {selectedCode}
      {picked}
      onselect={selectCard}
      ondragcard={(code, zone, event) => startZoneDrag(code, zone, event)}
      ondragcancel={cancelPicked}
      onpickup={(code, zone) => startZoneDrag(code, zone)}
      ondropzone={dropInZone}
      onremove={removePicked}
    />
    <CardDetails
      card={selected}
      missingCode={selected === null ? selectedCode : null}
      copies={selectedCopies}
      {ruleset}
    />
  </main>

  <div class="desktop-required" role="note">
    <h2>Desktop viewport required</h2>
    <p>Deck Builder prototype targets screens at least 1024 px wide.</p>
    <button type="button" class="secondary" onclick={onlibrary}
      >Return to Deck Library</button
    >
  </div>

  {#if showImport}
    <div class="backdrop" aria-hidden="true"></div>
    <YdkImport
      catalogCodes={new Set(catalog.keys())}
      oncancel={() => void closeModal()}
      onimport={async (cards: DeckCardLists) => {
        await onmutate({ type: "import", cards });
        await closeModal();
        return true;
      }}
    />
  {/if}
  {#if showExport}
    <div class="backdrop" aria-hidden="true"></div>
    <YdkExport {deck} oncancel={() => void closeModal()} />
  {/if}
{/if}

<style>
  .editor-header {
    display: grid;
    grid-template-columns:
      auto minmax(12rem, 1fr)
      auto auto auto auto auto auto auto;
    align-items: end;
    gap: 0.55rem;
    width: min(118rem, calc(100% - 1.5rem));
    margin-inline: auto;
    padding-block: 0.75rem;
  }

  .editor-header button {
    min-height: 2.45rem;
    padding: 0.45rem 0.65rem;
  }

  .name-field {
    display: grid;
    gap: 0.2rem;
  }

  .name-field span,
  .status span,
  dt {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .name-field input {
    min-height: 2.45rem;
    padding: 0.45rem 0.6rem;
    color: #e8edf8;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: #0d1729;
    font-weight: 750;
  }

  .counts {
    display: flex;
    gap: 0.35rem;
    margin: 0;
  }

  .counts div,
  .status {
    min-width: 3.2rem;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--surface);
  }

  dd {
    margin: 0;
    font-weight: 800;
  }

  .status {
    display: grid;
  }

  .status-errors,
  .save-failed,
  .save-conflict {
    border-color: #a43b50;
  }

  .status-warnings,
  .save-saving {
    border-color: #896b28;
  }

  .editor-layout {
    display: grid;
    grid-template-columns: minmax(17rem, 0.82fr) minmax(38rem, 1.9fr) minmax(
        18rem,
        0.9fr
      );
    gap: 0.75rem;
    width: min(118rem, calc(100% - 1.5rem));
    margin-inline: auto;
    padding-bottom: 0.75rem;
  }

  .message {
    width: min(118rem, calc(100% - 1.5rem));
    margin: 0 auto 0.6rem;
    padding: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
  }

  .message.error {
    border-color: #a43b50;
    background: #321825;
  }

  .message p {
    margin: 0 0 0.5rem;
  }

  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    background: rgb(0 0 0 / 0.68);
  }

  .desktop-required {
    display: none;
    width: min(34rem, calc(100% - 2rem));
    margin: 4rem auto;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 0.7rem;
    background: var(--surface);
    text-align: center;
  }

  @media (max-width: 1023px) {
    .editor-header,
    .editor-layout,
    .message {
      display: none;
    }

    .desktop-required {
      display: block;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
</style>
