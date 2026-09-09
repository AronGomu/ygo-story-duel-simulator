<script lang="ts">
  import { getContext, onMount } from "svelte";
  import type { BattleRequest, SelectableDeck } from "../../battle/index.ts";
  import {
    DeckSelectScreen,
    type DecklistRow,
    type DecklistView,
    type OpponentView,
  } from "../../deck-select/index.ts";
  import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
  import { catalogByCode } from "../../decks/catalog/pinned-ruleset.ts";
  import { cardFrameOf } from "../../decks/card-frame.ts";
  import { croppedCardImageUrl } from "../../decks/deck-cover.ts";
  import { runtimeCatalog } from "../../decks/catalog/runtime-catalog.ts";
  import { IndexedDbDeckRepository } from "../../decks/indexeddb-deck-repository.ts";
  import type {
    BattleDeckModule,
    BattleDomainLoader,
  } from "../domain-loaders.ts";
  import {
    deleteLocalDeck,
    duplicateLocalDeck,
    parseLocalDeckKey,
    renameLocalDeck,
    setDefaultLocalDeck,
  } from "./free-play-deck-actions.ts";
  import {
    freePlayBattleModule,
    listedFreePlayDecks,
    refreshFreePlayDecks,
  } from "./free-play-deck-listing.ts";
  import { freePlayDeckTile } from "./free-play-deck-tiles.ts";
  import {
    DEFAULT_FREE_PLAY_OPPONENT_ID,
    FREE_PLAY_OPPONENTS,
    freePlayOpponent,
    type FreePlayOpponent,
  } from "./free-play-opponents.ts";
  import type { ShellSettingsStore } from "../settings/shell-settings-store.ts";
  import {
    TOAST_CONTEXT_KEY,
    type ToastPublisher,
  } from "../toast/toast-context.ts";
  import DomainLoadError from "./DomainLoadError.svelte";

  export let settings: ShellSettingsStore;
  /* The battle entry, loaded rather than imported: it also exports the duel,
     and a static import here would make the largest chunk in the build eager.
     Typed to the deck half of that entry, so this screen cannot mount a duel —
     that stays the shell's own duel region, which the stage geometry measures
     against (`src/battle/app/presentation/stage-frame.ts`). */
  export let loadBattle: BattleDomainLoader | (() => Promise<BattleDeckModule>);
  export let onstart: (request: BattleRequest) => void = () => undefined;
  export let onback: () => void = () => undefined;
  /* Leaving the seat for the library it is filled from. Reported rather than
     routed, because the deck editor is a route the shell owns the URL of. */
  export let ondecks: () => void = () => undefined;
  /* Leaving it for one local deck's own page in that editor, reported for the
     same reason. Bundled decks are blocked before this callback and warn. */
  export let onopendeck: (id: string) => void = () => undefined;

  let battle: BattleDeckModule | null = null;
  let decks: readonly SelectableDeck[] = [];
  /* Card art and card names, for the covers and the hover decklists. Empty
     until the packaged database answers, which is a fetch the seats never wait
     on: a tile with no cover draws its own placeholder. */
  let catalog: ReadonlyMap<number, DeckBuilderCardView> = new Map();
  let defaultDeckId: string | null = null;
  let playerKey = "";
  let opponentKey = "";
  /* Which seat the grid is filling. The player's own, until they press the
     opponent's card to browse for the deck they want to face. */
  let seat: "player" | "opponent" = "player";
  let startError: string | null = null;
  /* A deck-library write the library refused. Kept apart from `startError`
     because it is a different fact about a different press, and shown in the
     same one notice slot. */
  let manageError: string | null = null;
  /* The battle chunk itself never arrived. It is the duel domain failing one
     screen earlier than it used to, so it is reported as the duel failing:
     a stale dev server or a half-cached build looks the same from here. */
  let loadError: unknown = null;
  const toasts = getContext<ToastPublisher | undefined>(TOAST_CONTEXT_KEY);
  const BUNDLED_OPEN_REFUSAL = "Bundled deck: cannot be modified";

  /* Only exclusive roster ownership belongs on a tile. Shared decks remain
     bundled/read-only without falsely naming one of their personas as owner. */
  const aiOwnerByDeckKey = new Map(
    FREE_PLAY_OPPONENTS.filter(
      ({ deckKey }) =>
        FREE_PLAY_OPPONENTS.filter((opponent) => opponent.deckKey === deckKey)
          .length === 1,
    ).map(({ deckKey, name }) => [deckKey, name]),
  );

  $: ready = battle !== null;
  $: persona = freePlayOpponent(
    $settings.freePlayOpponentId ?? DEFAULT_FREE_PLAY_OPPONENT_ID,
  );
  $: tiles = decks.map((deck) =>
    freePlayDeckTile(deck, {
      catalog,
      defaultDeckId,
      aiOwnerByDeckKey,
    }),
  );
  $: playerDeck = tiles.find((tile) => tile.key === playerKey) ?? null;
  $: opponentDeck = tiles.find((tile) => tile.key === opponentKey) ?? null;
  /* Both seats, or no match: a request is two decks, and a seat that resolves
     to nothing is a duel the Worker would refuse after the click. */
  $: canStart = ready && playerKey !== "" && opponentKey !== "";
  /* One notice slot, and the refusal outranks the wait: a player who pressed
     Start is owed the reason it did not run. Every press clears both errors
     before it acts, so the slot always holds the most recent one. */
  $: blockNotice =
    startError ?? manageError ?? (ready ? null : "Reading your deck library…");

  onMount(() => {
    let cancelled = false;
    const alive = () => !cancelled;
    void loadListing(alive);
    /* Neither fills a seat, so neither is awaited before decks are on screen:
       art decorates tiles; default marks a deck already selectable. */
    void loadCatalog(alive);
    void loadLibraryFlags(alive);
    return () => {
      cancelled = true;
    };
  });

  async function loadListing(alive: () => boolean): Promise<void> {
    try {
      const loaded = await freePlayBattleModule(loadBattle);
      if (!alive()) return;
      battle = loaded;
      /* Whatever is already known, so the seats fill on the first paint: the
         listing this page last read, or the bundled decks alone, which are
         compiled into this build and need no read at all. */
      adoptDecks(
        loaded,
        listedFreePlayDecks() ??
          loaded.presetSelectableDecks(loaded.DECK_CATALOG),
      );
      const listed = await refreshFreePlayDecks(loadBattle);
      if (!alive()) return;
      adoptDecks(loaded, listed);
    } catch (error) {
      if (alive()) loadError = error;
    }
  }

  async function loadCatalog(alive: () => boolean): Promise<void> {
    try {
      const cards = await runtimeCatalog();
      if (alive()) catalog = catalogByCode(cards);
    } catch {
      /* No art and no card names. Every tile draws its own placeholder and a
         decklist row falls back to the code, which is still a deck the player
         can pick and play. */
    }
  }

  /* Default deck comes from the local library. Failure costs its mark, not the
     match: bundled decks remain compiled into this build. */
  async function loadLibraryFlags(alive: () => boolean): Promise<void> {
    let repository: IndexedDbDeckRepository | null = null;
    try {
      repository = await IndexedDbDeckRepository.open();
      const preferred = await repository.getDefaultDeck();
      if (alive()) defaultDeckId = preferred;
    } catch {
      // No default; decks themselves remain listed.
    } finally {
      repository?.close();
    }
  }

  /* A listing, and the seats that survive it. Each seat keeps what it already
     shows — the bundled list is replaced by the full one a moment later, and a
     choice made in between is the player's — then falls back to the pairing
     they last played, then to the bundled default. A deck deleted, or edited
     since — the key carries the revision — simply does not resolve, so no seat
     ever names a deck the grid does not show. */
  function adoptDecks(
    loaded: BattleDeckModule,
    listed: readonly SelectableDeck[],
  ): void {
    decks = listed;
    const remembered = $settings.freePlayPairing;
    playerKey = seatKey(
      loaded,
      listed,
      [playerKey, remembered?.player],
      `preset:${loaded.DEFAULT_PLAYER_DECK_ID}`,
    );
    /* The opponent's own deck is the persona's, so the seat falls back to
       whichever AI the player last faced rather than to a fixed preset. */
    opponentKey = seatKey(
      loaded,
      listed,
      [opponentKey, remembered?.opponent],
      persona.deckKey,
    );
  }

  function seatKey(
    loaded: BattleDeckModule,
    listed: readonly SelectableDeck[],
    candidates: readonly (string | undefined)[],
    fallback: string,
  ): string {
    for (const candidate of candidates)
      if (
        candidate !== undefined &&
        candidate !== "" &&
        loaded.findSelectableDeck(listed, candidate) !== null
      )
        return candidate;
    /* The bundled default is normally there — it is compiled into this build —
       but a listing that answered with nothing at all must not preselect a row
       the grid does not show, or Start would run a deck nobody can see. */
    return loaded.findSelectableDeck(listed, fallback) === null ? "" : fallback;
  }

  function opponentView(option: FreePlayOpponent): OpponentView {
    /* Never locked: the story fixes who you face, free play is where the
       choice lives. */
    return {
      id: option.id,
      name: option.name,
      line: option.line,
      locked: false,
    };
  }

  /* The grid fills whichever seat is active, so one press means two things and
     the seat card is what says which. */
  function select(key: string): void {
    startError = null;
    manageError = null;
    if (seat === "player") playerKey = key;
    else opponentKey = key;
  }

  /* One library write, then the listing again: the grid and both seats are
     re-read rather than patched, because every operation moves the key of the
     deck it touched — a save bumps the revision the key carries, a delete
     takes the row away entirely. A refusal changes nothing and is reported
     where every other refusal on this screen is. */
  async function manage(
    write: () => Promise<void>,
    refusal: string,
  ): Promise<readonly SelectableDeck[] | null> {
    startError = null;
    manageError = null;
    try {
      await write();
      return await refreshFreePlayDecks(loadBattle);
    } catch (error) {
      manageError = `${refusal}: ${error instanceof Error ? error.message : "Unknown error"}`;
      return null;
    }
  }

  async function setDefaultDeck(key: string): Promise<void> {
    startError = null;
    manageError = null;
    try {
      defaultDeckId = await setDefaultLocalDeck(key);
    } catch (error) {
      manageError = `Default deck could not be set: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  async function renameDeck(key: string, name: string): Promise<void> {
    const loaded = battle;
    if (loaded === null) return;
    const listed = await manage(
      () => renameLocalDeck(key, name),
      "Deck could not be renamed",
    );
    if (listed === null) return;
    /* The deck under the key it carries now, so a seat showing it follows the
       rename instead of falling back to a deck the player did not choose. */
    const moved = movedKey(listed, key);
    if (moved !== null) {
      if (playerKey === key) playerKey = moved;
      if (opponentKey === key) opponentKey = moved;
    }
    adoptDecks(loaded, listed);
  }

  async function duplicateDeck(key: string): Promise<void> {
    const loaded = battle;
    if (loaded === null) return;
    const source = loaded.findSelectableDeck(decks, key);
    if (source === null) return;
    const listed = await manage(
      () =>
        duplicateLocalDeck(
          key,
          source.selection.kind === "preset"
            ? { name: source.label, lists: source.lists }
            : undefined,
        ),
      "Deck could not be duplicated",
    );
    if (listed === null) return;
    /* The copy is handed straight to the seat being filled: duplicating a deck
       is how a player starts from one they already have. */
    const copy = newestLocalKey(listed);
    if (copy !== null) select(copy);
    adoptDecks(loaded, listed);
  }

  async function deleteDeck(key: string): Promise<void> {
    const loaded = battle;
    if (loaded === null) return;
    const listed = await manage(
      () => deleteLocalDeck(key),
      "Deck could not be deleted",
    );
    if (listed === null) return;
    /* Nothing to re-point: the deleted key resolves to nothing now, so a seat
       holding it falls through the chain `adoptDecks` already owns. */
    adoptDecks(loaded, listed);
  }

  /* Deck-select filters bundled keys before this callback, so every key here
     names an editor record rather than a preset. */
  function openDeck(key: string): void {
    const local = parseLocalDeckKey(key);
    if (local !== null) onopendeck(local.id);
  }

  function blockedOpen(): void {
    startError = null;
    if (toasts === undefined) manageError = BUNDLED_OPEN_REFUSAL;
    else {
      manageError = null;
      toasts.show({ message: BUNDLED_OPEN_REFUSAL, tone: "warning" });
    }
  }

  /** The deck `key` named, under the key it carries now. */
  function movedKey(
    listed: readonly SelectableDeck[],
    key: string,
  ): string | null {
    const local = parseLocalDeckKey(key);
    if (local === null) return null;
    const prefix = `local:${local.id}:`;
    return listed.find((deck) => deck.key.startsWith(prefix))?.key ?? null;
  }

  /** The most recently saved deck the player built, which is the copy a
      duplicate wrote a moment ago. */
  function newestLocalKey(listed: readonly SelectableDeck[]): string | null {
    let newest: SelectableDeck | null = null;
    for (const deck of listed)
      if (
        deck.source === "local" &&
        (newest === null || (deck.updatedAt ?? "") > (newest.updatedAt ?? ""))
      )
        newest = deck;
    return newest?.key ?? null;
  }

  function pickOpponent(id: string): void {
    startError = null;
    settings.rememberFreePlayOpponent(id);
    /* Picking an AI brings its deck along, and hands the grid back to the
       player: their own deck is the question this screen was opened to ask.
       Pressing the opponent's card is how that deck is then overridden for one
       duel, which is a choice about this match rather than about the roster. */
    opponentKey = freePlayOpponent(id).deckKey;
    seat = "player";
  }

  async function decklistFor(key: string): Promise<DecklistView | null> {
    const deck = battle?.findSelectableDeck(decks, key) ?? null;
    if (deck === null) return null;
    return {
      main: decklistRows(deck.lists.main),
      extra: decklistRows(deck.lists.extra),
      side: decklistRows(deck.lists.side),
    };
  }

  /* The code is the fallback name rather than an empty row: a card the packaged
     database has not answered for yet is still one of the forty. */
  function decklistRows(codes: readonly number[]): readonly DecklistRow[] {
    return codes.map((code) => {
      const card = catalog.get(code);
      return {
        code,
        name: card?.name ?? String(code),
        frame: cardFrameOf(card?.rawType ?? 0),
        artUrl: croppedCardImageUrl(card?.imageUrl ?? null),
      };
    });
  }

  function cardImageFor(code: number): string | null {
    return catalog.get(code)?.imageUrl ?? null;
  }

  function start(): void {
    startError = null;
    if (battle === null) return;
    const player = battle.findSelectableDeck(decks, playerKey);
    const opponent = battle.findSelectableDeck(decks, opponentKey);
    /* Reachable when the library changed in another tab since the listing. */
    if (player === null || opponent === null) {
      startError = "A deck you chose is no longer available. Choose another.";
      return;
    }
    let request: BattleRequest;
    /* The duel's own parser, run before the duel mounts: a deck edited to 39
       cards after it was remembered names the rule it broke here, rather than
       taking the player into a duel that dies on creation. */
    try {
      request = battle.parseBattleRequest({
        player: player.selection,
        opponent: opponent.selection,
      });
    } catch (error) {
      startError =
        error instanceof Error
          ? `That pairing cannot be played: ${error.message}`
          : "That pairing cannot be played.";
      return;
    }
    settings.rememberFreePlayPairing({
      player: playerKey,
      opponent: opponentKey,
    });
    onstart(request);
  }
</script>

{#if loadError !== null}
  <DomainLoadError label="Duel Simulator" cy="duel" error={loadError} />
{:else}
  <DeckSelectScreen
    mode="duel-start"
    eyebrow="Free play"
    title="Choose your deck"
    backLabel="Menu"
    {tiles}
    selectedKey={playerKey === "" ? null : playerKey}
    {canStart}
    {blockNotice}
    opponent={opponentView(persona)}
    opponents={FREE_PLAY_OPPONENTS.map(opponentView)}
    {opponentDeck}
    {playerDeck}
    {seat}
    {decklistFor}
    {cardImageFor}
    onseat={(next) => (seat = next)}
    onpickopponent={pickOpponent}
    onselect={select}
    onsetdefault={(key) => void setDefaultDeck(key)}
    onstart={start}
    onback={() => onback()}
    onopen={openDeck}
    onblockedopen={blockedOpen}
    oncreate={ondecks}
    onrename={(key, name) => void renameDeck(key, name)}
    onduplicate={(key) => void duplicateDeck(key)}
    ondelete={(key) => void deleteDeck(key)}
  />
{/if}
