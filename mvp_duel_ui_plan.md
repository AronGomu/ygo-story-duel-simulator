---
date: 2026-07-12
title: YGO Story Duel Simulator - Browser Duel MVP Plan
tags:
  - mvp
  - browser
  - typescript
  - svelte
  - phaser
  - wasm
  - ocgcore
status: planning
---

# YGO Story Duel Simulator - Browser Duel MVP Plan

## Goal

Build a browser-based Project Ignis-like duel client where a human player and a deterministic scripted opponent use bundled preset decks and can complete a legal Yu-Gi-Oh! duel from engine initialization to a win/loss result. The application must include a current full Project Ignis-compatible card database, official CardScripts, system strings/supporting duel data and card-image coverage, while excluding the deck constructor, surrounding menus and online matches.

The canonical technical decisions are recorded in [[architecture|Architecture]].

## Definition of done

The MVP is complete when:

1. The browser loads `ocgcore.sync.wasm` in a dedicated Web Worker.
2. A single manifest pins compatible revisions of `ocgcore-wasm`, `ygopro-core`, BabelCDB, CardScripts, Project Ignis strings/supporting data and the card-image index.
3. The generated browser catalog contains every current standard-format official/release/prerelease card record and text entry in the selected Project Ignis snapshot.
4. Every current official/prerelease CardScript and required global/procedure script is packaged and addressable.
5. Every supported card ID has an image-manifest entry or explicit missing-image result, and every image required by the active duel is loaded before play begins.
6. The core creates and starts a duel with a reproducible non-zero seed.
7. The human player can respond through the UI to the current core prompt/message protocol, including all prompt families used by official CardScripts.
8. The scripted opponent can answer every prompt reachable by its preset deck and play a basic coherent turn.
9. The UI displays card images, names and public information in the hand, field, inspector, GY, banished zone, Extra Deck and selection prompts while preserving hidden information.
10. The UI displays LP, turn, phase, deck counts and active chain state.
11. The field stays synchronized after summons, sets, moves, position changes, draws, damage, attacks and effect resolution.
12. The duel can finish by LP reaching zero, deck-out, surrender or another core-provided `MSG_WIN` reason.
13. An unsupported protocol message, missing database row, script, string or image produces a downloadable diagnostic trace rather than a silent stall.
14. Automated compatibility checks validate catalog/script/image coverage and protocol fixtures.
15. A deterministic integration test completes at least one duel to `MSG_WIN`.
16. A production browser build starts and completes the same duel with images and without development-only filesystem assumptions.

## Scope guard

The product UI launches preset duels, but its runtime data/protocol surface targets the complete current official Project Ignis snapshot. Full catalog availability does not add a deck constructor or arbitrary deck selection to the MVP UI.

Out of scope:

- story and visual-novel content;
- overworld maps;
- progression, rewards, packs and collection;
- deck construction, card search UI and user-facing `.ydk` import;
- general home/settings/repository/replay menus;
- generic AI beyond the bundled deck-specific opponent;
- online multiplayer, lobby/server browser and chat;
- matches and side decking unless required by a later preset scenario;
- replay-file compatibility with EDOPro;
- pixel-perfect EDOPro visual parity;
- forcing the complete image catalog into the initial page download;
- mobile polish.

This is materially larger than the earlier preset-only plan: it is a focused offline duel client, not a small card-subset demonstration.

## Preset deck criteria

Choose both decks before implementing prompt coverage. They should:

- contain 40-card Main Decks with optional small Extra Decks only if required;
- use stable official cards available in the pinned BabelCDB/CardScripts revisions;
- avoid cards that announce arbitrary names/numbers, manipulate unusual zones, change ownership, create tokens with complex state, or require highly deck-specific interfaces;
- exercise normal summon, set, spell/trap activation, simple targeting, battle, damage and at least one chain response;
- have clear win conditions and enough interaction to prove a real duel;
- keep the scripted opponent's decision tree finite and inspectable.

Start with simple cards. Add one mechanic at a time only after the preceding deterministic duel remains green.

## Technical baseline

- TypeScript with strict compiler settings.
- Vite.
- Svelte.
- Phaser.
- `ocgcore.sync.wasm` through a pinned/forked `ocgcore-wasm` adapter.
- Dedicated Worker.
- Complete build-time BabelCDB conversion.
- Complete pinned official and prerelease Project Ignis CardScripts snapshot.
- Pinned Project Ignis system strings/supporting duel data.
- Versioned complete card-image manifest with active-duel preload and browser caching.
- Atomic asset snapshots with compatibility validation and rollback to the previous known-good snapshot.
- Unit, protocol conformance, asset integrity and browser smoke tests.

## Milestone 0 — Reproducible project and upstream pinning

### Work

