---
date: 2026-07-12
title: YGO Story Duel Simulator - Architecture
status: accepted
tags:
  - architecture-decision
  - browser
  - typescript
  - svelte
  - phaser
  - wasm
  - ocgcore
---

# YGO Story Duel Simulator - Architecture

## Status

**Accepted on 2026-07-12.** This is the canonical architecture document for the project. It supersedes the previous Odin, Electron/external EDOPro, and UI-reuse directions for the prototype.

The immediate product is not yet a story game. The first MVP is a browser-based, offline Project Ignis-like duel client that launches directly into duels with preset decks and can complete a legal Yu-Gi-Oh! duel from initialization to `MSG_WIN`. It must include an up-to-date Project Ignis-compatible card database, complete official CardScripts and usable card images. It deliberately excludes deck construction, general menus and online matches.

## Decision summary

Build a browser-first client with:

- **TypeScript** as the application, orchestration, duel-protocol, state-management and AI language;
- **Svelte** for application UI, card details, menus, prompts and overlays;
- **Phaser** for the duel field, card interaction and animation; later it can also render story maps and visual-novel scenes where spatial rendering is useful;
- Project Ignis **`ygopro-core` / `ocgcore`**, compiled from C++ to WebAssembly, as the rules engine;
- **`ocgcore.sync.wasm` in a dedicated Web Worker**;
- the complete current standard-format Project Ignis **CardScripts** snapshot for card behavior, including official and prerelease scripts;
- the complete current standard-format **BabelCDB** catalog (`cards.cdb`, release additions and non-Rush prereleases) converted into browser-friendly build artifacts;
- Project Ignis system strings/supporting duel data needed to present all current core prompts;
- a versioned card-image manifest with every supported card ID resolvable, active-duel images preloaded and images rendered throughout the duel UI;
- **IndexedDB/OPFS** for versioned data and script snapshots, plus Cache Storage for lazy image caching;
- Vite as the browser build and development tool.

TypeScript wraps and drives the WASM engine; TypeScript itself does not need to compile to WASM. Only the C++ rules engine belongs in WASM.

## Why this architecture

- `ocgcore` already solves the rules and Lua card-effect problem.
- `ocgcore-wasm` exposes TypeScript types, parses many core messages and encodes responses.
- TypeScript has direct access to Web Workers, IndexedDB, browser networking and the Svelte/Phaser ecosystem.
- Svelte is suited to text-heavy application UI and later visual-novel dialogue.
- Phaser is suited to scenes, input, maps, transitions and animated card placement.
- A custom browser client provides a seamless path from the duel MVP to a later story shell.

## Rejected alternatives

### Full EDOPro client in the browser

Rejected. EDOPro's graphical client is not the required product surface and porting it would bring unnecessary desktop-client dependencies. The project uses the underlying `ocgcore`, not the EDOPro GUI.

### Odin wrapper

Rejected for the browser prototype. Odin remains a possible native-client language but has a much smaller browser/WASM and UI ecosystem and would discard the existing TypeScript integration work.

### Rust wrapper

Rejected for the initial architecture. Rust is strong for new WASM modules, but adding a Rust layer between TypeScript and the existing C++ WASM core would duplicate bindings and protocol work without solving the browser UI problem.

### JSPI asynchronous core

Deferred. The asynchronous build depends on newer WebAssembly JSPI/stack-switching support. The prototype uses the synchronous build in a Worker for predictable browser compatibility.

## Product boundaries

### MVP scope

- Browser application that launches directly into a duel rather than recreating EDOPro's surrounding menus.
- Bundled preset decks, with one human player versus one deterministic, deck-specific scripted opponent.
- Complete duel lifecycle: initialize, draw, play turns, battle, resolve effects and finish with a core-provided result.
- Full current standard-format Project Ignis-compatible BabelCDB metadata/text catalog, including release and non-Rush prerelease additions.
- Full current official and prerelease Project Ignis CardScripts plus required global/procedure scripts.
- Current system strings and supporting duel data needed to present core messages correctly.
- Card images displayed in the hand, field, card inspector, GY, banished zone, Extra Deck and selection prompts.
- Every catalog card ID has an image-manifest entry or an explicit documented fallback; all images needed by the active preset duel are loaded before play starts.
- A duel-client protocol adapter covering the current `ygopro-core` messages, prompts and responses used by official CardScripts, not only a hand-picked subset.
- Legal actions come only from `ocgcore` prompts.
- Visible hand, field, LP, phase, turn, deck count, GY, banished zone and Extra Deck count.
- Debug event/response logs, structured errors and a structured final result.
- Automated upstream synchronization that stages core, database, scripts, strings and image-manifest revisions as one tested release snapshot.

