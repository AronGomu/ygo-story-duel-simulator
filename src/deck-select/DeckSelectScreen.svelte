<script lang="ts">
  import { onMount, tick } from "svelte";
  import DecklistPanel from "./DecklistPanel.svelte";
  import DeckTile from "./DeckTile.svelte";
  import DeckTileMenu from "./DeckTileMenu.svelte";
  import DeleteDeckConfirm from "./DeleteDeckConfirm.svelte";
  import RenameDeckDialog from "./RenameDeckDialog.svelte";
  import type {
    DeckSelectMode,
    DeckSort,
    DeckTileModel,
    DecklistView,
    OpponentView,
  } from "./deck-select-contracts.ts";
  import { handleModalKeydown } from "./focus-trap.ts";
  import { orderDeckTiles, pinSelectedFirst } from "./order-deck-tiles.ts";

  export let mode: DeckSelectMode;
  export let eyebrow: string;
  export let title: string;
  /** Unordered; the screen ranks and filters them itself. */
  export let tiles: readonly DeckTileModel[];
  export let sort: DeckSort = "modified";
  /** The active pick in duel-start, the focused deck in the library. */
  export let selectedKey: string | null;
  export let startLabel = "Start the duel";
  export let canStart = false;
  /** Footer notice: why the duel cannot start, when something blocks it. */
  export let blockNotice: string | null = null;
  /** False hides both back controls. The story's briefing commits to the
      encounter it is seating, and its own way back sits outside this screen. */
  export let showBack = true;
  /** The origin the way back returns to, named rather than pointed at: only
      the host knows which screen it opened this one from. */
  export let backLabel = "Menu";
  /** False hides the footer's Delete/Rename/Duplicate cluster and every tile's
      kebab — a scope whose decks are managed somewhere else. Open and Start
      stay: they are how this screen is left, not how a deck is edited. */
  export let manageable = true;
  /** Host owns default capability and persistence. Bundled presets default to
      incapable; story-owned locked decks may opt in independently. */
  export let canSetDefault: (tile: DeckTileModel) => boolean = (tile) =>
    !tile.bundled;
  export let onsetdefault: (key: string) => void = () => undefined;
  export let onselect: (key: string) => void = () => undefined;
  export let onstart: () => void = () => undefined;
  export let onback: () => void = () => undefined;
  export let onopen: (key: string) => void = () => undefined;
  export let onblockedopen: (tile: DeckTileModel) => void = () => undefined;
  export let onrename: (key: string, name: string) => void = () => undefined;
  export let onduplicate: (key: string) => void = () => undefined;
  export let ondelete: (key: string) => void = () => undefined;
  /** Making a deck belongs to whoever owns somewhere to make it; null is a
      host that owns none, and renders no Create at all. */
  export let oncreate: (() => void) | null = null;
  /** Duel-start only; null hides the whole right column (library mode passes null). */
  export let opponent: OpponentView | null = null;
  /** Free-play picker options; empty + opponent.locked → no picker (story). */
  export let opponents: readonly OpponentView[] = [];
  /** Opponent's current deck tile; named by the red seat chip. */
  export let opponentDeck: DeckTileModel | null = null;
  /** Your current deck tile; null falls back to the selected grid tile. */
  export let playerDeck: DeckTileModel | null = null;
  /** Which seat grid presses fill. Host owns it; card toggle reports. */
  export let seat: "player" | "opponent" = "player";
  export let onseat: (seat: "player" | "opponent") => void = () => undefined;
  export let onpickopponent: (id: string) => void = () => undefined;
  /** Test override for the phone layout: null follows the media query. */
  export let forceNarrow: boolean | null = null;
  /** Test override for measured titlebar/footer overflow. */
  export let forceCompact: boolean | null = null;
  /** Full decklist for a tile key; null = no preview for that tile. Async so
      hosts may lazy-load; the screen ignores stale resolutions, so only the
      currently hovered key's answer ever renders. */
  export let decklistFor:
    ((key: string) => Promise<DecklistView | null>) | null = null;
  /** Full-size text-free card art URL for a code; null = no art float. */
  export let cardImageFor: ((code: number) => string | null) | null = null;

  let filter = "";
  let filterField: HTMLInputElement;
  /** Which tile's kebab is open, and the kebab itself for the sheet to sit
      under. Null closes the sheet. */
  let menu: { key: string; anchor: HTMLElement } | null = null;
  let renaming: string | null = null;
  let deleting: string | null = null;
  let picking = false;
  let grid: HTMLElement | null = null;
  /* The deck the pointer is on and that deck's list once it resolves. The token
     is what a late answer is measured against. */
  let hoverToken = 0;
  let hoverKey: string | null = null;
  let hoverList: DecklistView | null = null;
  /** Resting content for the library dock and both duel-start seats. */
  let restToken = 0;
  let restList: DecklistView | null = null;
  let playerRestToken = 0;
  let playerRestList: DecklistView | null = null;
  let opponentRestToken = 0;
  let opponentRestList: DecklistView | null = null;
  let artToken = 0;
  let art: {
    readonly token: number;
    readonly url: string;
    readonly fallbackUrl: string | null;
    readonly place: string;
  } | null = null;
  /* The portrait opened the picker and is where the caret was, so it is bound
     here to take focus back however the picker closes. */
  let portrait: HTMLElement | null = null;
  let picker: HTMLElement | null = null;
  let titlebar: HTMLElement | null = null;
  let footer: HTMLElement | null = null;
  let titleProbe: HTMLElement | null = null;
  let footerProbe: HTMLElement | null = null;
  let measuredCompact = false;
  let compactMenuOpen = false;
  let compactKebab: HTMLButtonElement | null = null;
  let compactMenu: HTMLElement | null = null;

  const NARROW_QUERY = "(max-width: 40rem)";
  /* A hover preview is a pointer's affordance: a finger has no hover to raise
     it with and none to take it away again, so a coarse pointer gets none. */
  const COARSE_QUERY = "(pointer: coarse)";
  /* Gap between the library dock's card-scan float and the row it accompanies. */
  const FLOAT_GAP = 12;
  const ART_WIDTH = 240;
  const CARD_ASPECT = 421 / 614;
  let matchedNarrow = false;
  let matchedCoarse = false;

  function track(query: string, apply: (matches: boolean) => void): () => void {
    const media = window.matchMedia(query);
    apply(media.matches);
    const change = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }

  /* One listener per fact for the whole screen rather than one per row: the
     phone layout and the pointer's shape are properties of the viewport, and
     everything that reads them here is the same fact. Guarded because a test
     document has no `matchMedia` at all, and drives `forceNarrow` instead. */
  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const stop = [
      track(NARROW_QUERY, (matches) => (matchedNarrow = matches)),
      track(COARSE_QUERY, (matches) => (matchedCoarse = matches)),
    ];
    return () => {
      for (const off of stop) off();
    };
  });

  onMount(() => {
    filterField.focus();
  });

  /* Probes always contain the full bars, so measuring them remains stable
     after compact markup replaces the overflowing controls. Observing both
     live bars and probes catches container resizes plus copy/count changes. */
  onMount(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (
        titlebar === null ||
        footer === null ||
        titleProbe === null ||
        footerProbe === null
      )
        return;
      measuredCompact =
        titleProbe.scrollWidth > titlebar.clientWidth ||
        footerProbe.scrollWidth > footer.clientWidth;
    };
    const observer = new ResizeObserver(measure);
    for (const element of [titlebar, footer, titleProbe, footerProbe])
      if (element !== null) observer.observe(element);
    measure();
    return () => observer.disconnect();
  });

  $: narrow = forceNarrow ?? matchedNarrow;
  $: compact = forceCompact ?? (!narrow && measuredCompact);
  $: if (!compact) compactMenuOpen = false;
  /** The deck filling the seat the grid is currently picking for. */
  $: activeKey =
    seat === "opponent" ? (opponentDeck?.key ?? null) : selectedKey;

  $: ranked = orderDeckTiles(
    tiles.filter((candidate) =>
      candidate.name
        .toLocaleLowerCase()
        .includes(filter.trim().toLocaleLowerCase()),
    ),
    sort,
  );
  /* One column on a phone, so the current pick would scroll out of reach while
     the rest of the list is browsed; the wide grid shows it without help. */
  $: shown = narrow ? pinSelectedFirst(ranked, activeKey) : ranked;
  $: if (
    hoverKey !== null &&
    (!previews || !shown.some((candidate) => candidate.key === hoverKey))
  )
    clearPreview();
  /* Built here rather than interpolated in the markup: the count is one token
     and formatter whitespace around `{…}` would land inside it. */
  $: countLabel = `${shown.length}/${tiles.length}`;
  $: backText = `← Return to ${backLabel}`;

  /* Every lookup takes the pool as an argument so the reactive statements below
     re-run when the host hands over a new `tiles` — a renamed or deleted deck
     must not leave a stale model behind a dialog. */
  function tileFor(
    pool: readonly DeckTileModel[],
    key: string | null,
  ): DeckTileModel | null {
    if (key === null) return null;
    return pool.find((candidate) => candidate.key === key) ?? null;
  }

  $: seatPanel = mode === "duel-start" && opponent !== null;
  /* A host that hands over no resolver wants no previews at all, so the whole
     mechanism turns off with it. */
  $: previews = decklistFor !== null && !narrow && !matchedCoarse;
  $: docked = mode === "library" && decklistFor !== null && !narrow;
  /* Hovering borrows the dock and leaving gives it back, so the resting list
     is resolved once for the pick rather than re-fetched on every move. */
  $: dockList = (previews ? hoverList : null) ?? restList;
  $: playerTile = playerDeck ?? tileFor(tiles, selectedKey);
  $: playerPreviewing =
    seatPanel && previews && seat === "player" && hoverKey !== null;
  $: opponentPreviewing =
    seatPanel && previews && seat === "opponent" && hoverKey !== null;
  $: playerList = playerPreviewing ? hoverList : playerRestList;
  $: opponentList = opponentPreviewing ? hoverList : opponentRestList;
  $: void loadRest(decklistFor, selectedKey, docked);
  $: void loadPlayerRest(decklistFor, selectedKey, seatPanel);
  $: void loadOpponentRest(decklistFor, opponentDeck?.key ?? null, seatPanel);
  $: selectedTile = tileFor(tiles, selectedKey);
  $: menuTile = tileFor(tiles, menu === null ? null : menu.key);
  $: renameTile = tileFor(tiles, renaming);
  $: renameUnavailableNames =
    renameTile === null
      ? []
      : tiles
          .filter((candidate) => candidate.key !== renameTile.key)
          .map((candidate) => candidate.name);
  $: deleteTile = tileFor(tiles, deleting);

  /* While the opponent seat is the one being filled the grid answers their
     question instead of yours: the halo follows their deck, and your own pick
     keeps the badge that stops it disappearing from view. */
  function haloFor(
    candidate: DeckTileModel,
  ): "you" | "opponent" | "focus" | null {
    if (seat === "opponent")
      return candidate.key === opponentDeck?.key ? "focus" : null;
    if (candidate.key !== selectedKey) return null;
    return "focus";
  }

  /* The card is the control: pressing the opponent's deck fills their seat,
     pressing it again returns to picking for yourself. */
  function toggleOpponentSeat(): void {
    onseat(seat === "opponent" ? "player" : "opponent");
  }

  function closePicker(): void {
    picking = false;
    portrait?.focus();
  }

  function pickOpponent(id: string): void {
    onpickopponent(id);
    closePicker();
  }

  /* The picker is modal, so the caret has to be inside it before Escape or
     Tab mean anything; the first option is where a press would have landed,
     and the dialog itself is the fallback that keeps Escape reachable. */
  $: if (picking && picker !== null)
    (picker.querySelector<HTMLElement>("button") ?? picker).focus();

  function documentPointerDown(event: Event): void {
    const origin = event.target;
    if (picking) {
      if (!(origin instanceof Node && picker?.contains(origin))) closePicker();
    }
    if (!compactMenuOpen) return;
    if (
      origin instanceof Node &&
      (compactMenu?.contains(origin) || compactKebab?.contains(origin))
    )
      return;
    closeCompactMenu();
  }

  /* The grid cell the pointer is inside, found by position: the tiles are the
     grid's own children in `shown` order, so the cell containing the event's
     target names the deck without reaching into the tile's markup. */
  function cellAt(target: EventTarget | null): {
    key: string;
    cell: HTMLElement;
  } | null {
    if (grid === null || !(target instanceof Node)) return null;
    const cells = [...grid.children];
    const index = cells.findIndex((candidate) => candidate.contains(target));
    const key = shown[index]?.key;
    const cell = cells[index];
    if (key === undefined || !(cell instanceof HTMLElement)) return null;
    return { key, cell };
  }

  /* `pointerenter` and `pointerleave` do not bubble, so the grid listens for
     them in the capture phase: one listener for every tile, and the tiles stay
     the grid's direct children instead of each gaining a wrapper to hang a
     handler on. Both fire again for a tile's own children, which is why the
     key and the target are checked before anything moves. */
  function enterTile(event: PointerEvent): void {
    if (!previews) return;
    const found = cellAt(event.target);
    if (found === null || found.key === hoverKey) return;
    void preview(found.key);
  }

  function leaveTile(event: PointerEvent): void {
    const target = event.target;
    if (target !== grid && cellAt(target)?.cell !== target) return;
    clearPreview();
  }

  async function preview(key: string): Promise<void> {
    const resolve = decklistFor;
    if (resolve === null) return;
    const token = ++hoverToken;
    hoverKey = key;
    hoverList = null;
    const resolved = await resolve(key);
    /* A slow deck resolving after the pointer moved on is answering a question
       nobody is asking any more. */
    if (token !== hoverToken) return;
    hoverList = resolved;
  }

  function clearPreview(): void {
    hoverToken += 1;
    hoverKey = null;
    hoverList = null;
    hideArt();
  }

  async function loadRest(
    resolve: ((key: string) => Promise<DecklistView | null>) | null,
    key: string | null,
    active: boolean,
  ): Promise<void> {
    const token = ++restToken;
    restList = null;
    if (!active || resolve === null || key === null) return;
    const resolved = await resolve(key);
    if (token !== restToken) return;
    restList = resolved;
  }

  async function loadPlayerRest(
    resolve: ((key: string) => Promise<DecklistView | null>) | null,
    key: string | null,
    active: boolean,
  ): Promise<void> {
    const token = ++playerRestToken;
    playerRestList = null;
    if (!active || resolve === null || key === null) return;
    const resolved = await resolve(key);
    if (token !== playerRestToken) return;
    playerRestList = resolved;
  }

  async function loadOpponentRest(
    resolve: ((key: string) => Promise<DecklistView | null>) | null,
    key: string | null,
    active: boolean,
  ): Promise<void> {
    const token = ++opponentRestToken;
    opponentRestList = null;
    if (!active || resolve === null || key === null) return;
    const resolved = await resolve(key);
    if (token !== opponentRestToken) return;
    opponentRestList = resolved;
  }

  /** Cropped runtime art → matching full card scan; other sources pass through. */
  function fullCardImageUrl(cropped: string | null): string | null {
    return (
      cropped?.replace("/runtime/images-cropped/", "/runtime/images/") ?? null
    );
  }

  /* The row names the card; the float is the card itself, held clear of the
     dock so it never covers the list it came from. Its box keeps the printed
     card ratio while short or narrow viewports shrink both axes together. */
  function showArt(code: number, anchor: HTMLElement): void {
    const sourceUrl = cardImageFor?.(code) ?? null;
    if (sourceUrl === null) {
      hideArt();
      return;
    }
    const url = fullCardImageUrl(sourceUrl);
    if (url === null) {
      hideArt();
      return;
    }
    const viewportWidth = Math.max(0, window.innerWidth - FLOAT_GAP * 2);
    const viewportHeight = Math.max(0, window.innerHeight - FLOAT_GAP * 2);
    const width = Math.min(
      ART_WIDTH,
      viewportWidth,
      viewportHeight * CARD_ASPECT,
    );
    if (width <= 0) {
      hideArt();
      return;
    }
    const height = width / CARD_ASPECT;
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(
      FLOAT_GAP,
      Math.min(
        rect.left - FLOAT_GAP - width,
        window.innerWidth - FLOAT_GAP - width,
      ),
    );
    const top = Math.max(
      FLOAT_GAP,
      Math.min(rect.top, window.innerHeight - FLOAT_GAP - height),
    );
    const token = ++artToken;
    const fallbackUrl = sourceUrl.includes("/runtime/images-cropped/")
      ? sourceUrl
      : sourceUrl.replace("/runtime/images/", "/runtime/images-cropped/");
    art = {
      token,
      url,
      fallbackUrl: fallbackUrl === url ? null : fallbackUrl,
      place: `top: ${Math.round(top)}px; left: ${Math.round(left)}px; width: ${Math.round(width)}px; height: ${Math.round(height)}px`,
    };
  }

  function hideArt(): void {
    artToken += 1;
    art = null;
  }

  function handleArtError(token: number, failedUrl: string): void {
    if (art === null || art.token !== token || art.url !== failedUrl) return;
    if (art.fallbackUrl === null) {
      hideArt();
      return;
    }
    art = { ...art, url: art.fallbackUrl, fallbackUrl: null };
  }

  function openTile(tile: DeckTileModel): void {
    if (tile.bundled) onblockedopen(tile);
    else onopen(tile.key);
  }

  function openSelected(): void {
    if (selectedTile === null) return;
    openTile(selectedTile);
  }

  async function openCompactMenu(): Promise<void> {
    compactMenuOpen = true;
    await tick();
    const firstEnabled = compactMenu?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    if (firstEnabled !== null && firstEnabled !== undefined)
      firstEnabled.focus();
    else compactMenu?.focus();
  }

  function closeCompactMenu(returnFocus = false): void {
    compactMenuOpen = false;
    if (returnFocus) compactKebab?.focus();
  }

  function duplicateSelected(): void {
    if (selectedTile === null) return;
    onduplicate(selectedTile.key);
  }

  /* The footer buttons and the kebab items are two paths to one operation, so
     both raise the same dialog rather than each confirming its own way. */
  function openRename(key: string): void {
    renaming = key;
  }

  function renameSelected(): void {
    if (selectedTile === null) return;
    openRename(selectedTile.key);
  }

  function deleteSelected(): void {
    if (selectedTile === null || !selectedTile.deletable) return;
    deleting = selectedTile.key;
  }

  /** Move the pick among legal decks in the order the grid shows them. */
  function step(delta: number): void {
    const legal = shown.filter((candidate) => candidate.legal);
    const index = legal.findIndex((candidate) => candidate.key === selectedKey);
    const target =
      legal[index < 0 ? (delta > 0 ? 0 : legal.length - 1) : index + delta];
    if (target === undefined) return;
    onselect(target.key);
  }

  /* A dialog or the kebab sheet owns the keyboard while it is up, and a field
     owns typed characters rather than screen shortcuts. */
  function shortcutsInert(event: KeyboardEvent): boolean {
    if (
      menu !== null ||
      compactMenuOpen ||
      renaming !== null ||
      deleting !== null ||
      picking
    )
      return true;
    const target = event.target;
    return (
      target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    );
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (shortcutsInert(event)) return;
    if (event.key === "/") {
      event.preventDefault();
      filterField.focus();
      return;
    }
    /* The grid scrolls, so an unhandled arrow would move the viewport under a
       pick that moved too. */
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      if (mode === "library") openSelected();
      else if (canStart) onstart();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onpointerdown={documentPointerDown} />

{#snippet deckAction(
  action: "delete" | "rename" | "duplicate" | "open" | "create",
  pushed = false,
)}
  {#if action === "delete"}
    <button
      type="button"
      class="secondary act-delete"
      role={compactMenuOpen ? "menuitem" : undefined}
      disabled={selectedTile === null || !selectedTile.deletable}
      data-cy="deck-select-delete"
      onclick={() => {
        closeCompactMenu();
        deleteSelected();
      }}>Delete</button
    >
  {:else if action === "rename"}
    <button
      type="button"
      class="secondary act-rename"
      role={compactMenuOpen ? "menuitem" : undefined}
      disabled={selectedTile === null}
      data-cy="deck-select-rename"
      onclick={() => {
        closeCompactMenu();
        renameSelected();
      }}>Rename</button
    >
  {:else if action === "duplicate"}
    <button
      type="button"
      class="secondary act-duplicate"
      role={compactMenuOpen ? "menuitem" : undefined}
      disabled={selectedTile === null}
      data-cy="deck-select-duplicate"
      onclick={() => {
        closeCompactMenu();
        duplicateSelected();
      }}>Duplicate</button
    >
  {:else if action === "open"}
    <button
      type="button"
      class="secondary"
      class:pushed
      role={compactMenuOpen ? "menuitem" : undefined}
      disabled={selectedTile === null}
      data-cy="deck-select-open"
      onclick={() => {
        closeCompactMenu();
        openSelected();
      }}>Open</button
    >
  {:else}
    <button
      type="button"
      class="act-create"
      role={compactMenuOpen ? "menuitem" : undefined}
      aria-label="Create"
      data-cy="deck-select-create"
      onclick={() => {
        closeCompactMenu();
        oncreate?.();
      }}>Create</button
    >
  {/if}
{/snippet}

{#snippet startButton()}
  <button
    type="button"
    class:start={!narrow}
    disabled={!canStart}
    data-cy="deck-select-start"
    onclick={onstart}>{startLabel}</button
  >
{/snippet}

<section
  class="screen"
  class:paneled={seatPanel || docked}
  class:library={mode === "library"}
  class:compact
  data-cy="deck-select-screen"
>
  {#if mode === "duel-start" && opponent !== null}
    <!-- Player-first order matches the visual columns and the order in which
         the two seat choices are read. -->
    <aside class="seat-panel" data-cy="duel-start-seat-panel">
      <div class="seats" data-cy="deck-select-seats">
        <div class="seat-section player" data-cy="seat-section-player">
          <div class="avatar" data-cy="duel-start-your-avatar">
            <svg
              class="avatar-art"
              viewBox="0 0 120 90"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
              data-cy="duel-start-your-avatar-art"
            >
              <rect
                class="art-field"
                width="120"
                height="90"
                data-cy="duel-start-your-art-field"
              />
              <circle
                class="art-figure"
                cx="60"
                cy="38"
                r="17"
                data-cy="duel-start-your-art-head"
              />
              <path
                class="art-figure"
                d="M24 92 Q60 56 96 92 Z"
                data-cy="duel-start-your-art-shoulders"
              />
            </svg>
            <span class="who" data-cy="duel-start-your-name">You</span>
          </div>

          <button
            type="button"
            class="seat-chip player-chip"
            class:active={seat === "player"}
            aria-pressed={seat === "player"}
            onclick={() => onseat("player")}
            data-cy="duel-start-your-deck"
          >
            {#if playerTile !== null}
              <span class="deck-name" data-cy="duel-start-your-deck-name"
                >{playerTile.name}</span
              >
            {:else}
              <span data-cy="duel-start-your-deck-empty">No deck selected</span>
            {/if}
          </button>

          <div
            class="seat-list"
            class:previewing={playerPreviewing}
            data-cy="deck-select-seat-list-player-wrapper"
          >
            {#if playerList === null}
              <p
                class="seat-list-empty"
                data-cy="deck-select-seat-list-empty-player"
              >
                No list available.
              </p>
            {:else}
              <DecklistPanel
                decklist={playerList}
                cy="deck-select-seat-list-player"
              />
            {/if}
          </div>
        </div>

        <div class="seat-section opponent" data-cy="seat-section-opponent">
          <!-- svelte-ignore a11y_no_static_element_interactions (the handler only
               exists on the button branch; a locked opponent renders an inert div) -->
          <svelte:element
            this={opponent.locked ? "div" : "button"}
            class="avatar"
            class:pressable={!opponent.locked}
            type={opponent.locked ? undefined : "button"}
            aria-label={opponent.locked
              ? undefined
              : `Change opponent: ${opponent.name}`}
            onclick={opponent.locked ? undefined : () => (picking = true)}
            bind:this={portrait}
            data-cy="duel-start-opponent-portrait"
          >
            <svg
              class="avatar-art"
              viewBox="0 0 120 90"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
              data-cy="duel-start-opponent-portrait-art"
            >
              <rect
                class="art-field"
                width="120"
                height="90"
                data-cy="duel-start-opponent-art-field"
              />
              <circle
                class="art-figure"
                cx="60"
                cy="38"
                r="17"
                data-cy="duel-start-opponent-art-head"
              />
              <path
                class="art-figure"
                d="M24 92 Q60 56 96 92 Z"
                data-cy="duel-start-opponent-art-shoulders"
              />
            </svg>
            <span class="who" data-cy="duel-start-opponent-name"
              >{opponent.name}</span
            >
            {#if !opponent.locked}
              <span
                class="change-chip"
                aria-hidden="true"
                data-cy="duel-start-opponent-change-chip">⇄ Change</span
              >
            {/if}
          </svelte:element>

          <div class="opponent-chip-row" data-cy="duel-start-opponent-chip-row">
            <!-- svelte-ignore a11y_no_static_element_interactions (the handler only
                 exists on the button branch; the story's chip is an inert div) -->
            <svelte:element
              this={opponent.locked ? "div" : "button"}
              class="seat-chip opponent-chip"
              class:active={seat === "opponent" && !opponent.locked}
              class:pressable={!opponent.locked}
              type={opponent.locked ? undefined : "button"}
              aria-pressed={opponent.locked ? undefined : seat === "opponent"}
              onclick={opponent.locked ? undefined : toggleOpponentSeat}
              data-cy="duel-start-opponent-deck"
            >
              {#if opponentDeck !== null}
                <span class="deck-name" data-cy="duel-start-opponent-deck-name"
                  >{opponentDeck.name}</span
                >
              {:else}
                <span data-cy="duel-start-opponent-deck-empty"
                  >No deck selected</span
                >
              {/if}
            </svelte:element>
            {#if opponent.locked}
              <p class="locked" data-cy="duel-start-opponent-deck-locked">
                🔒 Set by the story
              </p>
            {/if}
          </div>

          <div
            class="seat-list"
            class:previewing={opponentPreviewing}
            data-cy="deck-select-seat-list-opponent-wrapper"
          >
            {#if opponentList === null}
              <p
                class="seat-list-empty"
                data-cy="deck-select-seat-list-empty-opponent"
              >
                No list available.
              </p>
            {:else}
              <DecklistPanel
                decklist={opponentList}
                cy="deck-select-seat-list-opponent"
              />
            {/if}
          </div>
        </div>
      </div>

      {#if !narrow}
        {@render startButton()}
      {/if}
    </aside>
  {/if}

  <!-- One line for everything the screen says about itself and the two controls
       that change what it shows: mode, name, sort, filter, then its count. -->
  <div class="titlebar" bind:this={titlebar} data-cy="deck-select-titlebar">
    <!-- The phone's Back, in the document whenever there is one at all: the
         footer's button is the wide control and CSS shows whichever one the
         width uses, so the two are one affordance and `showBack` takes both. -->
    {#if showBack}
      <button
        type="button"
        class="back-icon"
        aria-label="Back"
        onclick={onback}
        data-cy="deck-select-back-icon"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          data-cy="deck-select-back-icon-glyph"
        >
          <path d="M12 4 L6 10 L12 16" data-cy="deck-select-back-icon-arrow" />
        </svg>
      </button>
    {/if}
    {#if !compact}
      <p class="eyebrow" data-cy="deck-select-eyebrow">{eyebrow}</p>
    {/if}
    <h1 data-cy="deck-select-title">{compact ? "Select Deck" : title}</h1>
    {#if !compact}
      <span class="sep" aria-hidden="true" data-cy="deck-select-titlebar-sep"
        >·</span
      >
    {/if}
    <!-- The bar reads as a sentence rather than a form, so each control names
         itself to a screen reader alone. -->
    <label data-cy="deck-select-sort-field">
      <span class="visually-hidden" data-cy="deck-select-sort-label">Sort</span>
      <select bind:value={sort} data-cy="deck-select-sort">
        <option value="modified" data-cy="deck-select-sort-option-modified"
          >Last modified</option
        >
        <option value="name" data-cy="deck-select-sort-option-name">Name</option
        >
      </select>
    </label>
    <label class="filter-field" data-cy="deck-select-filter-field">
      <span class="visually-hidden" data-cy="deck-select-filter-label"
        >Filter</span
      >
      <input
        type="search"
        placeholder="Filter decks…"
        bind:value={filter}
        bind:this={filterField}
        data-cy="deck-select-filter"
      />
    </label>
    <p class="count" data-cy="deck-select-count">{countLabel}</p>
  </div>

  <!-- Max-content copy of the full titlebar. It stays measurable while the
       visible bar is compact, which lets the screen restore without guessing
       at a breakpoint. -->
  <div
    class="bar-probe titlebar-probe"
    aria-hidden="true"
    bind:this={titleProbe}
    data-cy="deck-select-titlebar-probe"
  >
    <span class="eyebrow" data-cy="deck-select-titlebar-probe-eyebrow"
      >{eyebrow}</span
    >
    <span class="probe-title" data-cy="deck-select-titlebar-probe-title"
      >{title}</span
    >
    <span class="sep" data-cy="deck-select-titlebar-probe-sep">·</span>
    <select tabindex="-1" data-cy="deck-select-titlebar-probe-sort">
      <option data-cy="deck-select-titlebar-probe-sort-option"
        >Last modified</option
      >
    </select>
    <input
      type="search"
      tabindex="-1"
      placeholder="Filter decks…"
      data-cy="deck-select-titlebar-probe-filter"
    />
    <span class="count" data-cy="deck-select-titlebar-probe-count"
      >{countLabel}</span
    >
  </div>

  <div
    class="grid"
    bind:this={grid}
    onpointerentercapture={enterTile}
    onpointerleavecapture={leaveTile}
    data-cy="deck-select-grid"
  >
    {#each shown as candidate (candidate.key)}
      <DeckTile
        tile={candidate}
        halo={haloFor(candidate)}
        yours={seat === "opponent" && candidate.key === playerDeck?.key}
        onpress={() => onselect(candidate.key)}
        ondblpress={() => openTile(candidate)}
        onrename={manageable ? () => openRename(candidate.key) : null}
        canSetDefault={canSetDefault(candidate)}
        onsetdefault={() => onsetdefault(candidate.key)}
        showMenu={manageable}
        onmenu={(anchor) => (menu = { key: candidate.key, anchor })}
      />
    {/each}
  </div>

  <footer bind:this={footer} data-cy="deck-select-footer">
    {#if showBack}
      <button
        type="button"
        class="return wide-only"
        data-cy="deck-select-back"
        onclick={onback}>{backText}</button
      >
    {/if}
    {#if !compact}
      {#if manageable}
        <div class="manage" data-cy="deck-select-manage">
          {@render deckAction("delete")}
          {@render deckAction("rename")}
          {@render deckAction("duplicate")}
          {#if mode === "duel-start"}
            {@render deckAction("open")}
          {/if}
          {#if oncreate !== null}
            {@render deckAction("create")}
          {/if}
        </div>
      {:else if mode === "duel-start"}
        {@render deckAction("open", true)}
      {/if}
    {/if}
    {#if mode === "duel-start" && narrow}
      {@render startButton()}
    {/if}
    {#if compact && (manageable || mode === "duel-start")}
      <div class="compact-actions" data-cy="deck-select-compact-actions">
        <button
          type="button"
          class="compact-kebab"
          aria-label="Deck actions"
          aria-haspopup="menu"
          aria-expanded={compactMenuOpen}
          aria-controls="deck-select-kebab-menu"
          bind:this={compactKebab}
          data-cy="deck-select-kebab"
          onclick={() =>
            compactMenuOpen ? closeCompactMenu(true) : openCompactMenu()}
          >⋯</button
        >
        {#if compactMenuOpen}
          <div
            id="deck-select-kebab-menu"
            class="compact-menu"
            role="menu"
            tabindex="-1"
            bind:this={compactMenu}
            data-cy="deck-select-kebab-menu"
            onkeydown={(event) =>
              handleModalKeydown(event, () => closeCompactMenu(true))}
          >
            {#if manageable}
              {@render deckAction("delete")}
              {@render deckAction("rename")}
              {@render deckAction("duplicate")}
            {/if}
            {#if mode === "duel-start"}
              {@render deckAction("open")}
            {/if}
            {#if manageable && oncreate !== null}
              {@render deckAction("create")}
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if blockNotice !== null}
      <p class="notice" role="status" data-cy="deck-select-block-notice">
        {blockNotice}
      </p>
    {/if}
  </footer>

  <!-- Footer probe mirrors full action labels and chrome without rendering a
       second control site. Its max-content width remains independent of the
       visible compact menu. -->
  <div
    class="bar-probe footer-probe"
    aria-hidden="true"
    bind:this={footerProbe}
    data-cy="deck-select-footer-probe"
  >
    {#if showBack}
      <span
        class="probe-action probe-return"
        data-cy="deck-select-footer-probe-back">{backText}</span
      >
    {/if}
    {#if manageable}
      <span class="probe-action" data-cy="deck-select-footer-probe-delete"
        >Delete</span
      >
      <span class="probe-action" data-cy="deck-select-footer-probe-rename"
        >Rename</span
      >
      <span class="probe-action" data-cy="deck-select-footer-probe-duplicate"
        >Duplicate</span
      >
      {#if oncreate !== null}
        <span class="probe-action" data-cy="deck-select-footer-probe-create"
          >Create</span
        >
      {/if}
    {/if}
    {#if mode === "duel-start"}
      <span class="probe-action" data-cy="deck-select-footer-probe-open"
        >Open</span
      >
    {/if}
  </div>

  {#if docked}
    <!-- The library's second column, the space duel start seats its opponent
         in. Last in the markup rather than first: it answers a question the
         pointer asked, so a screen reader meets the decks themselves first. -->
    <aside class="dock" data-cy="deck-select-dock">
      {#if dockList === null}
        <p class="dock-empty" data-cy="deck-select-docked-empty">
          Hover a deck to see its list.
        </p>
      {:else}
        <DecklistPanel
          decklist={dockList}
          cy="deck-select-docked-list"
          onrowhover={showArt}
          onrowleave={hideArt}
        />
      {/if}
    </aside>
  {/if}
</section>

{#if art !== null}
  {@const visibleArt = art}
  <img
    class="art-float"
    src={visibleArt.url}
    alt=""
    aria-hidden="true"
    style={visibleArt.place}
    onerror={() => handleArtError(visibleArt.token, visibleArt.url)}
    data-cy="deck-select-card-art-float"
  />
{/if}

{#if menu !== null && menuTile !== null}
  {@const key = menuTile.key}
  <DeckTileMenu
    tile={menuTile}
    anchor={menu.anchor}
    onclose={() => (menu = null)}
    onopen={() => openTile(menuTile)}
    openDisabled={menuTile.bundled}
    openDisabledReason={menuTile.bundled
      ? "Bundled deck: cannot be modified"
      : null}
    onrename={() => openRename(key)}
    onduplicate={() => onduplicate(key)}
    ondelete={() => (deleting = key)}
  />
{/if}

{#if renameTile !== null}
  {@const key = renameTile.key}
  <RenameDeckDialog
    deckName={renameTile.name}
    unavailableNames={renameUnavailableNames}
    oncancel={() => (renaming = null)}
    onsubmit={(name) => {
      onrename(key, name);
      renaming = null;
    }}
  />
{/if}

{#if picking && opponent !== null}
  <div
    class="picker"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="duel-start-opponent-picker-heading"
    data-cy="duel-start-opponent-picker"
    bind:this={picker}
    onkeydown={(event) => handleModalKeydown(event, closePicker)}
  >
    <h2
      id="duel-start-opponent-picker-heading"
      data-cy="duel-start-opponent-picker-heading"
    >
      Choose your opponent
    </h2>
    <div class="options" data-cy="duel-start-opponent-options">
      {#each opponents as option (option.id)}
        <!-- The deck tile's grammar without its stats row: an opponent has a
             name and a line, and nothing to count. -->
        <button
          type="button"
          class="option"
          aria-pressed={option.id === opponent.id}
          onclick={() => pickOpponent(option.id)}
          data-cy={`duel-start-opponent-option-${option.id}`}
        >
          <span
            class="option-name"
            data-cy={`duel-start-opponent-option-name-${option.id}`}
            >{option.name}</span
          >
          <span
            class="option-line"
            data-cy={`duel-start-opponent-option-line-${option.id}`}
            >{option.line}</span
          >
        </button>
      {/each}
    </div>
  </div>
{/if}

{#if deleteTile !== null}
  {@const key = deleteTile.key}
  <DeleteDeckConfirm
    deckName={deleteTile.name}
    oncancel={() => (deleting = null)}
    onconfirm={() => {
      ondelete(key);
      deleting = null;
    }}
  />
{/if}

<style>
  /* The left column of the desktop stage: the title bar and the footer keep
     their height and the grid takes what is left, so only the decks scroll. */
  .screen {
    --p: 8rem;
    --chamfer: 12px;

    position: relative;
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* Invisible full-content bars stay independent of compact rendering. Their
     max-content widths are the threshold, not a viewport guess. */
  .bar-probe {
    position: fixed;
    z-index: -1;
    top: 0;
    left: -100000px;
    display: flex;
    visibility: hidden;
    width: max-content;
    align-items: center;
    white-space: nowrap;
    pointer-events: none;
  }

  .titlebar-probe {
    gap: var(--space-3);
  }

  .probe-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  /* Hidden until the phone layout claims it, where the footer's Back is gone
     and the header is the only place a way out can live. */
  .back-icon {
    display: none;
    width: 2.25rem;
    height: 2.25rem;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--text);
    background: var(--surface-raised);
    cursor: pointer;
  }

  .back-icon svg {
    width: 1rem;
    height: 1rem;
  }

  /* The bar is one line, so nothing in it wraps: identity and count keep their
     words while the filter between them takes the remaining width. */
  .eyebrow {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-display);
    font-size: var(--text-xs);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 400;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .count {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .sep {
    color: var(--gold-line);
  }

  .titlebar input,
  .titlebar select,
  .titlebar-probe input,
  .titlebar-probe select {
    min-height: 2.4rem;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: var(--surface-chain);
    font: inherit;
  }

  /* The filter runs to the pane's edge: it is the one control with nothing to
     say about its own width, so it absorbs whatever the sentence leaves. */
  .filter-field {
    display: flex;
    flex: 1 1 auto;
    min-width: 6rem;
  }

  .titlebar input[type="search"] {
    flex: 1 1 auto;
    min-width: 6rem;
  }

  .grid {
    display: grid;
    overflow-y: auto;
    min-height: 0;
    align-content: start;
    justify-items: center;
    gap: var(--space-2);
    grid-auto-rows: max-content;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    padding-right: var(--space-2);
    scrollbar-gutter: stable;
  }

  .grid > :global(*) {
    width: 100%;
    max-width: 420px;
  }

  /* Stuck to the bottom of whatever scrolls this screen, so the way out and
     the actions on a deck stay reachable while the grid is read. */
  footer {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line-soft);
    background: var(--bg);
  }

  /* Leaving is the one thing the footer says on its left; everything that acts
     on a deck is gathered against the right edge. */
  .manage {
    display: flex;
    margin-left: auto;
    gap: var(--space-2);
  }

  /* The way out, weighted like one: taller than the deck actions beside it and
     the only red on the resting footer. */
  .return {
    min-height: 3.1rem;
    padding: 0 var(--space-5);
    border: 1px solid var(--danger-border);
    color: var(--danger);
    background: var(--danger-surface);
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .return:hover {
    border-color: var(--danger-strong);
    color: var(--ink);
    background: var(--danger-strong);
  }

  .compact .return {
    min-height: 2.5rem;
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .compact-actions {
    position: relative;
    margin-left: auto;
  }

  .compact-kebab {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    padding: 0;
    font-size: var(--text-lg);
  }

  .compact-menu {
    position: absolute;
    z-index: 20;
    right: 0;
    bottom: calc(100% + var(--space-2));
    display: grid;
    min-width: 11rem;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--gold-line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    box-shadow: 0 0.5rem 1.5rem var(--shadow);
  }

  .compact-menu button {
    width: 100%;
    white-space: nowrap;
    text-align: left;
  }

  .footer-probe {
    gap: var(--space-2);
  }

  .probe-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    padding: 0.7rem 1rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    font-weight: 750;
  }

  .probe-return {
    min-height: 3.1rem;
    padding-inline: var(--space-5);
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  /* One hue per operation, tinted while it rests and solid under the pointer,
     so the destructive one never reads the same as the rest. Open keeps the
     neutral secondary: it opens a deck rather than changing one. */
  .act-delete {
    border-color: var(--danger-border);
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, var(--surface-raised));
  }

  .act-delete:hover:not(:disabled) {
    border-color: var(--danger-strong);
    color: var(--ink);
    background: var(--danger-strong);
  }

  .act-rename {
    border-color: color-mix(in srgb, var(--selected) 55%, transparent);
    color: var(--selected);
    background: color-mix(in srgb, var(--selected) 12%, var(--surface-raised));
  }

  .act-rename:hover:not(:disabled) {
    border-color: var(--selected);
    color: var(--ink-on-accent);
    background: var(--selected);
  }

  .act-duplicate {
    border-color: color-mix(in srgb, var(--seat-you) 55%, transparent);
    color: var(--seat-you);
    background: color-mix(in srgb, var(--seat-you) 12%, var(--surface-raised));
  }

  .act-duplicate:hover:not(:disabled) {
    border-color: var(--seat-you);
    color: var(--ink);
    background: color-mix(in srgb, var(--seat-you) 55%, var(--surface-raised));
  }

  /* The only solid fill in the cluster: the one action that adds a deck rather
     than acting on the one already picked. */
  .act-create {
    border-color: var(--legal);
    color: var(--ink-on-legal);
    background: var(--legal);
    font-weight: 650;
  }

  /* The fill is restated rather than left to the rest state above: the global
     `button:hover` paints gold, and only a rule of this weight keeps green. */
  .act-create:hover:not(:disabled) {
    background: var(--legal);
    filter: brightness(1.08);
  }

  /* Nothing holds the left edge when the management cluster is gone, so the
     screen's own actions claim the right edge themselves. */
  .pushed {
    margin-left: auto;
  }

  footer button {
    min-height: 2.75rem;
  }

  .notice {
    flex-basis: 100%;
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  /* Library keeps its existing dock width; duel start spends a fixed 38rem on
     two complete seat columns. */
  .screen.paneled {
    grid-template-columns: minmax(0, 73fr) minmax(17rem, 27fr);
  }

  .screen.paneled:not(.library) {
    grid-template-columns: minmax(0, 73fr) 38rem;
  }

  .seat-panel,
  .dock {
    min-height: 0;
    grid-row: 1 / -1;
    grid-column: 2;
  }

  .seat-panel {
    display: grid;
    overflow: hidden;
    grid-template-rows: minmax(0, 1fr) max-content;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line-soft);
    border-left-color: var(--gold-line);
    background: var(--glass);
  }

  .dock {
    display: grid;
    overflow-y: auto;
    align-content: start;
    grid-auto-rows: max-content;
    gap: var(--space-2);
    padding-left: var(--space-3);
    border-left: 1px solid var(--border);
  }

  /* The design's 62rem breakpoint, measured on the viewport rather than on a
     container: this screen fills the stage, and the collapse stacks the panel
     above the grid it belongs to. */
  @media (max-width: 62rem) {
    .screen.paneled,
    .screen.paneled:not(.library) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto minmax(0, 1fr) auto;
    }

    .seat-panel,
    .dock {
      grid-row: 1;
      grid-column: 1;
    }

    .seat-panel {
      border-left-color: var(--line-soft);
      border-bottom-color: var(--gold-line);
    }

    .dock {
      padding-bottom: var(--space-2);
      padding-left: 0;
      border-bottom: 1px solid var(--border);
      border-left: 0;
    }
  }

  /* The phone layout, at the design's 430px frame. Title bar, opponent, one
     column of decks, sticky footer — the same markup, re-ordered. */
  @media (max-width: 40rem) {
    /* No width holds the whole sentence on a phone, so the bar becomes as many
       lines as it needs rather than running off the screen's edge. */
    .titlebar {
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .back-icon {
      display: grid;
    }

    /* Row 1 is the title bar here rather than the panel: the phone says which
       screen you are on before who it is seating. The other three rows
       auto-place around this one in document order. */
    .screen.paneled .seat-panel {
      grid-row: 2;
    }

    .screen .seats {
      grid-template-columns: minmax(0, 1fr);
    }

    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    footer {
      position: sticky;
      bottom: 0;
      padding-top: var(--space-2);
      border-top: 1px solid var(--border);
      background: var(--bg);
    }

    /* Deck edits live on each card's kebab on a phone. Creating has no card
       anchor, so it stays in the library footer. */
    .compact-actions,
    .wide-only,
    .manage > :not(.act-create) {
      display: none;
    }

    footer button {
      width: 100%;
    }
  }

  .seats {
    display: grid;
    min-height: 0;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .seat-section {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: max-content max-content minmax(0, 1fr);
    gap: var(--space-2);
  }

  .avatar {
    position: relative;
    display: block;
    width: 100%;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: inherit;
    background: var(--surface-panel);
    font: inherit;
  }

  .avatar-art {
    display: block;
    width: 100%;
    height: var(--p);
  }

  .art-field {
    fill: var(--surface-panel);
  }

  .player .art-figure {
    fill: color-mix(in srgb, var(--seat-you) 26%, transparent);
  }

  .opponent .art-figure {
    fill: color-mix(in srgb, var(--seat-opponent) 26%, transparent);
  }

  .who,
  .change-chip {
    position: absolute;
    padding: 0.15rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--shadow) 72%, transparent);
    font-family: var(--font-display);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .who {
    bottom: var(--space-2);
    left: var(--space-2);
    color: var(--text);
    letter-spacing: 0.12em;
  }

  /* Opponent avatar remains its picker trigger; this hint appears when mouse
     or keyboard reaches it. */
  .change-chip {
    top: var(--space-2);
    right: var(--space-2);
    color: var(--muted);
    opacity: 0;
  }

  .avatar:hover .change-chip,
  .avatar:focus-visible .change-chip {
    border-color: var(--accent);
    color: var(--accent);
    opacity: 1;
  }

  @media (pointer: coarse), (max-width: 40rem) {
    .change-chip {
      opacity: 1;
    }
  }

  .seat-chip {
    display: block;
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    border: 1px solid var(--line-soft);
    color: var(--text);
    background: var(--glass-strong);
    clip-path: polygon(
      0 0,
      calc(100% - var(--chamfer)) 0,
      100% var(--chamfer),
      100% 100%,
      var(--chamfer) 100%,
      0 calc(100% - var(--chamfer))
    );
    font: inherit;
    text-align: left;
  }

  .player-chip {
    border-left: 3px solid var(--seat-you);
  }

  .opponent-chip {
    border-left: 3px solid var(--seat-opponent);
  }

  .seat-chip.active {
    outline: 2px solid var(--selected);
    outline-offset: 2px;
  }

  .seat-chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .deck-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .opponent-chip-row {
    display: grid;
    gap: var(--space-1);
  }

  .seat-list {
    display: block;
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--space-1);
    scrollbar-gutter: stable;
  }

  .seat-list.previewing {
    outline: 1px dashed var(--selected);
    outline-offset: 3px;
  }

  .seat-list-empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .start {
    width: 100%;
    min-height: 3.1rem;
    border-color: var(--accent);
    color: var(--ink-on-accent);
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    clip-path: polygon(
      0 0,
      calc(100% - var(--chamfer)) 0,
      100% var(--chamfer),
      100% 100%,
      var(--chamfer) 100%,
      0 calc(100% - var(--chamfer))
    );
    font-family: var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .pressable {
    cursor: pointer;
  }

  .locked {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .picker {
    position: fixed;
    z-index: 30;
    display: grid;
    inset: 50% auto auto 50%;
    width: min(26rem, 92vw);
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    transform: translate(-50%, -50%);
  }

  /* `display: grid` above beats the user-agent `[hidden]` rule, so a host that
     hides the picker with the attribute would still see it on screen. The
     attribute is marked global because nothing here renders it statically and
     the compiler would otherwise prune the guard as an unused selector. */
  .picker:global([hidden]) {
    display: none;
  }

  .picker h2 {
    margin: 0;
    font-size: var(--text-md);
  }

  .options {
    display: grid;
    gap: var(--space-2);
  }

  .option {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    background: var(--surface-panel);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .option[aria-pressed="true"] {
    border-color: var(--seat-opponent);
  }

  .option-name {
    font-size: var(--text-md);
    font-weight: 650;
  }

  .option-line {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  /* `display: grid` on `.seat-panel, .dock` beats the user-agent `[hidden]`
     rule, so a host that hides the dock with the attribute would still see it
     on screen. Global for the same reason as the picker's guard: nothing here
     renders the attribute statically. */
  .dock:global([hidden]) {
    display: none;
  }

  .dock-empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  /* The full card scan the docked row names. Inline geometry preserves the
     printed ratio and clamps every edge; styling stays Basilica Slate chrome. */
  .art-float {
    position: fixed;
    z-index: 25;
    display: block;
    object-fit: contain;
    border: 1px solid var(--gold-line);
    border-radius: var(--radius-md);
    background: var(--surface-panel);
    box-shadow: 0 0.5rem 1.5rem var(--shadow);
    pointer-events: none;
  }

  .art-float:global([hidden]) {
    display: none;
  }
</style>