- Create the Vite + TypeScript + Svelte application.
- Add Phaser without rendering a duel yet.
- Fork or vendor the minimum `ocgcore-wasm` adapter required by the project.
- Record exact revisions for `ygopro-core`, `ocgcore-wasm`, CardScripts, BabelCDB, strings/supporting data and the image index/provider contract.
- Add scripts that fetch/verify upstream inputs and generate one atomic version manifest.
- Define the automated upstream synchronization flow: discover updates, stage all sources, regenerate assets, run compatibility tests and publish only as one snapshot.
- Ensure the WASM binary and versioned asset indexes are emitted as browser assets in production builds.

### Exit criteria

- Development and production builds load in a browser.
- Worker starts and reports the core version.
- Reinstalling from a clean checkout resolves identical engine/data revisions.
- A partially updated or hash-mismatched asset snapshot is rejected before duel initialization.

## Milestone 1 — Headless Worker duel smoke test

### Work

- Define the typed Worker command/event contract from the architecture document.
- Load the synchronous WASM build inside the Worker.
- Build the complete standard-format browser catalog from `cards.cdb`, release CDBs and non-Rush prerelease CDBs, then load only active-duel records into the synchronous runtime map.
- Package the complete official/prerelease CardScripts and global/procedure snapshot, then load the smoke duel's scripts into the Worker map.
- Load Project Ignis system strings required to decode prompts and logs.
- Create, populate and start a duel.
- Auto-answer both players with deterministic legal responses.
- Capture all process statuses, messages and responses.

### Exit criteria

- The Worker reaches either `MSG_WIN` or a deliberately identified unsupported prompt.
- No Node APIs such as `fs` or `readFileSync` are present in browser runtime code.
- The same seed produces the same ordered message trace.

## Milestone 2 — Typed duel state projector

### Work

Create a Worker-side `DuelStateProjector` that converts core output into immutable browser state:

- players and LP;
- current turn/player/phase;
- hand counts and visible hand cards for the human player;
- Main/Extra Deck counts;
- monster and spell/trap zones;
- field zone;
- GY and banished zones;
- card positions and public/hidden state;
- overlay materials if reachable;
- active chain summary;
- winner and finish reason.

Use core queries to reconcile state where event messages alone are insufficient.

### Exit criteria

- Recorded message fixtures produce expected state snapshots.
- A complete headless smoke duel has no impossible card duplication or loss.
- Hidden opponent information is not exposed to the main thread.

## Milestone 3 — Current core protocol adapter

### Required prompt coverage

Implement and fixture every prompt/response family exposed by the pinned current core, including:

- idle and battle commands;
- chain, effect yes/no, generic yes/no and option selection;
- card, unselect-card, tribute and sum selection;
- place, disabled-field and position selection;
- sorting cards/chains;
- counter allocation;
- race, attribute, card and number announcements;
- rock-paper-scissors/turn choice where applicable;
- any additional prompt added by the pinned Project Ignis core.

### Work

- Inventory all current message and response constants from the pinned core/wrapper.
- Convert raw core prompts into domain-level `PlayerPrompt` choices.
- Keep response encoding inside the Worker.
- Assign unique prompt and choice IDs.
- Reject stale, duplicate and invalid responses.
- Make unsupported messages terminate with a structured diagnostic.
- Add recorded binary/parsed fixtures for every protocol shape.

### Exit criteria

- The compatibility matrix has no unclassified current prompt/message type.
- Unit fixtures verify every supported prompt and response.
- A command-line/debug UI can manually progress either side through test scenarios.
- No frontend component needs to understand core response indexes or binary layouts.

## Milestone 4 — Scripted opponent

### Work

Implement a deterministic policy for the opponent preset deck:

- phase progression;
- normal summon/set priorities;
- spell/trap activation priorities;
- target scoring;
- chain yes/no policy;
- battle attacker/target selection;
- mandatory prompt fallback;
- decision reasons in logs.

The policy receives the same typed prompts exposed to the human UI plus only information legitimately visible to that player.

### Exit criteria

- The opponent takes meaningful turns rather than only passing.
- Every reachable mandatory prompt has a tested response.
- Fixed seeds produce reproducible opponent choices.
- A debug hot-seat mode can replace the policy when investigating a stall.

## Milestone 5 — Card-image pipeline and duel UI

### Asset work

- Use the implemented 14,794-entry image manifest and verified local archive (14,579 JPEGs; 215 provider-missing IDs).
- Publish legally approved images to project-controlled static hosting rather than hotlinking the source provider.
- Preload all unique images in both active preset decks before enabling duel input.
- Cache images with snapshot-aware keys and avoid duplicate downloads.
- Provide face-down card backs and deterministic missing-image placeholders.
- Surface image-source/version/coverage diagnostics.

### Svelte responsibilities

- asset loading/progress and fatal-error states;
- LP/turn/phase display;
- card detail panel;
- action and prompt lists;
- confirmation and yes/no UI;
- chain and event log;
- surrender action;
- final result screen;
- diagnostic download.