### Explicit non-goals

- Story, dialogue, maps, relationships, rewards or progression.
- Deck constructor/editor, collection or booster system.
- General EDOPro-style home/settings/repository/replay menus.
- User-supplied decks in the initial product UI; arbitrary deck injection may exist only as a development compatibility harness.
- Generic competitive AI; the bundled opponent remains deck-specific.
- Online multiplayer, lobby/server browser or server authority.
- Match/side-deck flow unless required later by a preset scenario.
- Pixel-perfect EDOPro visual parity.
- Mobile-first polish.
- Pre-bundling every high-resolution image in the initial JavaScript payload.

"Similar to Project Ignis" means current rules/card/script/data coverage and a complete playable duel surface. It does not mean copying EDOPro's deck editor, menus, networking or exact visual design.

### Asset availability decision

A curated preset-only asset subset was considered because it would be much smaller and simpler. It was rejected because it would create a disposable data pipeline and would not satisfy Project Ignis-like compatibility.

The accepted approach is:

- ship the full metadata, strings and CardScripts snapshot as versioned application data;
- expose complete image coverage through a versioned manifest and locally archived/re-hosted image files;
- preload/cache images required by the active duel;
- deliver other card images lazily from the project's own asset hosting rather than continually hotlinking the source provider;
- keep the multi-gigabyte image archive outside the JavaScript bundle and source Git history;
- use explicit placeholders for provider-missing IDs until a second approved image source is available.

## Runtime architecture

```text
Browser main thread
├── Svelte application shell
│   ├── startup/loading/error screens
│   ├── prompt and action UI
│   ├── card detail panel
│   └── result screen
├── Phaser duel scene
│   ├── field zones
│   ├── card sprites/placeholders
│   ├── selection highlighting
│   └── movement/battle feedback
└── typed Worker client
    ↕ structured-clone command/event messages
Duel Web Worker
├── duel session controller
├── prompt-to-response adapter
├── deterministic opponent policy
├── field-state projector
├── versioned full-catalog asset store
├── active-duel in-memory card/script maps
└── ocgcore.sync.wasm
    ├── embedded Lua runtime
    └── Project Ignis CardScripts
```

The main thread never calls `ocgcore` directly. The Worker exclusively owns the WASM module, duel handle, engine state, scripts and response loop.

## Duel execution flow

1. Main thread requests `initialize`.
2. Worker verifies the atomic asset manifest and loads the current card/script/string snapshot.
3. Main thread requests `startDuel` with a preset duel ID.
4. Worker resolves the two preset decks and preloads all required card records and scripts; the main thread preloads all card images reachable from those decks.
5. Worker creates the duel, loads global Lua scripts, adds deck cards and starts the core only after required duel assets are ready.
6. Worker repeatedly calls `duelProcess` and reads all emitted messages.
7. Messages update a serializable projected field state.
8. Non-interactive events are sent to the UI as duel events/state snapshots.
9. Human prompts are converted into typed UI choices and sent to the main thread.
10. The selected choice is returned with a prompt ID and encoded as an `ocgcore` response.
11. Opponent prompts are handled by the deterministic opponent policy.
12. The loop ends only on `MSG_WIN`, a declared engine error, an unsupported reachable message, or user surrender.
13. Worker emits a structured `DuelResult` and destroys the duel handle.

## Worker contract

Commands sent to the Worker:

```ts
type DuelCommand =
  | { type: "initialize" }
  | { type: "startDuel"; duelId: string }
  | { type: "respond"; promptId: string; choiceId: string }
  | { type: "surrender" }
  | { type: "dispose" };
```

Events sent to the main thread:

