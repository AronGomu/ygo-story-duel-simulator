# Glossary

[x] Activated
[x] Project scanned

Shared vocabulary between user and agents. Say the word, mean the code.

## Frontend

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| app | Browser product mounted through modular shell | `src/main.ts` (`mount`), `src/shell/AppShell.svelte` |
| shell | Router/composition layer owning lazy domain transitions | `src/shell/AppShell.svelte`, `src/shell/routes.ts` (`AppRoute`) |
| core-shell | Planned asset-free executable shell/menu/settings/installer; not rules engine or asset-only core.zip | `src/shell/AppShell.svelte`, ADR-084 |
| installed-union | Planned gameplay catalog from verified installed chapter closures; runtime presence grants nothing | `src/content/contracts/content-set-ref.ts`, ADR-086 |
| duel simulator | Production battle UI plus Worker-owned rules runtime | `src/battle/app/`, `src/battle/duel/`, `src/battle/field/`, `src/battle/worker/` |
| deck editor | Local deck library/editor domain loaded through shell | `src/deck-editor/DeckEditorApp.svelte`, `src/deck-editor/index.ts` |
| visual novel | Narrative/map/campaign domain reached at `#/story` | `src/story/` |
| shop | Story card shop: keeper, 50-set browser, packs, singles, sell | `src/story/shop/` |
| dp | Duel-point wallet, starts at 1000 | `StoryState.dp`, ADR-033 |
| booster | Unopened pack count per shop set | `StoryState.boosters`, `src/story/shop/data/pack-generator.ts` |
| collection | Owned card counts by card code | `StoryState.collection` |
| rarity | Printed rarity from set data, inference fallback, halo colors | `src/story/shop/data/shop-set-data.ts`, ADR-035 |
| setdata | First-50-sets JSON asset + offline-cached loader | `public/story/shop-sets.v1.json`, `src/story/shop/data/shop-set-data.ts` |
| storybar | Shared story header with screen-specific controls and context | `src/story/components/StoryTopBar.svelte` (`StoryTopBar`), `src/story/StoryApp.svelte` (`storyHeaderConfig`) |
| playback | Narrative running itself: auto-advance or skip, with the stop reason it reports | `src/story/playback/story-playback.ts` (`PlaybackMode`, `playbackHalt`) |
| auto | Advances one beat per auto-speed setting until a choice, the scene end, or any manual input | `src/story/playback/story-playback.ts`, `StoryApp.svelte` |
| skip | Fast-forwards read beats, stopping at the first unread one unless "Skip unread text" is on | `src/story/playback/story-playback.ts`, `src/story/overlays/SettingsOverlay.svelte` |
| readlog | Profile-wide set of beat ids this reader has seen; outside saves, so a load cannot un-read them | `src/story/playback/story-read-log.ts` (`STORY_READ_LOG_KEY`) |
| facade | Narrow domain-owned public lifecycle/contract boundary used by shell | future `src/battle/index.ts`, `src/decks/index.ts`, `src/story/index.ts` |
| store | Typed duel view state store + reducer | `src/battle/app/stores/duel-store.ts` (`createDuelStore`, `reduceDuelViewState`, `DuelViewState`) |
| client | Main-thread typed Worker client/port | `src/battle/app/DuelWorkerClient.ts` (`DuelWorkerClient`, `DuelWorkerPort`) |
| field | Semantic DOM duel field component | `src/battle/app/components/DuelField.svelte`, `src/battle/app/components/duel-field/FieldBoard.svelte` |
| phasebar | Split phase bar for opponent/player transitions | `src/battle/app/components/PhaseBar.svelte`, `src/battle/app/prompts/phase-transitions.ts` |
| perspectiveplane | Transformed board surface carrying zones, cards and hands | `src/battle/app/components/duel-field/FieldBoard.svelte`, `src/styles/app.css` |
| virtualheight | Tilt-compensated field height used by geometry | `src/battle/field/duel-field-geometry.ts` (`perspectiveVirtualHeight`) |
| board | Board view model projected for rendering | `src/battle/field/board-view-model.ts` (`BoardCardView`, `BoardZoneView`, `BoardStackView`) |
| zone | Deck section with count, cards, and validation tooltip | `src/decks/deck-contracts.ts` (`DeckZone`), `src/deck-editor/components/DeckZoneGrid.svelte` |
| hud | Life points / turn / phase heads-up display | `src/battle/app/components/duel-field/DuelHud.svelte`, `.duel-hud` in `src/styles/app.css` |
| prompts | Prompt UI controls and control families | `src/battle/app/prompts/PromptControls.svelte`, `prompt-control-family.ts` |
| selection | Prompt choice validation / field decision bar | `src/battle/app/prompts/prompt-selection.ts` (`validatePromptSelection`), `src/battle/app/components/duel-field/FieldActionBar.svelte` |
| interaction | Active interaction spec + session reducer | `src/battle/app/prompts/interaction-spec.ts`, `interaction-session.ts` (`synchronizeInteractionSession`) |
| navigation | Keyboard/spatial field focus movement | `src/battle/app/prompts/field-navigation.ts` (`reduceFieldNavigation`, `SpatialNeighbors`) |
| presentation | Event → DOM feedback commands, scheduler | `src/battle/app/presentation/presentation-command.ts` (`PresentationScheduler`) |
| feedback | Non-authoritative CSS/SVG field feedback state | `src/battle/app/presentation/dom-feedback-controller.ts`, `src/battle/app/components/duel-field/FieldLines.svelte` |
| log | Duel event log formatting + panel | `src/battle/app/presentation/format-duel-log-entry.ts`, `src/battle/app/components/duel-field/DuelLog.svelte` |
| preview | Sticky card art + bounded scroll text column; shared duel/editor component | `src/shell/card-preview/CardPreviewPanel.svelte` (ADR-036), `src/battle/app/presentation/card-preview.ts` |
| portal | Moves duel dialogs outside rotated shell for correct hit-testing | `src/battle/app/components/portal-duel-dialog.ts` (`portalDuelDialog`) |
| default | Sole persistent deck mark; preselects player deck | `src/deck-select/deck-select-contracts.ts` (`DeckTileModel.isDefault`), `src/deck-select/DeckTile.svelte` |
| decklist | Main, Extra, and Side rows beside deck tiles | `src/deck-select/DecklistPanel.svelte`, `src/deck-select/deck-select-contracts.ts` (`DecklistView`) |
| hotspot | Map location control with anchored context popover | `src/story/screens/IllustratedMapScreen.svelte`, `src/story/model/story-state.ts` (`LocationId`) |
| starter deck | Chapter 1 seed; existing libraries untouched, legacy migration preserved | `src/decks/starter-deck.ts` (`ensureStarterDeck`), `src/story/decks/starter-grant.ts` |
| autosave log | Global capped-100 list, one entry per accepted deck command including reorder/sort (timestamp + deck name) | `autosaves` store, `src/decks/deck-database.ts` v2, ADR-038, ADR-044 |
| load dialog | Editor dialog: saved decks tab + autosave log tab, restore = undoable edit | `src/deck-editor/components/LoadDeckDialog.svelte` |
| deck tile | Square art-filled deck card shared across grids, seats, phone lists | `src/deck-select/DeckTile.svelte` (`.deck-tile`, `aspect-ratio: 1 / 1`), `DeckTileModel` in `src/deck-select/deck-select-contracts.ts` |
| illustration | Chosen cropped card art fronting a deck tile | `DeckRecord.illustrationCardCode`, `src/decks/deck-cover.ts` |
| seat halo | Tile glow: blue you, red opponent, teal focus, gold default hairline | `halo` prop in `src/deck-select/DeckTile.svelte`; `--seat-you`, `--seat-opponent`, `--selected` in `src/styles/tokens.css` |
| kebab menu | ⋮ action sheet on a deck tile: open, rename, duplicate, delete | `src/deck-select/DeckTileMenu.svelte`, `src/deck-select/RenameDeckDialog.svelte`, `DeleteDeckConfirm.svelte` |
| opponent persona | One of three free-play AIs; each owns one bundled deck | `FREE_PLAY_OPPONENTS` in `src/shell/screens/free-play-opponents.ts` (Practice Bot, Blaze Circuit, Vault Warden) |
| pinned first | Phone-layout transform lifting the seat's current pick to slot one | `pinSelectedFirst` in `src/deck-select/order-deck-tiles.ts` |
| duel start | Deck-select mode that fills the seats and starts the duel | `mode="duel-start"` in `src/shell/screens/FreePlayMatchSetup.svelte`, `src/story/screens/PreBattleScreen.svelte` |
| deck library | Deck-select mode that manages the collection; no seat is filled | `mode="library"` in `src/deck-editor/components/DeckLibrary.svelte` |
| deckselect | The shared screen behind all three: header, tools, grid, footer, dialogs | `src/deck-select/DeckSelectScreen.svelte`, public entry `src/deck-select/index.ts` |
| manual order | Cards stay placed; reorder history-blind, explicit sorts undoable | `src/decks/deck-model.ts`, `src/deck-editor/deck-editor-store.ts` |
| click intent | Double-click mutates; single-click pins preview | `src/deck-editor/layout/click-intent.ts` (`deckCardClickIntent`, `catalogCardClickIntent`, `ClickIntent`) |
| runtime catalog | The whole packaged card database (14,794 codes), fetched from the runtime assets when a domain opens rather than compiled into the bundle, memoized per page load | `src/decks/catalog/runtime-catalog.ts` (`runtimeCatalog`, `loadRuntimeCatalog`, `setRuntimeCatalogForTests`), ADR-043 |
| advancedsearch | Workspace-bound live catalog filter matrix | `src/deck-editor/components/AdvancedCardSearch.svelte`, `AdvancedDeckCatalogFilters` |
| buildable card | A catalog card a deck may hold; the runtime catalog less its 243 Tokens (14,551 offered) | `src/decks/catalog/deck-buildable-cards.ts` (`isDeckBuildableCard`, `deckBuildableCards`) |
| rail | Right-side LP, turn, phase, status column | planned `src/battle/app/components/DuelRail.svelte`, `docs/ADR/019_ADR_full_height_duel_shell_and_pixel_geometry.md` |
| cardlist | Browse/target floating physical-card window | `src/battle/app/components/duel-field/ZoneListDialog.svelte`, `docs/ADR/021_ADR_card_list_dialog_modes_and_selection.md` |
| images | Card art cache, leases, placeholders | `src/battle/app/images/card-image-cache.ts` (`CardImageLibrary`, `CardImageLease`) |
| styles | Single global stylesheet | `src/styles/app.css` |
| boundary | Field render error boundary | `src/battle/app/components/duel-field/DuelFieldErrorBoundary.svelte` |

