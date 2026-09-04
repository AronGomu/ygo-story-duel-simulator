<script lang="ts">
  import { afterUpdate, getContext, onMount, tick } from "svelte";
  import { get, readable, type Readable } from "svelte/store";
  import {
    computeStageBox,
    STAGE_CONTEXT_KEY,
    type StageBox,
  } from "../shell/index.ts";
  import { selectEditorLayoutMode } from "./layout/editor-layout.ts";
  import type {
    DeckCardLists,
    DeckId,
    DeckRecord,
  } from "../decks/deck-contracts.ts";
  import { DeckMigrationError } from "../decks/index.ts";
  import {
    resolveDeckRepository,
    type DeckContext,
  } from "../decks/deck-repository-context.ts";
  import {
    unlimitedCardOwnership,
    type CardOwnership,
  } from "../decks/card-ownership.ts";
  import { ownedCatalog } from "./catalog-availability.ts";
  import { ensureStarterDeck } from "../decks/starter-deck.ts";
  import {
    catalogByCode,
    PROTOTYPE_RULESET,
  } from "../decks/catalog/pinned-ruleset.ts";
  import {
    DeckBuilderController,
    type DeckBuilderState,
  } from "./deck-editor-store.ts";
  import type { DeckEditorRoute } from "./deck-editor-route.ts";
  import { runtimeCatalog } from "../decks/catalog/runtime-catalog.ts";
  import { deckBuildableCards } from "../decks/catalog/deck-buildable-cards.ts";
  import type { DeckBuilderCardView } from "../decks/catalog/ocg-card-mapper.ts";
  import DeckEditor from "./components/DeckEditor.svelte";
  import DeckLibrary from "./components/DeckLibrary.svelte";
  import YdkExport from "./components/YdkExport.svelte";
  import YdkImport from "./components/YdkImport.svelte";

  /** Which deck the app route asks for; `null` is the context's library. */
  export let deckId: DeckId | null = null;
  /** Which of the two deck worlds this mount edits: the free-play library, or
      the decks a story save owns. The shell resolves it from the route, and
      every repository, ownership reader and banner below follows from it.

      Defaulted rather than required so a harness that mounts the domain alone
      still opens the library a player would see; the shell always says. */
  export let context: DeckContext = { kind: "free-play" };
  /* The route is a controlled prop: the domain never writes the URL itself, it
     reports where it wants to go and waits for the shell to echo the new
     `deckId` back. A host that swallows the callback keeps the library. */
  export let onnavigate: (route: DeckEditorRoute) => void = () => undefined;
  /* Leaving the editor for the collection, reported for the same reason: the
     collection is a route of the shell's, in the same two worlds this editor
     binds, and `DeckEditorRoute` names a deck rather than a destination. A host
     that swallows this keeps the library, so the button is inert rather than
     wrong wherever the domain is mounted alone. */
  export let oncollection: () => void = () => undefined;
  /* Leaving the deck menu altogether. The library screen has a Back of its
     own, and where Back goes is the host's to say for the same reason the
     collection is: this domain does not own the URL. A host that swallows it
     keeps the library, so Back is inert rather than wrong. */
  export let onexit: () => void = () => undefined;
  /* The shell owns route identity; the editor only receives presentation copy
     and an action for leaving an open deck. */
  export let returnLabel = "Deck Selection";
  export let onreturn: () => void = () => undefined;

  /* Every card this build packages, fetched once per page: the editor may only
     offer what the duel can draw, so both await the same read. It is ~10 MB of
     shards, which is why it arrives after mount rather than inside the bundle,
     and why nothing below may render until it lands.

     `cards` is what the catalog offers: it drops the Tokens no deck may hold,
     then narrows to what this context owns. `catalog` keeps every card,
     because a deck holding one the save no longer owns still has to name it in
     the preview and in its validation errors. */
  let buildableCards: readonly DeckBuilderCardView[] = [];
  let ownership: CardOwnership = unlimitedCardOwnership();
  $: cards = ownedCatalog(buildableCards, ownership);
  let catalog: ReadonlyMap<number, DeckBuilderCardView> = new Map();
  let catalogReady = false;
  /* The shell is the only surface that measures the viewport: the editor reads
     the published stage once here and passes the resulting layout mode down,
     so no component below reads the stage a second time. The fallback keeps a
     harness that mounts the domain without the shell on the desktop layout. */
  const stage: Readable<StageBox> =
    getContext<Readable<StageBox> | undefined>(STAGE_CONTEXT_KEY) ??
    readable(computeStageBox(globalThis.innerWidth, globalThis.innerHeight));
  $: layoutMode = selectEditorLayoutMode($stage.mode);
  let state: DeckBuilderState = {
    mode: "loading",
    decks: [],
    current: null,
    saveState: "idle",
    message: null,
    defaultDeckId: null,
  };
  let controller: DeckBuilderController | null = null;
  let showLibraryImport = false;
  let libraryExport: DeckRecord | null = null;
  let modalOpener: HTMLElement | null = null;
  /* Storage boots into whichever deck was last opened, so the first paint
     stays on the loading skeleton until the requested route has been applied
     and a deep link can never flash the wrong deck. */
  let routeApplied = false;
  let appliedDeckId: DeckId | null = null;
  let notFound: DeckId | null = null;
  let routing = false;
  /* A failed migration is not a failed load: the decks still exist, in the
     database the migration refused to delete. Nothing may be edited until the
     copy completes, or a second editor session would write into the database
     the next attempt is about to overwrite. */
  let migrationError: DeckMigrationError | null = null;
  /* Applying the route reads IndexedDB, so it is watched here rather than
     from a reactive statement: `routing` keeps one application in flight and
     the tail re-checks a `deckId` that moved while storage was answering. */
  afterUpdate(() => void watchRoute());

  async function watchRoute(): Promise<void> {
    if (controller === null || routing) return;
    if (routeApplied && deckId === appliedDeckId) return;
    routing = true;
    try {
      await applyRoute(deckId);
    } finally {
      routing = false;
    }
    await watchRoute();
  }

  onMount(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    let close: () => void = () => undefined;
    /* Before storage opens: seeding the starter deck resolves codes against the
       catalog, so a repository opened first would only wait on it anyway. */
    void runtimeCatalog()
      .then(async (loaded) => {
        buildableCards = deckBuildableCards(loaded);
        catalog = catalogByCode(loaded);
        catalogReady = true;
        return resolveDeckRepository(context);
      })
      .then(async ({ repository, ownership: resolved, close: release }) => {
        if (disposed) {
          release();
          return;
        }
        close = release;
        /* Before the controller, so the first mutation it accepts is already
           held to what this context owns. Nothing below renders until the
           controller exists, so the catalog is never painted unnarrowed. */
        ownership = resolved;
        /* Free play only, and before the controller reads storage, so a player
           arriving with no decks sees the starter deck rather than an empty
           library. It never throws, so a seeding failure cannot keep the editor
           from opening.

           A story save is not seeded: seeding grants a deck and no cards, so a
           save would get forty cards it does not own — badged `not-owned` and
           refused at pre-battle (ADR-050). The story's one grant path is
           `new-game`, which hands over the deck and the collection behind it
           together. Granting here instead would be a fountain: delete the deck,
           reopen the editor, receive the cards again. */
        if (context.kind === "free-play")
          await ensureStarterDeck(repository, catalog, PROTOTYPE_RULESET);
        controller = new DeckBuilderController(
          repository,
          catalog,
          PROTOTYPE_RULESET,
          ownership,
        );
        unsubscribe = controller.subscribe((value) => (state = value));
        await controller.initialize();
      })
      .catch((error: unknown) => {
        if (error instanceof DeckMigrationError) {
          migrationError = error;
          return;
        }
        state = {
          ...state,
          mode: "error",
          message: `Deck Editor could not start: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      });
    return () => {
      disposed = true;
      unsubscribe();
      close();
    };
  });

  async function applyRoute(id: DeckId | null): Promise<void> {
    const active = controller;
    if (active === null) return;
    appliedDeckId = id;
    notFound = null;
    if (id === null) await active.showLibrary();
    else if (get(active).current?.deck.id !== id) {
      await active.openDeck(id);
      /* A later route won the race, so this one no longer owns the view. */
      if (appliedDeckId !== id) return;
      if (get(active).current?.deck.id !== id) notFound = id;
    }
    routeApplied = true;
  }

  /** Every controller action that can change which deck is open runs through
      here, so the route always follows the controller rather than drifting
      from it. `showLibrary` refuses to abandon unsaved edits, and a refusal
      leaves the deck open — `syncRoute` then correctly keeps the URL on it. */
  async function runAndSync(
    action: Promise<unknown> | undefined,
  ): Promise<void> {
    await action;
    syncRoute();
  }

  /** Creating, importing and duplicating open their deck inside the
      controller, so the route has to catch up with what is already shown. */
  function syncRoute(): void {
    const settled = controller === null ? null : get(controller);
    const open =
      settled?.mode === "editor" ? (settled.current?.deck.id ?? null) : null;
    if (open === appliedDeckId) return;
    appliedDeckId = open;
    notFound = null;
    onnavigate({ deckId: open });
  }

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
    if (imported) {
      await closeLibraryModal();
      syncRoute();
    }
    return imported;
  }
</script>

<svelte:head>
  <title>Deck Editor · YGO Story Duel Simulator</title>
</svelte:head>

<div
  class="deck-editor-app"
  class:has-context={context.kind === "story"}
  data-cy="deck-editor-app"
>
  {#if context.kind === "story"}
    <!-- Story decks belong to one save, so that context stays visible. Free play
       is already named by its route and keeps no redundant banner row. -->
    <p class="context-banner" data-cy="deck-editor-context-banner">
      Story save: {context.label}
    </p>
  {/if}

  {#if migrationError !== null}
    <main class="loading error" role="alert" data-cy="deck-migration-error">
      <p data-cy="deck-migration-error-eyebrow">Deck Editor stopped</p>
      <h1 data-cy="deck-migration-error-heading">Your decks were not moved</h1>
      <p data-cy="deck-migration-error-message">
        {migrationError.message}
      </p>
      <p data-cy="deck-migration-error-reassurance">
        Nothing was deleted. Close any other tab running this app and try again.
      </p>
      <button
        type="button"
        data-cy="deck-migration-retry"
        onclick={() => location.reload()}>Retry</button
      >
    </main>
  {:else if state.mode === "error"}
    <main class="loading error" role="alert" data-cy="deck-editor-error">
      <p data-cy="deck-editor-error-eyebrow">Deck Editor stopped</p>
      <h1 data-cy="deck-editor-error-message">{state.message}</h1>
      <button
        type="button"
        data-cy="deck-editor-error-retry"
        onclick={() => location.reload()}>Retry</button
      >
    </main>
  {:else if notFound !== null}
    <main class="loading" data-cy="deck-not-found">
      <p data-cy="deck-not-found-eyebrow">Deck Editor</p>
      <h1 data-cy="deck-not-found-heading">Deck not found</h1>
      <p data-cy="deck-not-found-message">
        No local deck is stored under “{notFound}”.
      </p>
      <!-- Reported rather than linked: the domain does not own the URL, and a
         hardcoded `#/decks` sent a player editing a story save back into the
         free-play library. -->
      <button
        type="button"
        class="secondary"
        data-cy="deck-not-found-back"
        onclick={() => onnavigate({ deckId: null })}
        >Back to Deck Library</button
      >
    </main>
  {:else if !catalogReady || !routeApplied || state.mode === "loading"}
    <main class="loading" aria-busy="true" data-cy="deck-editor-loading">
      <p data-cy="deck-editor-loading-eyebrow">Deck Editor</p>
      <h1 data-cy="deck-editor-loading-heading">Loading local decks…</h1>
      <div class="skeleton" data-cy="deck-editor-loading-skeleton"></div>
    </main>
  {:else if deckId === null}
    <DeckLibrary
      decks={state.decks}
      {catalog}
      message={state.message}
      oncreate={(name) => runAndSync(controller?.createDeck(name))}
      onopen={(id) => onnavigate({ deckId: id })}
      onimport={() => openLibraryModal("import")}
      {oncollection}
      onback={onexit}
      defaultDeckId={state.defaultDeckId}
      onsetdefault={(id) => void controller?.setDefaultDeck(id)}
      onrename={(id, name) => void controller?.renameDeck(id, name)}
      onduplicate={(id) => void controller?.duplicate(id)}
      ondelete={(id, revision) => void controller?.deleteDeck(id, revision)}
    />
  {:else if state.current !== null && state.current.deck.id === deckId}
    <DeckEditor
      {state}
      {cards}
      {catalog}
      ruleset={PROTOTYPE_RULESET}
      {ownership}
      {layoutMode}
      {returnLabel}
      {onreturn}
      onrename={(name) => void controller?.rename(name)}
      onmutate={(command) =>
        controller?.mutate(command) ?? Promise.resolve(false)}
      onsetillustration={(code) => controller?.setIllustration(code)}
      onundo={() => void controller?.undo()}
      onredo={() => void controller?.redo()}
      onretrysave={() => void controller?.retrySave()}
      onreload={() => void controller?.reloadCurrent()}
      onpreservecopy={() =>
        void runAndSync(controller?.preserveCurrentAsCopy())}
      onlistautosaves={() => controller?.listAutosaves() ?? Promise.resolve([])}
      onrestoreautosave={(entry) =>
        void runAndSync(controller?.restoreAutosave(entry))}
      onopendeckbyid={(id) => onnavigate({ deckId: id })}
      defaultDeckId={state.defaultDeckId}
      onduplicate={() => void runAndSync(controller?.duplicate(deckId!))}
      onexport={() => {
        if (state.current !== null)
          openLibraryModal("export", state.current.deck);
      }}
      onsetdefault={() => void controller?.setDefaultDeck(deckId!)}
      ondelete={() => {
        const deck = state.current?.deck;
        if (deck === undefined) return;
        /* A delete that failed leaves the deck where it is, so the route stays
         on it: navigating away would report a deck as gone that still exists,
         and hide the failure the editor is showing. */
        void controller?.deleteDeck(deck.id, deck.revision).then((deleted) => {
          if (deleted) onnavigate({ deckId: null });
        });
      }}
    />
  {:else}
    <main class="loading" aria-busy="true" data-cy="deck-editor-opening">
      <p data-cy="deck-editor-opening-eyebrow">Deck Editor</p>
      <h1 data-cy="deck-editor-opening-heading">Opening deck…</h1>
      <div class="skeleton" data-cy="deck-editor-opening-skeleton"></div>
    </main>
  {/if}

  {#if showLibraryImport}
    <div
      class="backdrop"
      aria-hidden="true"
      data-cy="deck-library-import-backdrop"
    ></div>
    <YdkImport
      requireName={true}
      catalogCodes={new Set(catalog.keys())}
      existingDeckNames={state.decks.map(({ name }) => name)}
      oncancel={() => void closeLibraryModal()}
      onimport={importFromLibrary}
    />
  {/if}

  {#if libraryExport}
    <div
      class="backdrop"
      aria-hidden="true"
      data-cy="deck-library-export-backdrop"
    ></div>
    <YdkExport deck={libraryExport} oncancel={() => void closeLibraryModal()} />
  {/if}
</div>

<style>
  :global(body) {
    overflow-x: hidden;
  }

  .deck-editor-app {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }

  .deck-editor-app.has-context {
    grid-template-rows: auto minmax(0, 1fr);
  }

  /* A fixed 1.5rem: story screens reserve exactly this row; free play renders
     neither the banner nor its space. */
  .context-banner {
    display: flex;
    align-items: center;
    min-height: 1.5rem;
    margin: 0;
    padding-inline: 0.5rem;
    color: var(--muted);
    font-size: 0.72rem;
  }

  :global(.library) {
    height: 100%;
    min-height: 0;
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
    border: 1px solid var(--danger-border);
    border-radius: 0.8rem;
    background: var(--danger-surface);
  }

  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    background: color-mix(in srgb, var(--shadow) 68%, transparent);
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
