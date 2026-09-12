<script lang="ts">
  import { onMount, setContext } from "svelte";
  import { readonly, writable } from "svelte/store";
  import type { CoreBootstrap } from "../content/index.ts";
  import {
    loadCoreStartup,
    routeForCoreGate,
    type CoreGate,
  } from "./core/core-gate.ts";
  import {
    DEFAULT_DOMAIN_LOADERS,
    type DomainLoaders,
  } from "./domain-loaders.ts";
  import { createHandoffCoordinator } from "./handoff/handoff-coordinator.ts";
  import { storyBattleRequest } from "./handoff/story-battle-request.ts";
  import { STAGE_CONTEXT_KEY, TOAST_CONTEXT_KEY } from "./index.ts";
  import ToastHost from "./toast/ToastHost.svelte";
  import { createToastStore } from "./toast/toast-store.ts";
  import {
    collectionRoute,
    deckRoute,
    deckRouteContext,
    HOME_ROUTE,
    INSTALL_CONTENT_ROUTE,
    routeLabel,
    type AppRoute,
    type RouteContext,
  } from "./routes.ts";
  import { deckId } from "../decks/index.ts";
  import type { DeckContext } from "../decks/deck-repository-context.ts";
  import {
    unlimitedCardOwnership,
    type CardOwnership,
  } from "../decks/card-ownership.ts";
  import DomainLoadError from "./screens/DomainLoadError.svelte";
  import InstallContentScreen from "./screens/InstallContentScreen.svelte";
  import MainMenuScreen from "./screens/MainMenuScreen.svelte";
  import type { BattleFacadeResult, BattleRequest } from "../battle/index.ts";
  import type {
    CollectionCatalog,
    StoryDuelResolution,
    StoryEncounterRequest,
    StorySaveRepository,
    StorySlotKey,
    StoryState,
  } from "../story/index.ts";
  import {
    createShellSettingsStore,
    type ShellSettingsStore,
  } from "./settings/shell-settings-store.ts";
  import {
    createShellStore,
    writeLocationHash,
    type ShellStore,
    type StoryEntryIntent,
  } from "./shell-store.ts";
  import { computeStageBox, type StageBox } from "./stage-layout.ts";

  export let store: ShellStore = createShellStore(
    globalThis.location.hash,
    writeLocationHash,
  );
  export let loaders: DomainLoaders = DEFAULT_DOMAIN_LOADERS;
  export let settings: ShellSettingsStore = createShellSettingsStore();
  export let initialCoreGate: CoreGate | null = null;
  export let initialCoreBootstrap: CoreBootstrap | null = null;
  let coreGate: CoreGate = initialCoreGate ?? { kind: "checking" };
  let coreBootstrap: CoreBootstrap | null = initialCoreBootstrap;
  /* Story progress is written by the shell only for the pre-duel checkpoint.
     The default reaches the repository through the visual novel's own lazy
     chunk, so `#/free-play` and its decks never load the story to hold it. */
  export let saves: StorySaveRepository | null = null;

  let stage: HTMLElement | undefined;
  let storySaves: Promise<StorySaveRepository> | null = null;
  /* The two decks the match setup produced, and what decides whether
     `#/free-play` shows that setup or the duel: no request is the screen where
     both seats are chosen, a request is the duel it names. Held as one object
     for the whole match — the
     duel dispatches a request once per identity, so rebuilding an equal one
     here would restart the duel on every flush. */
  let matchRequest: BattleRequest | null = null;
  /* The same state for a story encounter, and held for the same reason: one
     frozen object for the whole duel. `null` is a session the shell could not
     build a request for, which leaves the duel to open its own picker rather
     than throwing the player out of an encounter that is already checkpointed. */
  let sessionRequest: BattleRequest | null = null;

  async function openStorySaves(): Promise<StorySaveRepository> {
    storySaves ??= import("../story/index.ts").then((story) =>
      story.createStorySaveRepository(globalThis.indexedDB),
    );
    return await storySaves;
  }

  const lazySaves: StorySaveRepository = {
    read: async (slot: StorySlotKey) =>
      await (await openStorySaves()).read(slot),
    write: async (
      slot: StorySlotKey,
      state: StoryState,
      expected: number | null,
    ) => await (await openStorySaves()).write(slot, state, expected),
    list: async () => await (await openStorySaves()).list(),
    clear: async (slot: StorySlotKey) => {
      await (await openStorySaves()).clear(slot);
    },
  };

  /* The story builds its own deck context: the repository over the save, what
     that save owns and the name the editor puts on screen all come out of one
     read, so no pairing of them can be got wrong here (ADR-050). Reached
     through the same lazy import as the saves above — a static one would make
     the visual novel eager and collapse its chunk into the entry. */
  async function openStoryDeckContext(): Promise<DeckContext | null> {
    const story = await import("../story/index.ts");
    return await story.openStoryDeckContext(saves ?? lazySaves);
  }

  /* What the story is handed when it comes back from a duel: the state that
     was checkpointed before it started, and the one result it produced. Held
     only until the story adopts it, so a later remount cannot replay it. */
  let handback: {
    readonly state: StoryState;
    readonly resolution: StoryDuelResolution | null;
  } | null = null;
  let sessionHandoffId: string | null = null;
  let sessionReady = false;
  /* The session the mounted duel belongs to. `syncSession` below runs as a
     pre-effect, so the route has already left the session by the time the duel
     region is torn down; this holds the id until that teardown result has been
     handed over, and only `settleSession` or a new session clears it. */
  let hostedHandoffId: string | null = null;

  const handoff = createHandoffCoordinator({
    saves: saves ?? lazySaves,
    navigate: (target, options) => store.navigate(target, options),
    onResolution: (resolution) => {
      /* `onRestore` always ran first: a resolution can only exist for a duel
         whose checkpoint this coordinator wrote or restored. */
      if (handback !== null) handback = { state: handback.state, resolution };
    },
    onRestore: (state) => {
      handback = { state, resolution: null };
    },
  });

  /* Built before the checkpoint is written, and set before the navigation that
     mounts the duel: `App` decides whether to open its own deck picker from the
     request it is handed on mount, so a request arriving one flush late would
     leave the picker over a duel that had already started from it. */
  async function startEncounter(request: StoryEncounterRequest) {
    let built: BattleRequest;
    try {
      built = storyBattleRequest(await loaders.duel(), request.deck);
    } catch (error) {
      /* The duel's own parser refused the snapshot the briefing accepted, which
         means the two contracts drifted apart. The story says so and keeps the
         player on the screen they can change the deck from. */
      if (error instanceof Error && error.name === "BattleRequestError")
        return "deck-rejected" as const;
      throw error;
    }
    sessionRequest = built;
    const outcome = await handoff.begin(
      {
        handoffId: crypto.randomUUID(),
        encounterId: request.encounterId,
        label: request.label,
      },
      request.state,
    );
    if (outcome !== "ready") sessionRequest = null;
    return outcome;
  }

  /** The request a resumed session runs on, rebuilt from the checkpoint.

      A reload has nothing in memory, and the checkpoint carries the whole save
      — its decks, its default and its collection — so the deck resolves to the
      same snapshot the encounter started with. Reached through the story's lazy
      entry, which the checkpoint read on this route has already loaded, and
      through `loaders.duel()`, which the duel about to mount needs anyway. */
  async function restoredSessionRequest(
    state: StoryState,
  ): Promise<BattleRequest | null> {
    try {
      const story = await import("../story/index.ts");
      const deck = await story.encounterDeck(state);
      /* The battle module is asked for second and only when there is a deck to
         seat with it: a checkpoint naming no fieldable deck must not pay for
         the largest chunk in the build to learn that. */
      return deck === null
        ? null
        : storyBattleRequest(await loaders.duel(), deck);
    } catch {
      return null;
    }
  }

  function settleSession(result: BattleFacadeResult): void {
    const settled = hostedHandoffId;
    hostedHandoffId = null;
    if (settled !== null) handoff.settle(settled, result);
  }

  /* A duel only mounts once its checkpoint has been found, so a route nobody
     can resume never becomes half a duel: `resume` sends it back to the story
     itself, and this region shows only that it is still looking. */
  function syncSession(current: AppRoute): void {
    if (current.kind !== "duel-session") {
      sessionHandoffId = null;
      sessionReady = false;
      sessionRequest = null;
      /* Leaving a session for free play is a mode change the player asked for,
         so the abort its teardown produces belongs to nobody: settling it here
         would send them straight back to the story they just left. Every other
         route the duel unmounts on still owes the story that abort. */
      if (current.kind === "free-play") hostedHandoffId = null;
      return;
    }
    if (sessionHandoffId === current.handoffId) return;
    const requested: string = current.handoffId;
    sessionHandoffId = requested;
    sessionReady = false;
    void handoff.resume(requested).then(async (outcome) => {
      if (sessionHandoffId !== requested) return;
      /* Only ever the reload: the encounter that started this session in this
         tab already built its request, and rebuilding it would hand the duel a
         second object and restart the match it is running. `resume` restores
         the checkpoint before it answers, so the state is there to rebuild
         from whenever it answered `restored`. */
      const restored = handback?.state ?? null;
      if (
        outcome === "restored" &&
        sessionRequest === null &&
        restored !== null
      ) {
        const rebuilt = await restoredSessionRequest(restored);
        if (sessionHandoffId !== requested) return;
        sessionRequest = rebuilt;
      }
      sessionReady = outcome === "restored";
      if (sessionReady) hostedHandoffId = requested;
    });
  }

  let requestedRoute: AppRoute = HOME_ROUTE;
  let route: AppRoute;
  let previousRoute: AppRoute | null = null;
  let storyEntryIntent: StoryEntryIntent | null = null;
  const unsubscribe = store.subscribe((state) => {
    requestedRoute = state.route;
    previousRoute = state.previousRoute;
    storyEntryIntent = state.storyEntryIntent;
  });
  /* Project the requested route before every reactive binding below. During the
     bootstrap check a direct gameplay hash already renders CORE; once failure is
     known, replace that unsafe history entry with the canonical installer. */
  $: route = routeForCoreGate(requestedRoute, coreGate);
  $: if (
    coreGate.kind === "locked" &&
    requestedRoute.kind !== "home" &&
    requestedRoute.kind !== "install-content"
  )
    store.navigate(INSTALL_CONTENT_ROUTE, { replace: true });
  $: syncSession(route);
  /* Which pairing the duel below mounts on: the one free play's setup screen
     produced, or the one the story's encounter chose. `#/duel` standalone has
     neither and opens the duel's own picker, which is what it has always done.
     Both sides hold one object per match, so this reads a reference rather
     than building one — a fresh equal object here would restart the duel. */
  $: duelRequest =
    route.kind === "free-play"
      ? matchRequest
      : route.kind === "duel-session"
        ? sessionRequest
        : null;
  /* Leaving free play ends its match, so coming back opens on the seats rather
     than on a duel nobody asked to resume. */
  $: if (route.kind !== "free-play") leaveMatch();
  /* Which deck library the route names, so one editor region serves both
     contexts and hands navigation back in the one it was reached from. */
  $: deckContext = deckRouteContext(route);
  $: bindDeckContext(deckContext);
  $: editorReturnRoute =
    deckContext === null
      ? HOME_ROUTE
      : previousRoute === null || deckRouteContext(previousRoute) !== null
        ? deckRoute(deckContext, null)
        : previousRoute;
  $: editorReturnLabel =
    previousRoute === null || deckRouteContext(previousRoute) !== null
      ? "Deck Selection"
      : routeLabel(previousRoute);
  /* The same question for the collection, which is two routes over one screen
     for the same reason the editor is two over one: a save's cards and free
     play's database are the same browsing, over a different pool. */
  $: collectionContext =
    route.kind === "story-collection"
      ? ("story" as const)
      : route.kind === "free-play-collection"
        ? ("free-play" as const)
        : null;
  $: bindCollection(collectionContext);

  function leaveMatch(): void {
    matchRequest = null;
  }

  /** Starts the reads free play opens on, before the player has asked for it.

      Both are the shell's own lazy imports: the setup screen's chunk and, from
      the module it carries, the battle entry and the deck library it lists.
      Called when a player reaches for Free Play rather than when the main menu
      mounts — the whole packaged card database is behind that listing, and a
      player who came for the story must not pay for it. */
  function warmFreePlay(): void {
    void (async () => {
      const [listing] = await Promise.all([
        import("./screens/free-play-deck-listing.ts"),
        import("./screens/FreePlayMatchSetup.svelte"),
      ]);
      listing.warmFreePlayDecks(loaders.duel);
    })().catch(() => undefined);
  }

  /* Which world the mounted editor writes into, and the world it was bound for.
     Held apart so moving between a library and one of its decks keeps the one
     binding: rebuilding it would drop the editing session the story adapter
     holds in that closure — its undo log and last-opened deck.

     Free play is a value, so the editor is bound before the first paint. A save
     has to be read first, and until it answers the region shows nothing rather
     than an editor over the wrong library. */
  let boundDeckWorld: RouteContext | null = null;
  let editorContext: DeckContext | null = null;
  let storyDeckToken = 0;

  function bindDeckContext(world: RouteContext | null): void {
    if (world === boundDeckWorld) return;
    boundDeckWorld = world;
    editorContext = world === "free-play" ? { kind: "free-play" } : null;
    if (world !== "story") return;
    const requested = ++storyDeckToken;
    void openStoryDeckContext().then(
      (bound) => {
        if (requested !== storyDeckToken) return;
        /* No save is loaded, so there are no decks to edit and nothing to name.
           The main menu is where a story route with nothing to show goes
           (ADR-051); replaced rather than pushed, because the player asked for
           a deck library rather than for this correction. */
        if (bound === null) store.navigate(HOME_ROUTE, { replace: true });
        else editorContext = bound;
      },
      () => {
        if (requested === storyDeckToken)
          store.navigate(HOME_ROUTE, { replace: true });
      },
    );
  }

  /* The collection screen is not part of the visual novel's own surface, so it
     ships as its own chunk behind `loadCollectionScreen` rather than inside the
     story entry. This is the type of what that loader hands back. */
  type CollectionScreenComponent = Awaited<
    ReturnType<(typeof import("../story/index.ts"))["loadCollectionScreen"]>
  >;

  /* What the collection region renders, or `null` while it is still being
     read. Held as one object so the pool, what owns it and the world it was
     opened for can never be paired wrong — the same reason `DeckContext`
     carries its ownership rather than sitting beside it. */
  interface OpenCollection {
    readonly context: RouteContext;
    readonly ownership: CardOwnership;
    readonly catalog: CollectionCatalog;
    readonly Screen: CollectionScreenComponent;
  }

  let collection: OpenCollection | null = null;
  let boundCollectionWorld: RouteContext | null = null;
  let collectionToken = 0;

  function bindCollection(world: RouteContext | null): void {
    if (world === boundCollectionWorld) return;
    boundCollectionWorld = world;
    collection = null;
    if (world === null) return;
    const requested = ++collectionToken;
    void openCollection(world).then(
      (opened) => {
        if (requested !== collectionToken) return;
        /* No save is loaded, so there is no collection to browse. The main menu
           is where a story route with nothing to show goes (ADR-051), and it is
           replaced rather than pushed because the player asked for their cards
           rather than for this correction. */
        if (opened === null) store.navigate(HOME_ROUTE, { replace: true });
        else collection = opened;
      },
      () => {
        if (requested === collectionToken)
          store.navigate(HOME_ROUTE, { replace: true });
      },
    );
  }

  /** The pool a collection route browses, or `null` for a story route with no
      save behind it.

      Both halves come from the visual novel's lazy entry: free play's ownership
      is the shared one from `src/decks/`, but the card database read and the
      rarity every tile is grouped by are resolved from the shop's set data,
      which only the story may reach. */
  async function openCollection(
    world: RouteContext,
  ): Promise<OpenCollection | null> {
    const story = await import("../story/index.ts");
    let ownership: CardOwnership = unlimitedCardOwnership();
    if (world === "story") {
      const bound = await story.openStoryDeckContext(saves ?? lazySaves);
      if (bound === null || bound.kind !== "story") return null;
      ownership = bound.ownership;
    }
    /* The screen's chunk and the database read start together: neither needs
       the other, and the region shows nothing until both have landed. */
    const [catalog, Screen] = await Promise.all([
      story.loadCollectionCatalog(),
      story.loadCollectionScreen(),
    ]);
    return {
      context: world,
      ownership,
      catalog,
      Screen,
    };
  }

  const readViewportBox = (): StageBox =>
    computeStageBox(globalThis.innerWidth, globalThis.innerHeight);

  /* The shell is the only place the viewport is measured: domains read the
     resulting box through `STAGE_CONTEXT_KEY` instead of measuring again. The
     stage's own pixel box is not taken from here — `.app-stage` derives it in
     CSS so it lands in the same layout pass as the resize, and this store only
     mirrors it for domains and for `data-stage-mode`. */
  const stageBox = writable<StageBox>(readViewportBox());
  setContext(STAGE_CONTEXT_KEY, readonly(stageBox));
  const toasts = createToastStore();
  setContext(TOAST_CONTEXT_KEY, toasts);
  let box: StageBox;
  const unsubscribeStage = stageBox.subscribe((value) => {
    box = value;
  });

  onMount(() => {
    let mounted = true;
    if (initialCoreGate === null) {
      const appBaseUrl = new URL(
        import.meta.env.BASE_URL,
        globalThis.location.origin,
      ).href;
      void loadCoreStartup(
        (input, init) => globalThis.fetch(input, init),
        appBaseUrl,
        globalThis.indexedDB,
      ).then((startup) => {
        if (!mounted) return;
        coreBootstrap = startup.bootstrap;
        coreGate = startup.gate;
      });
    }

    const syncFromLocation = () => store.syncFromHash(globalThis.location.hash);
    globalThis.addEventListener("hashchange", syncFromLocation);
    const syncVisibility = () => toasts.setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    const measure = () => stageBox.set(readViewportBox());
    measure();
    /* `ResizeObserver` also fires for viewport changes a `resize` event misses
       (mobile URL bar collapse, virtual keyboards); the listener is the
       fallback where the observer is unavailable. */
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : undefined;
    if (observer === undefined) globalThis.addEventListener("resize", measure);
    else observer.observe(document.documentElement);

    return () => {
      mounted = false;
      observer?.disconnect();
      globalThis.removeEventListener("resize", measure);
      globalThis.removeEventListener("hashchange", syncFromLocation);
      document.removeEventListener("visibilitychange", syncVisibility);
      toasts.destroy();
      unsubscribeStage();
      unsubscribe();
    };
  });