## Story canon

The fiction, not the code. Nothing here is implemented yet; refs point at the canon document that owns the term (ADR-053).

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| canon | Narrative source of truth; runtime story content derives from it and never contradicts it | `docs/story/README.md`, ADR-053 |
| fynn | The protagonist; 15, lazy, hungry for duels, cheats twice and learns from it | `docs/story/characters/fynn.md` |
| chapter | One era of Yu-Gi-Oh!, one standalone game; ch1 = Duel Monsters | `docs/story/scenario/01-concept.md` |
| zaps | Corporation selling students a cheating product that costs them their health; ch1 main plot | `docs/story/chapters/01-duel-monsters.md` |
| conflict | Two incompatible claims on one value; the trigger that forces a duel | `docs/story/scenario/03-world-rules.md` |
| multi | Several duelists jointly engaging one person; legal, unbalanced on purpose | `docs/story/scenario/03-world-rules.md` |
| shadow game | The one duel where the soul may be staked; the sole exception to the integrity ban | `docs/story/scenario/03-world-rules.md` |
| hard magic | Magic as a natural phenomenon with fixed knowable laws, costs and limits | `docs/story/scenario/02-philosophy.md` |
| cheating | Not forbidden; punished only when proven by a binding logical argument, which loses the duel | `docs/story/scenario/03-world-rules.md` |
| whim-worship | Acting on impulse rather than rational judgment; Fynn's ch1 error, mistaken by him for egoism | `docs/story/scenario/02-philosophy.md` |
| second-hander | Someone who acts for others' approval rather than their own judgment; the trio's missing premise | `docs/story/characters/README.md` |
| spirit card | A card a spirit has imprinted itself into; scarcity, market, covetousness follow from it | `docs/story/scenario/03-world-rules.md` |
| grid | Egri/Truby/McKee/Rand template every character sheet answers | `docs/story/characters/creation-grid.md` |

