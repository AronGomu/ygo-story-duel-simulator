<script lang="ts">
  import {
    MAXIMUM_DECK_NAME_LENGTH,
    type SortDirection,
    type SortMode,
  } from "../../decks/deck-model.ts";
  import type {
    DeckCardLists,
    DeckRecord,
    DeckZone,
  } from "../../decks/deck-contracts.ts";
  import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../decks/catalog/pinned-ruleset.ts";
  import {
    unlimitedCardOwnership,
    type CardOwnership,
  } from "../../decks/card-ownership.ts";
  import { getContext, tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { DeckBuilderState } from "../deck-editor-store.ts";
  import CardCatalog from "./CardCatalog.svelte";
  import {
    CardPreviewPanel,
    TOAST_CONTEXT_KEY,
    type ToastPublisher,
  } from "../../shell/index.ts";
  import DeckWorkspace from "./DeckWorkspace.svelte";
  import EditorTabs from "./EditorTabs.svelte";
  import TapTargetMenu from "./TapTargetMenu.svelte";
  import DeckCardContextMenu from "./DeckCardContextMenu.svelte";
  import {
    defaultPane,
    paneAfterAdd,
    paneAfterSelect,
    type EditorLayoutMode,
    type EditorPane,
  } from "../layout/editor-layout.ts";
  import { deckTapTargets, type TapTarget } from "../layout/tap-targets.ts";
  import {
    catalogCardClickIntent,
    catalogCardContextIntent,
    deckCardClickIntent,
    type ClickIntent,
    type ZoneCounts,
  } from "../layout/click-intent.ts";
  import type { PickedCard } from "../drag-state.ts";
  import LoadDeckDialog from "./LoadDeckDialog.svelte";
  import YdkImport from "./YdkImport.svelte";
  import type {
    DeckAutosaveRecord,
    DeckId,
  } from "../../decks/deck-contracts.ts";
  import { handleModalKeydown } from "../focus-trap.ts";

  export let state: DeckBuilderState;
  export let cards: readonly DeckBuilderCardView[];
  export let catalog: ReadonlyMap<number, DeckBuilderCardView>;
  export let ruleset: PinnedDeckRuleset;
  /* Passed straight to the catalog, which is the only pane that offers a card
      the deck does not already hold. Free play's is the default. */
  export let ownership: CardOwnership = unlimitedCardOwnership();
  /* `panels` is the three-column desktop editor; `tabs` shows one pane at a
     time below the stage breakpoint. The shell decides which, so no component
     below here reads the stage a second time. */
  export let layoutMode: EditorLayoutMode = "panels";
  export let returnLabel = "Deck Selection";
  export let onreturn: () => void = () => undefined;
  export let onrename: (name: string) => void;
  export let onmutate: (
    command: import("../../decks/deck-model.ts").DeckCommand,
  ) => boolean | void | Promise<boolean | void>;
  export let onsetillustration: (code: number) => void | Promise<void> = () =>
    undefined;
  export let onundo: () => void;
  export let onredo: () => void;
  export let onretrysave: () => void;
  export let onreload: () => void;
  export let onpreservecopy: () => void;
  export let onlistautosaves: () => Promise<
    readonly DeckAutosaveRecord[]
  > = () => Promise.resolve([]);
  export let onrestoreautosave: (entry: DeckAutosaveRecord) => void = () =>
    undefined;
  export let onopendeckbyid: (id: DeckId) => void = () => undefined;
  export let defaultDeckId: DeckId | null = null;
  export let onduplicate: () => void = () => undefined;
  export let onexport: () => void = () => undefined;
  export let onsetdefault: () => void = () => undefined;
  export let ondelete: () => void = () => undefined;

  let sortMode: SortMode | "" = "";
  let sortDirection: SortDirection = "asc";
  let selected: DeckBuilderCardView | null = null;
  let selectedCode: number | null = null;
  let hovered: DeckBuilderCardView | null = null;
  let hoveredCode: number | null = null;
  let picked: PickedCard | null = null;
  let dropHandled = false;
  let announcement = "";
  let deckName = state.current?.deck.name ?? "";
  let pane: EditorPane = defaultPane(layoutMode);
  let focusCatalogOnMount = true;
  let tapped: { code: number; zone: DeckZone; index: number } | null = null;
  let tapOpener: HTMLElement | null = null;
  let contextCard: {
    code: number;
    zone: DeckZone;
    index: number;
    x: number;
    y: number;
    opener: HTMLElement;
  } | null = null;
  let showLoad = false;
  let loadButton: HTMLButtonElement | null = null;
  let showImport = false;
  let importButton: HTMLButtonElement | null = null;
  let confirmingDelete = false;
  let deleteButton: HTMLButtonElement | null = null;
  let loadedAutosaves: readonly DeckAutosaveRecord[] = [];
  let toastedMessage: string | null = null;
  const toasts = getContext<ToastPublisher | undefined>(TOAST_CONTEXT_KEY);

  $: tabs = layoutMode === "tabs";
  $: deck = state.current?.deck ?? null;
  $: tapTargets = tapped === null ? [] : targetsFor(tapped.code, tapped.zone);
  $: if (
    deck !== null &&
    deck.name !== deckName &&
    document.activeElement?.id !== "deck-name"
  )
    deckName = deck.name;
  $: copies = deck === null ? new Map<number, number>() : countCopies(deck);
  $: if (
    state.message !== null &&
    state.message !== toastedMessage &&
    state.saveState !== "failed" &&
    state.saveState !== "conflict"
  ) {
    // eslint-disable-next-line no-useless-assignment -- retained across reactive runs
    toastedMessage = state.message;
    toasts?.show({ message: state.message, tone: "warning" });
  } else if (state.message === null) {
    // eslint-disable-next-line no-useless-assignment -- retained across reactive runs
    toastedMessage = null;
  }
  $: previewSource = hovered ?? selected;
  $: previewSourceCode = hovered !== null ? hoveredCode : selectedCode;
  $: previewView =
    previewSource !== null
      ? {
          code: previewSource.code,
          name: previewSource.name,
          description: previewSource.description,
        }
      : previewSourceCode !== null
        ? {
            code: previewSourceCode,
            name: `Missing card ${previewSourceCode}`,
            description: "Card data is unavailable for this code.",
          }
        : null;
  $: previewImageUrl = previewSource?.imageUrl ?? null;

  function countCopies(value: DeckRecord): ReadonlyMap<number, number> {
    const result = new SvelteMap<number, number>();
    for (const code of [...value.main, ...value.extra, ...value.side])
      result.set(code, (result.get(code) ?? 0) + 1);
    return result;
  }

  function selectSortMode(event: Event): void {
    sortMode = (event.currentTarget as HTMLSelectElement).value as SortMode;
    onmutate({ type: "sort", mode: sortMode, direction: sortDirection });
  }

  function toggleSortDirection(): void {
    if (sortMode === "") return;
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
    onmutate({ type: "sort", mode: sortMode, direction: sortDirection });
  }

  /* Every tap runs the same command the drag and keyboard paths run, so undo,
     redo and autosave cannot tell the three apart, and it aims at the card's
     canonical zone. */
  function tapCatalogCard(card: DeckBuilderCardView): void {
    const intent = catalogCardClickIntent(card.canonicalZone, zoneCounts());
    selectCard(card, card.code);
    applyIntent(intent, card.code, "catalog");
    if (intent.kind === "add") pane = paneAfterAdd(pane);
  }

  function tapDeckCard(code: number, zone: DeckZone, index: number): void {
    selectCard(catalog.get(code) ?? null, code);
    tapOpener = document.activeElement as HTMLElement | null;
    tapped = { code, zone, index };
  }

  function targetsFor(code: number, zone: DeckZone): readonly TapTarget[] {
    const card = catalog.get(code);
    const counts =
      deck === null
        ? { main: 0, extra: 0, side: 0 }
        : {
            main: deck.main.length,
            extra: deck.extra.length,
            side: deck.side.length,
          };
    /* A card the pinned catalog no longer knows cannot be placed anywhere, so
       removal is the only honest offer. */
    if (card === undefined)
      return [
        {
          zone: "remove",
          label: "Remove from deck",
          enabled: true,
          reason: null,
        },
      ];
    return deckTapTargets(card, zone, counts, ruleset);
  }

  async function chooseTapTarget(target: DeckZone | "remove"): Promise<void> {
    const active = tapped;
    if (active === null) return;
    const name = catalog.get(active.code)?.name ?? `Card ${active.code}`;
    if (target === "remove") {
      onmutate({
        type: "remove",
        cardCode: active.code,
        zone: active.zone,
        index: active.index,
      });
      announcement = `${name} removed.`;
    } else {
      onmutate({
        type: "move",
        cardCode: active.code,
        from: active.zone,
        to: target,
        index: active.index,
      });
      announcement = `${name} moved to ${target}.`;
    }
    await closeTapMenu();
  }

  async function closeTapMenu(): Promise<void> {
    tapped = null;
    await tick();
    tapOpener?.focus();
    tapOpener = null;
  }

  function selectCard(card: DeckBuilderCardView | null, code: number): void {
    selectedCode = code;
    selected = card ?? catalog.get(code) ?? null;
  }

  function zoneCounts(): ZoneCounts {
    return {
      main: deck?.main.length ?? 0,
      extra: deck?.extra.length ?? 0,
      side: deck?.side.length ?? 0,
    };
  }

  /* One place turns a catalog or double-click intent into a command, so
     pointer and touch adds keep the same capacity warnings. */
  function applyIntent(
    intent: ClickIntent,
    code: number,
    from: DeckZone | "catalog",
    index?: number,
  ): void {
    const name = catalog.get(code)?.name ?? `Card ${code}`;
    if (intent.kind === "blocked") {
      if (toasts === undefined) announcement = `${name}: ${intent.reason}`;
      else toasts.show({ message: intent.reason, tone: "warning" });
      return;
    }
    if (intent.kind === "add") {
      onmutate({ type: "add", cardCode: code, zone: intent.zone });
      announcement = `${name} added to ${intent.zone}.`;
      return;
    }
    /* A catalog tile has no copy in a zone to move or remove, and the catalog
       deriver never asks for one; this narrows `from` to a real zone. */
    if (from === "catalog") return;
    onmutate({ type: "remove", cardCode: code, zone: from, index });
    announcement = `${name} removed.`;
  }

  function doubleClickDeckCard(
    code: number,
    zone: DeckZone,
    index: number,
  ): void {
    selectCard(catalog.get(code) ?? null, code);
    applyIntent(deckCardClickIntent(), code, zone, index);
  }

  function doubleClickCatalogCard(card: DeckBuilderCardView): void {
    selectCard(card, card.code);
    applyIntent(
      catalogCardClickIntent(card.canonicalZone, zoneCounts()),
      card.code,
      "catalog",
    );
  }

  function startCatalogDrag(
    card: DeckBuilderCardView,
    event?: DragEvent,
  ): void {
    selected = card;
    selectedCode = card.code;
    picked = { code: card.code, source: "catalog", index: null };
    dropHandled = false;
    event?.dataTransfer?.setData("text/plain", String(card.code));
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    announcement = `${card.name} picked up. Drop in ${card.canonicalZone === "main" ? "Main Deck" : "Extra Deck"}.`;
  }

  function startZoneDrag(
    code: number,
    zone: DeckZone,
    index: number,
    event?: DragEvent,
  ): void {
    selected = catalog.get(code) ?? null;
    selectedCode = code;
    picked = { code, source: zone, index };
    dropHandled = false;
    event?.dataTransfer?.setData("text/plain", String(code));
    if (event?.dataTransfer) event.dataTransfer.effectAllowed = "move";
    announcement = `${selected?.name ?? `Card ${code}`} picked up from ${zone}.`;
  }

  function dropInZone(zone: DeckZone): void {
    if (picked === null) return;
    dropHandled = true;
    const src = picked;
    const card = catalog.get(src.code);
    if (src.source === "catalog") {
      if (
        card !== undefined &&
        (zone === card.canonicalZone || zone === "side")
      ) {
        onmutate({ type: "add", cardCode: src.code, zone });
        announcement = `${card.name} added to ${zone}.`;
      } else {
        const message = `Card cannot be added to ${zone}.`;
        if (toasts === undefined) announcement = message;
        else toasts.show({ message, tone: "warning" });
      }
      picked = null;
      return;
    }
    if (src.source === zone) {
      picked = null;
      return;
    }
    const legal =
      card !== undefined &&
      (src.source === "side" ? zone === card.canonicalZone : zone === "side");
    if (legal) {
      onmutate({
        type: "move",
        cardCode: src.code,
        from: src.source,
        to: zone,
      });
      announcement = `${card!.name} moved to ${zone}.`;
    } else {
      /* The dragged tile's own index, so a repeated card loses the copy the
         player picked up rather than its first copy: the click and
         context-menu paths already aim this way, and a drag that reads the
         same tile has to agree with them. */
      onmutate({
        type: "remove",
        cardCode: src.code,
        zone: src.source,
        ...(src.index === null ? {} : { index: src.index }),
      });
      announcement = `${card?.name ?? `Card ${src.code}`} removed.`;
    }
    picked = null;
  }

  function reorderInZone(zone: DeckZone, toIndex: number): void {
    if (picked === null || picked.source !== zone || picked.index === null)
      return;
    dropHandled = true;
    onmutate({ type: "reorder", zone, from: picked.index, to: toIndex });
    picked = null;
  }

  function contextAdd(card: DeckBuilderCardView): void {
    applyIntent(
      catalogCardContextIntent(card.canonicalZone, zoneCounts()),
      card.code,
      "catalog",
    );
  }

  function focusCatalogNameInput(input: HTMLInputElement): void {
    if (!focusCatalogOnMount || showLoad || showImport || confirmingDelete)
      return;
    focusCatalogOnMount = false;
    input.focus();
  }

  function openCardContext(
    code: number,
    zone: DeckZone,
    index: number,
    request: {
      readonly anchor: HTMLElement;
      readonly x: number;
      readonly y: number;
    },
  ): void {
    selectCard(catalog.get(code) ?? null, code);
    contextCard = { code, zone, index, ...request, opener: request.anchor };
  }

  async function closeCardContext(): Promise<void> {
    const opener = contextCard?.opener ?? null;
    contextCard = null;
    await tick();
    opener?.focus();
  }

  async function setCardIllustration(): Promise<void> {
    if (contextCard === null) return;
    const code = contextCard.code;
    const name = catalog.get(code)?.name ?? `Card ${code}`;
    await onsetillustration(code);
    announcement = `${name} set as deck illustration.`;
    await closeCardContext();
  }

  async function removeContextCard(): Promise<void> {
    if (contextCard === null) return;
    const { code, zone, index } = contextCard;
    onmutate({ type: "remove", cardCode: code, zone, index });
    announcement = `${catalog.get(code)?.name ?? `Card ${code}`} removed.`;
    await closeCardContext();
  }

  function endZoneDrag(): void {
    if (picked === null) return;
    if (!dropHandled && picked.source !== "catalog") {
      /* Same tile, same copy: a drag abandoned outside every zone removes the
         one that was picked up. */
      onmutate({
        type: "remove",
        cardCode: picked.code,
        zone: picked.source,
        ...(picked.index === null ? {} : { index: picked.index }),
      });
      announcement = `${catalog.get(picked.code)?.name ?? `Card ${picked.code}`} removed.`;
    }
    picked = null;
    dropHandled = false;
  }

  async function openLoadDialog(): Promise<void> {
    loadedAutosaves = await onlistautosaves();
    showLoad = true;
  }

  /* `loadButton` is null once the editor unmounts, so opening another deck
     never fights the new view for focus. */
  async function closeLoadDialog(): Promise<void> {
    showLoad = false;
    await tick();
    loadButton?.focus();
  }

  async function importCurrentDeck(cards: DeckCardLists): Promise<boolean> {
    const imported = await onmutate({ type: "import", cards });
    if (imported === true) await closeImportDialog();
    return imported === true;
  }

  async function closeImportDialog(): Promise<void> {
    showImport = false;
    await tick();
    importButton?.focus();
  }

  async function closeDelete(): Promise<void> {
    confirmingDelete = false;
    await tick();
    deleteButton?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const editingText =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target?.isContentEditable ?? false);
    if (!editingText && (event.ctrlKey || event.metaKey)) {
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        if ((state.current?.history.undo.length ?? 0) > 0) onundo();
        return;
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        if ((state.current?.history.redo.length ?? 0) > 0) onredo();
        return;
      }
    }
    if (event.key !== "Escape") return;
    if (contextCard !== null) {
      void closeCardContext();
      announcement = "Card actions closed.";
    } else if (tapped !== null) {
      void closeTapMenu();
      announcement = "Card move cancelled.";
    } else if (picked !== null) {
      picked = null;
      announcement = "Card move cancelled.";
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if deck}
  <header class="editor-header" data-cy="deck-editor-header">
    <div class="name-field" data-cy="deck-editor-name-field">
      <input
        id="deck-name"
        data-cy="deck-name-input"
        aria-label="Deck name"
        placeholder="Deck name"
        bind:value={deckName}
        maxlength={MAXIMUM_DECK_NAME_LENGTH}
        onblur={() => {
          if (deckName.trim() && deckName.trim() !== deck?.name)
            onrename(deckName);
        }}
      />
    </div>
    <div class="sort-actions" data-cy="deck-workspace-sort-actions">
      <select
        bind:value={sortMode}
        aria-label="Sort By"
        data-cy="deck-workspace-sort-mode"
        onchange={selectSortMode}
      >
        <option value="" disabled data-cy="deck-workspace-sort-option-none"
          >Sort By</option
        >
        <option value="alpha" data-cy="deck-workspace-sort-option-alpha"
          >A–Z</option
        >
        <option value="type" data-cy="deck-workspace-sort-option-type"
          >CardType>A–Z</option
        >
        <option value="level" data-cy="deck-workspace-sort-option-level"
          >Level>CardType>A–Z</option
        >
        <option value="attribute" data-cy="deck-workspace-sort-option-attribute"
          >Attribute>CardType>A–Z</option
        >
        <option value="race" data-cy="deck-workspace-sort-option-race"
          >MonsterType>CardType>A–Z</option
        >
        <option value="atk" data-cy="deck-workspace-sort-option-atk"
          >ATK>CardType>A–Z</option
        >
        <option value="def" data-cy="deck-workspace-sort-option-def"
          >DEF>CardType>A–Z</option
        >
      </select>
      <button
        type="button"
        class="secondary"
        disabled={sortMode === ""}
        aria-label={sortDirection === "asc"
          ? "Sort descending"
          : "Sort ascending"}
        data-cy="deck-workspace-sort-direction"
        onclick={toggleSortDirection}
        >{sortDirection === "asc" ? "Descending" : "Ascending"}</button
      >
    </div>
    <button
      type="button"
      class="secondary"
      data-cy="deck-editor-duplicate"
      onclick={onduplicate}>Duplicate</button
    >
    <button
      type="button"
      class="secondary"
      data-cy="deck-editor-export"
      onclick={onexport}>Export</button
    >
    <button
      type="button"
      class="secondary"
      data-cy="deck-editor-set-default"
      disabled={deck?.id === defaultDeckId}
      onclick={onsetdefault}>Set default</button
    >
    <button
      type="button"
      class="danger"
      data-cy="deck-editor-delete"
      bind:this={deleteButton}
      onclick={() => (confirmingDelete = true)}>Delete</button
    >
    <button
      type="button"
      class="secondary"
      disabled={state.current?.history.undo.length === 0}
      data-cy="deck-editor-undo"
      onclick={onundo}
      aria-keyshortcuts="Control+Z">Undo</button
    >
    <button
      type="button"
      class="secondary"
      disabled={state.current?.history.redo.length === 0}
      data-cy="deck-editor-redo"
      onclick={onredo}
      aria-keyshortcuts="Control+Y Control+Shift+Z">Redo</button
    >
    <button
      type="button"
      class="secondary"
      data-cy="deck-editor-import"
      bind:this={importButton}
      onclick={() => (showImport = true)}>Import</button
    >
    <button
      type="button"
      class="secondary"
      data-cy="deck-editor-load"
      bind:this={loadButton}
      onclick={() => void openLoadDialog()}>Load</button
    >
  </header>

  <p
    class="visually-hidden"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-cy="deck-editor-announcement"
  >
    {announcement}
  </p>

  <main
    class="editor-layout"
    class:tabs
    aria-busy={state.saveState === "saving"}
    data-cy="deck-editor-layout"
  >
    <!-- Always rendered, and empty it is a zero-height row: a message that
         appeared outside the sized grid would push the panes past the stage
         and hand the region a scrollbar (ADR-042). -->
    <div class="message-strip" data-cy="deck-editor-message-strip">
      {#if state.saveState === "failed"}
        <section
          class="message error"
          role="alert"
          data-cy="deck-editor-save-failed"
        >
          <p data-cy="deck-editor-save-failed-message">{state.message}</p>
          <button
            type="button"
            data-cy="deck-editor-retry-save"
            onclick={onretrysave}>Retry autosave</button
          >
          <button
            type="button"
            class="secondary"
            data-cy="deck-editor-reload-saved"
            onclick={onreload}>Reload saved deck</button
          >
        </section>
      {:else if state.saveState === "conflict"}
        <section
          class="message error"
          role="alert"
          data-cy="deck-editor-conflict"
        >
          <p data-cy="deck-editor-conflict-message">{state.message}</p>
          <button
            type="button"
            data-cy="deck-editor-reload-revision"
            onclick={onreload}>Reload newer revision</button
          >
          <button
            type="button"
            class="secondary"
            data-cy="deck-editor-preserve-copy"
            onclick={onpreservecopy}>Preserve local edits as copy</button
          >
        </section>
      {:else if state.message && toasts === undefined}
        <p class="message" role="status" data-cy="deck-editor-message">
          {state.message}
        </p>
      {/if}
    </div>

    {#if tabs}
      <EditorTabs {pane} onselectpane={(next) => (pane = next)} />
    {/if}

    {#if !tabs || pane === "details"}
      <div
        class="pane details-pane"
        id="deck-pane-details"
        role={tabs ? "tabpanel" : undefined}
        data-cy="deck-pane-details"
      >
        <CardPreviewPanel
          preview={previewView}
          imageLibrary={null}
          staticImageUrl={previewImageUrl}
          placeholderUrl=""
        />
        <button
          type="button"
          class="danger return-button"
          data-cy="deck-editor-return"
          onclick={onreturn}>Return to {returnLabel}</button
        >
      </div>
    {/if}

    {#if !tabs || pane === "deck"}
      <div
        class="pane"
        id="deck-pane-deck"
        role={tabs ? "tabpanel" : undefined}
        data-cy="deck-pane-deck"
      >
        <DeckWorkspace
          {deck}
          {catalog}
          {ruleset}
          {ownership}
          {selectedCode}
          {picked}
          filled={tabs}
          onselect={selectCard}
          ontap={tabs ? tapDeckCard : null}
          ondoubleclick={tabs ? null : doubleClickDeckCard}
          ondragcard={(code, zone, index, event) =>
            startZoneDrag(code, zone, index, event)}
          ondragcancel={endZoneDrag}
          onreorderdrop={reorderInZone}
          ondropzone={dropInZone}
          oncontextremove={openCardContext}
          onhovercard={(code) => {
            hovered = catalog.get(code) ?? null;
            hoveredCode = code;
          }}
          onhoverend={() => {
            hovered = null;
            hoveredCode = null;
          }}
        />
      </div>
    {/if}

    {#if !tabs || pane === "catalog"}
      <div
        class="pane"
        id="deck-pane-catalog"
        role={tabs ? "tabpanel" : undefined}
        data-cy="deck-pane-catalog"
      >
        <CardCatalog
          {cards}
          {ruleset}
          {ownership}
          {selectedCode}
          {copies}
          filled={tabs}
          onselect={(card) => {
            selected = card;
            selectedCode = card.code;
          }}
          ontap={tabs ? tapCatalogCard : null}
          ondoubleclick={tabs ? null : doubleClickCatalogCard}
          ondragcard={(card, event) => startCatalogDrag(card, event)}
          ondragcancel={endZoneDrag}
          oncontextadd={contextAdd}
          onnameinputmount={focusCatalogNameInput}
          onblocked={(card, reason) => {
            selected = card;
            selectedCode = card.code;
            if (toasts === undefined) announcement = `${card.name}: ${reason}`;
            else toasts.show({ message: reason, tone: "warning" });
            pane = paneAfterSelect(pane, layoutMode);
          }}
          onhovercard={(card) => {
            hovered = card;
            hoveredCode = card.code;
          }}
          onhoverend={() => {
            hovered = null;
            hoveredCode = null;
          }}
        />
      </div>
    {/if}
  </main>

  {#if contextCard !== null}
    <DeckCardContextMenu
      cardName={catalog.get(contextCard.code)?.name ??
        `Card ${contextCard.code}`}
      x={contextCard.x}
      y={contextCard.y}
      onsetillustration={() => void setCardIllustration()}
      onremove={() => void removeContextCard()}
      oncancel={() => void closeCardContext()}
    />
  {/if}

  {#if tapped !== null}
    <div class="backdrop" aria-hidden="true" data-cy="deck-tap-backdrop"></div>
    <TapTargetMenu
      cardName={catalog.get(tapped.code)?.name ?? `Card ${tapped.code}`}
      targets={tapTargets}
      onchoose={(target) => void chooseTapTarget(target)}
      oncancel={() => void closeTapMenu()}
    />
  {/if}

  {#if confirmingDelete}
    <div
      class="backdrop"
      aria-hidden="true"
      data-cy="deck-delete-backdrop"
    ></div>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-labelledby="deck-editor-delete-dialog-heading"
      data-cy="deck-editor-delete-dialog"
      onkeydown={(event) => handleModalKeydown(event, closeDelete)}
    >
      <h2
        id="deck-editor-delete-dialog-heading"
        tabindex="-1"
        data-cy="deck-editor-delete-heading"
      >
        Delete {deck.name}?
      </h2>
      <p data-cy="deck-editor-delete-message">
        Local deck and retained history will be removed.
      </p>
      <div class="actions" data-cy="deck-editor-delete-actions">
        <button
          type="button"
          class="secondary"
          data-cy="deck-editor-delete-cancel"
          onclick={closeDelete}>Cancel</button
        >
        <button
          type="button"
          class="danger"
          data-cy="deck-editor-delete-confirm"
          onclick={() => {
            ondelete();
            void closeDelete();
          }}>Delete {deck.name}</button
        >
      </div>
    </div>
  {/if}

  {#if showImport}
    <div
      class="backdrop"
      aria-hidden="true"
      data-cy="deck-editor-import-backdrop"
    ></div>
    <YdkImport
      requireName={false}
      catalogCodes={new Set(catalog.keys())}
      existingDeckNames={[]}
      onimport={importCurrentDeck}
      oncancel={() => void closeImportDialog()}
    />
  {/if}

  {#if showLoad}
    <div class="backdrop" aria-hidden="true" data-cy="load-deck-backdrop"></div>
    <LoadDeckDialog
      decks={state.decks}
      autosaves={loadedAutosaves}
      onopendeck={(id) => {
        void closeLoadDialog();
        onopendeckbyid(id);
      }}
      onrestore={(entry) => {
        void closeLoadDialog();
        onrestoreautosave(entry);
      }}
      oncancel={() => void closeLoadDialog()}
    />
  {/if}
{/if}

<style>
  .editor-header {
    display: grid;
    grid-template-columns: auto 1fr repeat(8, auto);
    align-items: end;
    gap: 0.55rem;
    width: 100%;
    margin-inline: 0;
    padding: 0.6rem 0.25rem;
  }

  .editor-header button {
    min-height: 2.45rem;
    padding: 0.45rem 0.65rem;
  }

  .sort-actions {
    display: flex;
    gap: 0.4rem;
  }

  .sort-actions select {
    min-width: 12rem;
    min-height: 2.45rem;
    padding: 0.45rem 0.6rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-chain);
    font-weight: 700;
    cursor: pointer;
  }

  .name-field {
    display: grid;
    gap: 0.2rem;
  }

  .name-field input {
    width: 11rem;
    min-height: 2.45rem;
    padding: 0.45rem 0.6rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-chain);
    font-weight: 750;
  }

  .editor-layout {
    /* Free play pays only for the editor header. `DeckEditorApp` raises this
       when a story-save context banner is present above it. */
    --deck-editor-header-h: 4.75rem;

    display: grid;
    grid-template-columns: var(--preview-w, 15.5rem) minmax(0, 1fr) minmax(
        16rem,
        0.55fr
      );
    grid-template-rows: auto minmax(0, 1fr);
    /* No row gap: the strip is zero-height when silent, and its own message
       carries the spacing when it is not. */
    column-gap: 0.5rem;
    row-gap: 0;
    width: 100%;
    height: calc(var(--stage-h, 100svh) - var(--deck-editor-header-h));
    margin-inline: 0;
    padding: 0 0.25rem 0.5rem;
  }

  /* Above the breakpoint the pane wrapper is not a box at all: the three
     sections stay the grid's own children, so the desktop layout is the same
     layout it was before the panes existed. */
  .pane {
    display: contents;
  }

  .details-pane {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
  }

  .details-pane :global(.card-preview-panel) {
    height: 100%;
    overflow-y: auto;
  }

  .return-button {
    width: 100%;
  }

  .editor-layout.tabs {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 0.55rem;
  }

  .editor-layout.tabs .pane {
    display: block;
    min-width: 0;
  }

  .editor-layout.tabs .details-pane {
    display: grid;
  }

  .message-strip {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .message {
    width: 100%;
    margin: 0 0 0.4rem;
    padding: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
  }

  .message.error {
    border-color: var(--danger-border);
    background: var(--danger-surface);
  }

  .message p {
    margin: 0 0 0.5rem;
  }

  .backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    background: color-mix(in srgb, var(--shadow) 68%, transparent);
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
    background: var(--surface);
    box-shadow: 0 1.5rem 5rem color-mix(in srgb, var(--shadow) 55%, transparent);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* Below the stage breakpoint the header wraps rather than scrolling sideways.
     The width matches `STAGE_BREAKPOINT_PX` in `src/shell/stage-layout.ts`. */
  @media (max-width: 1023.98px) {
    .editor-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      width: 100%;
      padding-block: 0.5rem;
      padding-inline: 0.5rem;
    }

    .name-field {
      flex: 1 1 9rem;
    }

    .editor-layout {
      width: 100%;
      height: auto;
      padding-inline: 0.5rem;
      grid-template-rows: auto;
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