</script>

<!-- `data-stage-rotated` reports the mode, not a measurement: the quarter turn
     itself lives in `src/styles/app.css` so it lands in the same layout pass as
     the viewport change. `data-stage-route` reports the route for the same
     reason: the stylesheet decides which routes keep the 16:9 width law and
     which spend the pillarbox (only the duel does today). -->
<div
  class="app-stage"
  data-cy="app-stage"
  data-stage-mode={box.mode}
  data-stage-rotated={box.rotated ? "true" : undefined}
  data-stage-route={route.kind}
  bind:this={stage}
>
  {#if route.kind === "home"}
    <div class="shell-region shell-region--home" data-cy="shell-region-home">
      <MainMenuScreen {store} {coreGate} onfreeplaywarm={warmFreePlay} />
    </div>
  {:else if route.kind === "install-content"}
    <div
      class="shell-region shell-region--install-content"
      data-cy="shell-region-install-content"
    >
      <InstallContentScreen
        gate={coreGate}
        bootstrap={coreBootstrap}
        onback={() => store.navigate(HOME_ROUTE)}
      />
    </div>
  {:else if collectionContext !== null}
    <div
      class="shell-region shell-region--collection"
      data-cy="shell-region-collection"
    >
      {#if collection === null}
        <!-- The save and the card database are still being read. Nothing of the
             screen mounts until both are in hand, so a route with no save never
             becomes an empty collection. -->
        <p class="visually-hidden" data-cy="collection-pending">
          Opening your collection
        </p>
      {:else}
        {@const opened = collection}
        <svelte:component
          this={opened.Screen}
          ownership={opened.ownership}
          cards={opened.catalog.cards}
          rarityByCode={opened.catalog.rarityByCode}
          onback={() => store.navigate(deckRoute(opened.context, null))}
        />
      {/if}
    </div>
  {:else if deckContext !== null}
    {@const context = deckContext}
    <div class="shell-region shell-region--decks" data-cy="shell-region-decks">
      <!-- Keyed on the world, so crossing between the two deck libraries — with
           Back, or a pasted hash — mounts a new editor rather than handing the
           old one a new banner. The repository is opened once per mount, so a
           reused instance would keep writing into the library it was mounted
           for while naming the one the player is now looking at. -->
      {#key context}
        {#if editorContext === null}
          <!-- The save behind a story deck route is still being read. Nothing
               of the editor mounts until it is found, so a route with no save
               never becomes an editor over the free-play library. -->
          <p class="visually-hidden" data-cy="story-decks-pending">
            Opening your story decks
          </p>
        {:else}
          {@const bound = editorContext}
          {#await loaders.decks() then module}
            <svelte:component
              this={module.default}
              context={bound}
              deckId={route.kind === "free-play-deck" ||
              route.kind === "story-deck"
                ? route.deckId
                : null}
              onnavigate={({ deckId }) =>
                store.navigate(deckRoute(context, deckId))}
              oncollection={() => store.navigate(collectionRoute(context))}
              onexit={() => store.navigate(HOME_ROUTE)}
              returnLabel={editorReturnLabel}
              onreturn={() => store.navigate(editorReturnRoute)}
            />
          {:catch error}
            <DomainLoadError label="Deck Editor" cy="decks" {error} />
          {/await}
        {/if}
      {/key}
    </div>
  {:else if route.kind === "admin"}
    <div class="shell-region shell-region--admin" data-cy="shell-region-admin">
      {#await import("./admin/AdminConsole.svelte") then module}
        <svelte:component this={module.default} {store} />
      {:catch error}
        <DomainLoadError label="Developer console" cy="admin" {error} />
      {/await}
    </div>
  {:else if route.kind === "story"}
    <div class="shell-region shell-region--story" data-cy="shell-region-story">
      {#await loaders.story() then module}
        <svelte:component
          this={module.default}
          onencounter={startEncounter}
          {storyEntryIntent}
          ondecks={() => store.navigate(deckRoute("story", null))}
          onmainmenu={() => store.navigate(HOME_ROUTE)}
          resumeState={handback?.state ?? null}
          resolution={handback?.resolution ?? null}
          onhandled={() => {
            handback = null;
          }}
        />
      {:catch error}
        <DomainLoadError label="Visual novel" cy="story" {error} />
      {/await}
    </div>
  {:else if route.kind === "free-play" && matchRequest === null}
    <!-- Free play opens on the seats themselves: choosing two decks is the only
         thing this mode asks before a duel, and a menu in front of it was one
         click that named the screen behind it (ADR-054). Both seats are chosen
         here rather than inside the duel, whose own picker fixes the opponent.
         The duel still mounts in the region below and nowhere else:
         `src/battle/app/presentation/stage-frame.ts` maps every viewport
         coordinate through `shell-region-duel`.

         Loaded rather than imported, for the reason the domains are: reading
         the free-play library pulls in the deck repository and the card
         catalog, and measured statically that is 24,989 bytes of the shell's
         115,000-byte budget for a screen only a free-play match opens. -->
    <div
      class="shell-region shell-region--free-play"
      data-cy="shell-region-free-play-setup"
    >
      {#await import("./screens/FreePlayMatchSetup.svelte") then module}
        <svelte:component
          this={module.default}
          {settings}
          loadBattle={loaders.duel}
          onstart={(request) => (matchRequest = request)}
          onback={() => store.navigate(HOME_ROUTE)}
          ondecks={() => store.navigate(deckRoute("free-play", null))}
          onopendeck={(id) =>
            store.navigate(deckRoute("free-play", deckId(id)))}
        />
      {:catch error}
        <DomainLoadError label="Match setup" cy="free-play-match" {error} />
      {/await}
    </div>
  {:else}
    <div class="shell-region shell-region--duel" data-cy="shell-region-duel">
      {#if route.kind === "duel-session" && !sessionReady}
        <!-- The checkpoint is still being read. Nothing of the duel mounts
             until it is found, so a session that cannot be resumed leaves the
             player on the story rather than inside half a duel. -->
        <p class="visually-hidden" data-cy="battle-session-pending">
          Preparing the story duel
        </p>
      {:else}
        {#await loaders.duel() then module}
          <!-- The duel is rotated by the stylesheet, so the notice explaining
               it belongs to the duel; its one-time dismissal is a shell
               setting, so the flag and its setter cross as plain props. -->
          <svelte:component
            this={module.BattleFacade}
            request={duelRequest}
            hosted={route.kind === "duel-session"}
            oncomplete={settleSession}
            rotated={box.rotated}
            rotationNoticeDismissed={$settings.rotationNoticeDismissed}
            onrotationnoticedismiss={() => settings.dismissRotationNotice()}
            onleavematch={route.kind === "free-play" ? leaveMatch : null}
          />
        {:catch error}
          <DomainLoadError label="Duel Simulator" cy="duel" {error} />
        {/await}
      {/if}
    </div>
  {/if}
  <ToastHost store={toasts} />
</div>
