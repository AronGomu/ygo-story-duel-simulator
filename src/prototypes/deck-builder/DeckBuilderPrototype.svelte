<script lang="ts">
  import { onMount, tick } from "svelte";
  import type {
    DeckCardLists,
    DeckRecord,
  } from "../../decks/deck-contracts.ts";
  import { IndexedDbDeckRepository } from "../../decks/indexeddb-deck-repository.ts";
  import {
    catalogByCode,
    PROTOTYPE_RULESET,
  } from "../../decks/catalog/pinned-ruleset.ts";
  import {
    DeckBuilderController,
    type DeckBuilderState,
  } from "./deck-builder-store.ts";
  import { PROTOTYPE_CATALOG } from "./fixtures/catalog.ts";
  import DeckEditor from "./components/DeckEditor.svelte";
  import DeckLibrary from "./components/DeckLibrary.svelte";
  import PrototypeStateHarness from "./components/PrototypeStateHarness.svelte";
  import YdkExport from "./components/YdkExport.svelte";
  import YdkImport from "./components/YdkImport.svelte";
  import {
    applyPrototypeReviewState,
    type PrototypeReviewState,
  } from "./fixtures/states.ts";

  const catalog = catalogByCode(PROTOTYPE_CATALOG);
  let state: DeckBuilderState = {
    mode: "loading",
    decks: [],
    current: null,
    saveState: "idle",
    message: null,
  };
  let controller: DeckBuilderController | null = null;
  let showLibraryImport = false;
  let libraryExport: DeckRecord | null = null;
  let modalOpener: HTMLElement | null = null;
  let reviewState: PrototypeReviewState = "live";
  $: visibleState = applyPrototypeReviewState(
    state,
    reviewState,
    catalog,
    PROTOTYPE_RULESET,
  );

  onMount(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    let close: () => void = () => undefined;
    void IndexedDbDeckRepository.open()
      .then(async (repository) => {
        if (disposed) {
          repository.close();
          return;
        }
        close = () => repository.close();
        controller = new DeckBuilderController(
          repository,
          catalog,
          PROTOTYPE_RULESET,
        );
        unsubscribe = controller.subscribe((value) => (state = value));
        await controller.initialize();
      })
      .catch((error: unknown) => {
        state = {
          ...state,
          mode: "error",
          message: `Deck Builder could not start: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      });
    return () => {
      disposed = true;
      unsubscribe();
      close();
    };
  });

  function openLibraryModal(
    kind: "import" | "export",
    deck?: DeckRecord,
  ): void {
    modalOpener = document.activeElement as HTMLElement | null;
    if (kind === "import") showLibraryImport = true;
    else libraryExport = deck ?? null;
  }

  async function closeLibraryModal(): Promise<void> {
    showLibraryImport = false;
    libraryExport = null;
    await tick();
    modalOpener?.focus();
    modalOpener = null;
  }

  async function importFromLibrary(
    cards: DeckCardLists,
    name: string,
  ): Promise<boolean> {
    if (controller === null) return false;
    const imported = await controller.importDeck(name, cards);
    if (imported) await closeLibraryModal();
    return imported;
  }
</script>

<svelte:head>
  <title>Deck Builder Prototype · YGO Story Duel Simulator</title>
</svelte:head>

{#if visibleState.mode === "loading"}
  <main class="loading" aria-busy="true">
    <p>Deck Builder prototype</p>
    <h1>Loading local decks…</h1>
    <div class="skeleton"></div>
  </main>
{:else if visibleState.mode === "error"}
  <main class="loading error" role="alert">
    <p>Deck Builder stopped</p>
    <h1>{visibleState.message}</h1>
    <button type="button" onclick={() => location.reload()}>Retry</button>
  </main>
{:else if visibleState.mode === "library"}
  <DeckLibrary
    decks={visibleState.decks}
    message={visibleState.message}
    oncreate={(name) => controller?.createDeck(name)}
    onopen={(id) => void controller?.openDeck(id)}
    onrename={async (deck, name) => {
      await controller?.openDeck(deck.id);
      await controller?.rename(name);
    }}
    onduplicate={(id) => void controller?.duplicate(id)}
    ondelete={(deck) => controller?.deleteDeck(deck.id, deck.revision)}
    onexport={(deck) => openLibraryModal("export", deck)}
    onimport={() => openLibraryModal("import")}
  />
{:else if visibleState.mode === "editor"}
  <DeckEditor
    state={visibleState}
    cards={PROTOTYPE_CATALOG}
    {catalog}
    ruleset={PROTOTYPE_RULESET}
    {reviewState}
    onlibrary={() => void controller?.showLibrary()}
    onrename={(name) => void controller?.rename(name)}
    onmutate={(command) => controller?.mutate(command)}
    onundo={() => void controller?.undo()}
    onredo={() => void controller?.redo()}
    onretrysave={() => void controller?.retrySave()}
    onreload={() => void controller?.reloadCurrent()}
    onpreservecopy={() => void controller?.preserveCurrentAsCopy()}
  />
{/if}

<PrototypeStateHarness
  value={reviewState}
  onchange={(value) => (reviewState = value)}
/>

{#if showLibraryImport}
  <div class="backdrop" aria-hidden="true"></div>
  <YdkImport
    requireName={true}
    catalogCodes={new Set(catalog.keys())}
    existingDeckNames={visibleState.decks.map(({ name }) => name)}
    oncancel={() => void closeLibraryModal()}
    onimport={importFromLibrary}
  />
{/if}

{#if libraryExport}
  <div class="backdrop" aria-hidden="true"></div>
  <YdkExport deck={libraryExport} oncancel={() => void closeLibraryModal()} />
{/if}

<style>
  :global(body) {
    overflow-x: hidden;
  }

  .loading {
    width: min(70rem, calc(100% - 2rem));
    margin: 4rem auto;
  }

  .loading p {
    margin-bottom: 0.25rem;
    color: var(--muted);
  }

  .skeleton {
    height: 28rem;
    margin-top: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: linear-gradient(
      90deg,
      var(--surface),
      var(--surface-strong),
      var(--surface)
    );
    background-size: 200% 100%;
    animation: loading 1.4s linear infinite;
  }

  .error {
    padding: 1rem;
    border: 1px solid #a43b50;
    border-radius: 0.8rem;
    background: #321825;
  }

  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    background: rgb(0 0 0 / 0.68);
  }

  @keyframes loading {
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
</style>