```ts
type DuelWorkerEvent =
  | { type: "ready"; coreVersion: readonly [number, number] }
  | { type: "loading"; stage: string; progress?: number }
  | { type: "state"; state: PublicDuelState }
  | { type: "event"; event: DuelPresentationEvent }
  | { type: "prompt"; prompt: PlayerPrompt }
  | { type: "result"; result: DuelResult }
  | { type: "error"; error: DuelError };
```

Every prompt has an opaque unique ID. A response is accepted only when its ID matches the currently pending prompt. This prevents stale clicks or animations from answering a later engine prompt.

## Engine adapter rules

- Pin exact revisions of `ocgcore-wasm`, `ygopro-core`, CardScripts, BabelCDB, strings/supporting data and the image manifest. The initial acquisition pipeline pins and SHA-512-verifies `ocgcore-wasm@0.1.2`; future upgrades must pass the same compatibility suite.
- Publish those revisions as one atomic asset snapshot; do not silently upgrade only one component.
- Keep raw core messages inside the Worker boundary.
- Expose domain-level prompts and presentation events to the UI rather than binary protocol fields.
- Fail loudly on any unsupported current-core message and capture a compatibility fixture before adding support.
- Log every process status, message, prompt, opponent decision and encoded response in development builds.
- Preserve the duel seed and ordered responses so failures can be reproduced deterministically.

## Synchronous callback constraint

The synchronous WASM build requires synchronous `cardReader` and `scriptReader` callbacks. They cannot call `fetch()` while `ocgcore` is waiting.

Therefore, before creating or advancing a duel:

1. verify that the complete versioned catalog/script snapshot is locally available;
2. load all active-duel card records;
3. load `constant.lua`, `utility.lua` and other global scripts;
4. load scripts required by the two preset decks;
5. store the active duel's synchronous callback inputs in Worker-owned in-memory maps;
6. only then create and process the duel.

The MVP must not implement network-on-demand script loading from inside a core callback.

## Card data and script pipeline

### Card metadata and strings

Use BabelCDB as the build-time source of truth and Project Ignis Distribution/localization resources for system strings. Generate the complete current catalog as:

- a compact engine data index keyed by card passcode for `cardReader`;
- localized card names, descriptions and effect-option strings;
- system strings needed to render prompts, hints, reasons and logs;
- a searchable ID/name index for diagnostics even though there is no deck constructor;
- a manifest containing exact upstream revisions, schema version, hashes and generation time.

The browser MVP should not include a second SQLite WASM runtime unless direct `.cdb` compatibility becomes necessary. Full-catalog artifacts may be split into deterministic shards, but every standard Master Rule official/release/prerelease card in the selected Project Ignis snapshot must be represented. Rush Duel, Skill, Goat-only and unofficial anime/manga catalogs are separate formats and excluded from this MVP.

### Lua scripts

Use the complete standard-format Project Ignis CardScripts snapshot pinned to the compatible core revision. Package:

- all official and prerelease `c<ID>.lua` scripts;
- global utility/constants files;
- all summon procedure and shared scripts;
- a name/hash index that supports synchronous lookup from a locally cached snapshot.

Only active-duel scripts need to be expanded into the Worker's in-memory map, but every packaged official script must be addressable. Missing card data or a missing Lua script is a fatal compatibility error with the passcode/script name included in the diagnostic.

### Images

Card images are required for the MVP.

- Maintain a versioned mapping from card passcode to full-card and optional cropped-art URLs/cache keys.
- Preload the player and opponent preset decks' full-card images before enabling the first action.
- Render appropriate face-up images in every duel zone and selection prompt; use a card back for hidden information.
- Archive provider images during asset generation, then serve them from project-controlled static hosting; do not continually hotlink YGOPRODeck.
- Fetch non-active catalog images lazily from that archive/CDN and cache them in Cache Storage/IndexedDB.
- Provide a deterministic missing-image placeholder and report missing IDs to diagnostics.
- Keep the source/provider configurable because Project Ignis Distribution explicitly excludes card images and image redistribution/IP terms require separate review.
- The first archive resolves 14,579 of 14,794 catalog IDs; 215 provider 404s are tracked in the download report.

"Up to date" means the application publishes a tested, timestamped snapshot. It does not mix live database rows with older scripts/core or silently mutate assets during an active duel.

## Duel state ownership

`ocgcore` is authoritative for legality and duel resolution. The frontend does not independently decide whether an action is legal.