### Phaser responsibilities

- board and zone layout;
- image-backed cards in the hand and public zones;
- hidden-information card backs;
- selectable/highlighted cards and zones;
- hand fan or row rendering;
- card movement feedback;
- summon/set/position-change feedback;
- attack indication;
- damage and LP feedback.

### Exit criteria

- Every active-duel card image is loaded or explicitly represented by a reported placeholder before play.
- Face-up cards render the correct image in all required zones and prompts.
- Face-down/hidden cards never reveal their image to the wrong player.
- The full human action flow can be completed without debug controls.
- Prompt selections are visually unambiguous.
- UI animations never block or reorder engine responses.
- Empty, loading, unsupported and engine-error states are visible and recoverable.

## Milestone 6 — Full preset duel coverage

### Work

- Replace smoke decks with final MVP preset decks.
- Complete any missing current-core protocol adapter discovered by the final decks or compatibility corpus.
- Add deterministic scenarios for key effects, summon mechanics and interactions.
- Test all normal end conditions reachable by the presets.
- Add surrender and restart.
- Verify no core callback performs asynchronous network I/O.

### Exit criteria

- Multiple full duels complete from initial draw to `MSG_WIN`.
- Both players can win under deterministic test scenarios.
- No reachable prompt is silently auto-selected for the human.
- Restarting destroys the old duel and creates a clean session.

## Milestone 7 — Verification and browser packaging

### Automated verification

- Typecheck.
- Lint and format checks.
- Unit tests for parser adapter, projector, prompt mapping and opponent policy.
- Deterministic Worker integration tests.
- Browser smoke test using the production bundle.

### Manual verification

- Chrome, Firefox and Safari desktop.
- Refresh during loading and after a finished duel.
- Worker failure and missing-script diagnostics.
- Repeated restart without increasing active duel handles.
- Hidden information remains hidden.
- Reasonable load and interaction latency on a mid-range computer.

### Exit criteria

- Production build is deployable as static browser assets.
- One documented command runs all automated gates.
- No current pinned-core prompt/message type is unclassified; explicitly non-presentational/internal messages are documented.
- Full catalog, script and image-manifest integrity checks pass.
- The active duel remains playable if a non-critical image falls back to the missing-image placeholder.

## Suggested implementation order

```text
project skeleton
→ Worker loads WASM
→ headless deterministic duel
→ full database/script/string build pipeline
→ protocol inventory and conformance fixtures
→ state projector
→ prompt adapter
→ scripted opponent
→ minimal Svelte controls
→ complete image manifest/cache pipeline
→ image-backed Phaser field
→ final preset decks
→ full-duel test matrix
→ browser hardening
```

Do not begin with visual polish. The first critical proof is that the Worker can legally advance a deterministic duel and provide valid responses until the core ends it.

## Initial risk register

| Risk | Impact | Mitigation |
|---|---:|---|
| WASM package is immature | High | Fork/pin it and own the adapter. |
| Node example does not work in browser unchanged | High | Browser spike before UI implementation. |
| Missing/incorrect message parsing | High | Fixtures, fail-fast handling and pinned core revision. |
| Script callbacks attempt async fetch | High | Preload all data/scripts before duel processing. |
| Opponent stalls on mandatory choice | High | Deck-specific policy, hot-seat debug and prompt tests. |
| UI state diverges from core | High | Core remains authoritative; reconcile with queries. |
| Hidden information leaks | High | Project public state inside Worker before posting it. |
| Full Project Ignis compatibility expands scope | High | Separate protocol/asset conformance from preset-deck AI; publish against one pinned snapshot. |
| Core/scripts/database/string mismatch | High | Single version manifest, atomic upgrades and rollback to known-good snapshot. |
| Complete image coverage is very large | High | Keep the verified 2.37 GB archive outside JS/Git; active-duel preload and lazy browser cache. |
| Static image host outage/CORS | High | Project-controlled hosting, cache, startup preload and explicit fallback. |
| Upstream changes break protocol parsing | High | Stage updates in CI and block publication until conformance tests pass. |
| Licensing or card/image redistribution issue | High | Document AGPL, verify BabelCDB terms and approve the image provider/cache policy before public deployment. |

## First planning deliverables

Before implementation starts, produce:

1. exact final MVP preset deck lists;
2. the complete current core message/prompt/response inventory;
3. the complete BabelCDB/CardScripts/strings ingestion and integrity specification;
4. the public redistribution/hosting decision for the implemented local image archive;
5. the active-duel card/script/image preload dependency manifest;
6. the opponent policy decision table;
7. the pinned atomic upstream revision manifest and update workflow;
8. the repository/package layout;
9. the first headless deterministic duel test scenario;
10. the licensing/redistribution checklist for database, scripts, strings and images.