## Backend

Worker, engine, and asset pipeline are "backend" here — nothing runs on a server.

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| worker | Dedicated duel Worker entrypoints | `src/battle/worker/duel.worker.ts`, `duel.worker-browser.ts`, `duel.worker-node.ts` |
| runtime | Worker-side command/event runtime loop | `src/battle/worker/DuelWorkerRuntime.ts`, `create-browser-runtime.ts` |
| headless | Non-UI duel driver used by tests/tools | `src/battle/worker/HeadlessDuelController.ts` |
| session | Per-duel engine session lifecycle | `src/battle/worker/engine/DuelSession.ts` (`DuelConfiguration`, `DuelProcessBoundary`) |
| adapter | ocgcore WASM binding layer | `src/battle/worker/engine/OcgCoreAdapter.ts` (`EngineDuelHandle`, `EngineMessage`) |
| core | Permanently frozen vendored `ocgcore.sync.wasm` 0.1.2 + loader | `vendor/ocgcore-wasm/0.1.2/`, `src/battle/worker/engine/load-vendored-core-node.ts` |
| protocol | Engine message parsing/classification | `src/battle/worker/protocol/message-classification.ts` (`classifyEngineMessage`) |
| registry | Prompt binding + response encoding | `src/battle/worker/protocol/PromptRegistry.ts` (`buildEnginePrompt`) |
| projector | Engine queries → public duel state | `src/battle/worker/projection/DuelStateProjector.ts` (`ProjectionUpdate`, `QueriedPublicCard`) |
| opponent | Deterministic computer-player policy | `src/battle/worker/opponent/OpponentPolicy.ts` (`OpponentDecision`) |
| contracts | Shared command/event/state type surface | `src/battle/duel/contracts/` (`duel-command.ts`, `duel-worker-event.ts`, `public-duel-state.ts`) |
| seed | Deterministic RNG seeding | `src/battle/worker/engine/duel-seed.ts` (`DuelSeed`, `createProductionSeed`) |
| preset | MVP deck presets and `.ydk` parsing | `src/battle/duel/presets/mvp-preset.ts`, `deck-parser.ts` (`parseYdk`) |
| dependencies | Card text/script/string bundle for a duel | `src/battle/worker/assets/active-duel-dependencies.ts` |
| manifest | Runtime snapshot manifest parse/validate | `src/battle/worker/assets/runtime-manifest.ts` (`parseRuntimeSnapshotManifest`) |
| snapshot | Versioned asset revision set + pointer | `src/battle/storage/snapshot-store.ts` (`StoredSnapshot`, `SnapshotPointer`) |
| storage | IndexedDB/Cache persistence + cleanup | `src/battle/storage/revision-cache-cleanup.ts`, `snapshot-store.ts` |
| trace | Bounded diagnostic trace ring buffer | `src/battle/worker/diagnostics/duel-trace.ts` (`BoundedDuelTrace`) |
| errors | Typed duel error taxonomy | `src/battle/worker/duel-errors.ts`, `src/battle/duel/contracts/duel-error.ts` |
| bridge | Node `worker_threads` transport shim | `src/battle/worker/worker-thread-bridge-node.ts` |