The Worker maintains a projected client state from:

- core messages;
- `duelQueryField`;
- `duelQueryLocation` and specific card queries when a snapshot needs reconciliation.

Svelte and Phaser consume immutable serializable snapshots. Phaser animation state is presentation-only and must never become the rules source of truth.

## Opponent policy

The MVP opponent is deterministic and designed only for its bundled deck.

- It chooses from legal options emitted by the core.
- It follows explicit priorities for summon, activation, target selection, battle and phase progression.
- It must answer every mandatory prompt reachable by its deck.
- It logs the reason for each decision.
- It is not a generic Yu-Gi-Oh! AI and does not establish an architecture requirement for arbitrary decks.

A debug hot-seat/manual-opponent mode may be added for diagnosing prompt coverage, but it is not the primary MVP experience.

## Rendering decision

- Svelte owns layout, responsive panels, card text, action lists, modals, loading and result states.
- Phaser owns the board coordinate system, zones, cards on the field, selection highlights and animations.
- Communication between Svelte and Phaser goes through a small presentation store/event interface; Phaser must not import the Worker directly.
- Visual-novel scenes and maps are intentionally deferred, but the selected stack supports them without changing language or packaging.

## Browser and storage policy

Initial browser target: current desktop Chrome, Firefox and Safari, with Chromium as the primary development browser.

The MVP uses a single-threaded WASM build in a Worker and does not require `SharedArrayBuffer` or cross-origin isolation.

IndexedDB/OPFS stores the active versioned database/script/string snapshot, local preferences and debug run metadata. Cache Storage stores card images with snapshot-aware cache keys. The application must validate cache/version compatibility at startup and atomically switch snapshots only after verification.

## Error and observability policy

A failed duel must leave evidence. Development diagnostics include:

```text
run metadata
- core and data revisions
- browser and build version
- deterministic seed
- preset duel ID

ordered trace
- process status
- raw parsed message type
- projected event
- player/opponent response
- script/core errors

result
- completed | surrendered | unsupported | engine_error
- winner/reason when available
- last successful message
- pending prompt when failed
```

Large traces can remain in memory for the MVP with a download-as-JSON action on errors.

## Testing strategy

- Unit-test worker message reducers and response encoders with recorded fixtures.
- Unit-test opponent decisions against typed prompts.
- Run deterministic headless duel tests with fixed seeds and preset decks.
- Add integration tests that start the Worker, complete scripted response sequences and assert `MSG_WIN`.
- Add one browser smoke test for initialization, image rendering, a player action and final result.
- Run protocol conformance fixtures for every current core message/response type exposed by the adapter.
- Validate catalog row counts, script indexes, image-manifest coverage and missing-asset reports on every asset update.
- Every newly supported core message or changed protocol shape must add a fixture or deterministic duel path.

## Security and trust boundaries

- Load only pinned project-provided Lua scripts; arbitrary user scripts are out of scope.
- Treat deck/card/script artifacts as versioned application data.
- Keep the engine in a Worker so it can be terminated on runaway execution.
- Client-side WASM is acceptable for single-player. Future competitive multiplayer requires a server-authoritative engine.

## Licensing and IP

- `ocgcore-wasm` wrapper code is MIT, but the embedded Project Ignis `ygopro-core` is AGPL-3.0-or-later.
- Project Ignis CardScripts are AGPL-covered.
- Public deployment must comply with the applicable source-availability obligations.
- BabelCDB redistribution terms must be verified separately.
- Yu-Gi-Oh! names, text, art and characters remain separate Konami/Shueisha IP concerns.
- The MVP requires card images, so an image source, hotlink/cache policy and public-redistribution posture must be approved before deployment; technical availability is not permission to redistribute.

## Future extension path

After the duel MVP is proven, the same application can add, in order:

1. more preset decks and stronger compatibility regression coverage;
2. deck editor and arbitrary local decks;
3. card collection and saves;
4. visual-novel dialogue and branching story state;
5. Phaser maps and NPC interaction;
6. rewards, shops, relationships and tournaments;
7. stronger deck-specific opponents;
8. optional server-authoritative multiplayer.

None of these future systems may be added to the first duel MVP until the preset duel reliably completes from start to finish.