## Other

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| scripts | Node asset/verify CLI entrypoints | `scripts/sync-assets.ts`, `verify-assets.ts`, `download-images.ts` |
| preflight | Read-only delivery config, publisher prerequisite, optional remote checks | `scripts/lib/asset-delivery/setup.ts` (`runAssetSetup`) |
| approval | Rights-only exact-file or future-inclusive tree publication scope | `scripts/lib/asset-delivery/publication-approval.ts` (`PublicationApproval`, `checkPublicationScope`) |
| sync | Pin/clone upstream card data repos | `scripts/lib/sources.ts` (`syncRepository`, `validatePinnedRevision`) |
| catalog | Filterable deck-editor card browser | `src/deck-editor/components/CardCatalog.svelte`, `src/decks/catalog/runtime-catalog.ts` (`loadRuntimeCatalog`) |
| strings | `strings.conf` system-string parser | `scripts/lib/strings.ts` (`parseStringsConf`) |
| tar | Minimal tar reader for downloads | `scripts/lib/tar.ts` (`readTarFiles`) |
| lock | Source pin file + run lock | `assets-source-lock.json`, `scripts/lib/run-lock.ts` |
| limits | Hard caps on untrusted asset sizes | `scripts/lib/limits.ts` (`MAX_CATALOG_RECORDS`, `MAX_DATABASE_BYTES`) |
| generated | Operational reports, receipts, locks, delivery outputs | `generated/`, `scripts/lib/asset-delivery/migrate.ts` |
| roots | Canonical asset ownership paths and browser mapping | `scripts/lib/asset-roots.ts` (`ASSET_SOURCES`) |
| profiles | Explicit asset delivery ownership independent of file location | `asset-profiles/`, `scripts/lib/asset-delivery/scan-assets.ts` |
| bundle | Deterministic frozen dev/player archives; no install or publish | `scripts/lib/asset-delivery/bundle.ts` (`bundleAssets`) |
| content | Player metadata parsers, immutable URLs, type-only integration ports | `src/content/index.ts` |
| promotion | Hash-guarded rule edits without moving asset bytes | `scripts/lib/asset-delivery/promote.ts` (`promoteAssets`) |
| migration | Hash-verified copy-only legacy source relocation; plan-bound temp ownership gates interrupted runs | `scripts/lib/asset-delivery/migrate.ts` (`applyMigration`), `scripts/lib/asset-delivery/migration-state.ts` |
| plugins | Vite plugins serving runtime assets/core | `scripts/lib/vite-runtime-assets.ts`, `vite-sync-core.ts` |
| vite | Build/dev config incl. worker bundling | `vite.config.ts`, `vitest.config.ts` |
| unit | Vitest unit suite | `tests/unit/` |
| component | Svelte component tests via testing-library | `tests/component/` |
| integration | Worker/session/wasm integration tests | `tests/integration/` |
| e2e | Playwright browser smoke test | `e2e/duel-smoke.spec.ts`, `playwright.config.ts` |
| fixtures | Fake adapters, harnesses, scenarios | `tests/fixtures/` (`fake-ocgcore-adapter.ts`) |
| transcripts | Recorded deterministic duel goldens | `tests/fixtures/transcripts/*.json` |
| lua | Test card scripts driving the engine | `tests/fixtures/core-scripts/*.lua` |
| architecture | Atomic numbered decision docs | `docs/architecture/architecture.md` and subfolders |
| domain | One owned UI/business module with public `index.ts`; no cross-domain deep imports | ADR-022 |
| worktree | Isolated checkout for one UI branch; integration config/contracts stay centrally owned | ADR-022 |
| adr | Accepted architecture decision records | `docs/ADR/` |
| guide | Generated HTML developer guide | `docs/developer-guide/` |
| checks | Aggregate quality gate npm scripts | `package.json` (`check`, `check:headless`, `check:browser`) |
| preflight | Local content prerequisites; separate code and public readiness | `scripts/lib/content-setup.ts` (`verifyContentSetup`), `content/README.md` |
| decklist row | Card entry in deck preview with frame colour, copy count, name, and optional art | `src/deck-select/DecklistPanel.svelte` |
| frame colour | Five-pixel left border on decklist row indicating card type | `src/deck-select/DecklistPanel.svelte` |
| twin-column seat pane | Duel-start right pane: player column left, opponent right, each avatar + name-only seat chip + scrolling decklist | `docs/ADR/064_ADR_deck_select_twin_column_seat_pane.md` |
| seat chip | Name-only deck card in the seat pane that toggles which seat the grid fills | `docs/ADR/064_ADR_deck_select_twin_column_seat_pane.md` |
| docked preview | Hovered deck's list rendered inside the active seat column (dashed gold outline), replacing the old floating window | `docs/ADR/064_ADR_deck_select_twin_column_seat_pane.md` |
| compact bar | Header/footer state entered on measured overflow: "Select Deck" title, ⋯ action menu | `docs/ADR/064_ADR_deck_select_twin_column_seat_pane.md` |
