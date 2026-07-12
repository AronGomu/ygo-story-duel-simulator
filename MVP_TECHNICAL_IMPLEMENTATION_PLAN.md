# YGO Story Duel Simulator: Technical MVP Implementation Plan

> Status: implementation-ready draft  
> Scope: browser-based offline duel client only  
> Planning source: accepted `architecture.md` and `mvp_duel_ui_plan.md` documents in this repository.

## 1. Goal

Build a static browser application that starts a Yu-Gi-Oh! duel between:

- one human player using a bundled preset deck;
- one deterministic, deck-specific opponent using a bundled preset deck;
- Project Ignis `ygopro-core` / `ocgcore` as the authoritative rules engine;
- `ocgcore.sync.wasm` running exclusively in a dedicated Web Worker.

The MVP is complete when a production browser build can initialize the pinned engine and asset snapshot, preload the active duel, display all public duel state, accept every human choice required by the preset decks, let the scripted opponent act, and finish with a core-provided result such as `MSG_WIN`.

## 2. MVP boundaries

### Included

- [ ] Direct-to-duel browser application.
- [ ] One bundled player deck and one bundled opponent deck.
- [ ] Current standard-format BabelCDB catalog converted to browser artifacts.
- [ ] Current official and prerelease CardScripts plus required global scripts.
- [ ] Project Ignis system strings required by the duel protocol.
- [ ] Versioned card-image manifest and active-duel image preload.
- [ ] Typed Worker protocol, raw core adapter and serializable public state.
- [ ] Human prompt controls and deterministic deck-specific opponent policy.
- [ ] Svelte application UI and Phaser duel-field rendering.
- [ ] Surrender, restart, result screen and downloadable failure trace.
- [ ] Unit, deterministic integration, asset-integrity and browser smoke tests.

### Excluded

- [ ] Story, dialogue, maps, relationships and progression.
- [ ] Deck editor, card collection, packs, rewards and shops.
- [ ] User-provided decks or generic AI.
- [ ] Online multiplayer, lobbies, chat and server authority.
- [ ] Match and side-deck flow.
- [ ] Replay compatibility with EDOPro.
- [ ] Mobile-first polish.
- [ ] Bundling every card image into the initial application download.

## 3. Technical stack

| Concern | Technology | Responsibility |
|---|---|---|
| Language | TypeScript with strict settings | All browser orchestration, contracts, projection and opponent policy |
| Build | Vite | Development server, Worker/WASM assets and production static build |
| Application UI | Svelte | Loading, prompts, logs, inspector, controls, errors and result |
| Duel field | Phaser | Board coordinates, zones, cards, highlights and presentation feedback |
| Rule engine | Project Ignis `ygopro-core` through `ocgcore-wasm` | Legal actions, effects, rules and final result |
| Isolation | Dedicated Web Worker | Sole owner of WASM, duel handles, scripts and raw protocol |
| Persistent data | IndexedDB through `idb` | Versioned snapshot metadata, preferences and debug runs |
| Image cache | Cache Storage API | Snapshot-aware card-image cache |
| Unit/integration tests | Vitest | Pure modules, Worker adapter, reducers, encoders and deterministic duels |
| Browser tests | Playwright | Production browser smoke path |
| Static quality | ESLint and Prettier | Code and formatting checks |
| CI | GitHub Actions or repository-equivalent CI | Clean install, generation, verification, tests and production build |

## 4. Dependencies to import

Versions must be pinned in `package-lock.json`. Do not use floating Git branches for the rule engine or Project Ignis data.

### Runtime dependencies

```bash
npm install svelte phaser idb
```

- `svelte`: application controls and overlays.
- `phaser`: duel-field rendering only.
- `idb`: small typed wrapper over IndexedDB.

### Engine dependency

Initial spike:

```bash
npm install --save-exact ocgcore-wasm@0.1.2
```

`ocgcore-wasm` is immature. The dependency may be replaced by a pinned Git commit, vendored package or project fork after the Worker spike. The chosen revision must expose the synchronous WASM build and TypeScript API required by the project.

Do not import the engine from Svelte or Phaser modules. Only Worker-owned adapter files may import it.

### Development dependencies

```bash
npm install --save-dev \
  vite typescript @sveltejs/vite-plugin-svelte \
  vitest @vitest/coverage-v8 \
  @playwright/test \
  eslint @eslint/js typescript-eslint eslint-plugin-svelte \
  prettier prettier-plugin-svelte
```

Install Playwright's Chromium browser after package installation:

```bash
npx playwright install chromium
```

Firefox and WebKit can be added when the Chromium production smoke test is green.

### Upstream build-time inputs

These are source inputs to the existing asset synchronization pipeline, not application runtime packages:

- Project Ignis BabelCDB.
- Project Ignis CardScripts.
- Project Ignis Distribution strings.
- Project Ignis-compatible `ygopro-core` embedded by the selected WASM package.
- Configurable card-image provider manifest.

All upstream revisions must be recorded in one generated `manifest.json` with hashes and schema version.

## 5. Repository target layout

```text
.
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── src/
│   ├── app/
│   │   ├── App.svelte
│   │   ├── components/
│   │   └── stores/
│   ├── duel/
│   │   ├── contracts/
│   │   ├── presentation/
│   │   └── presets/
│   ├── field/
│   │   ├── DuelScene.ts
│   │   └── presentationBridge.ts
│   ├── worker/
│   │   ├── duel.worker.ts
│   │   ├── engine/
│   │   ├── protocol/
│   │   ├── projection/
│   │   ├── opponent/
│   │   └── assets/
│   ├── storage/
│   ├── styles/
│   └── main.ts
├── scripts/                    # Existing asset synchronization code
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── unit/
├── e2e/
├── public/
│   ├── engine/
│   └── assets/
└── generated/                 # Ignored generated snapshot
```

## 6. Non-negotiable architecture rules

- [ ] `ocgcore` is the only authority for legal actions and duel results.
- [ ] The main thread never imports or calls `ocgcore-wasm`.
- [ ] Raw core messages and response indexes never leave the Worker.
- [ ] The Worker sends typed domain prompts and immutable public snapshots.
- [ ] Opponent hidden information is removed before a snapshot crosses the Worker boundary.
- [ ] Phaser state is presentation-only and is never queried to decide legality.
- [ ] Synchronous core callbacks read only preloaded in-memory card and script maps.
- [ ] No callback performs `fetch`, IndexedDB access or other asynchronous I/O.
- [ ] Every duel records the exact seed, revision manifest and ordered responses.
- [ ] Every newly supported protocol shape receives a permanent fixture test.
- [ ] Every implementation step below is one commit and leaves working software.

## 7. Definition of a valid implementation commit

Every step below is accepted only when:

- [ ] The step's localized code change is complete.
- [ ] Existing tests still pass.
- [ ] New behavior has an automated test at the lowest practical layer.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes after the application skeleton exists.
- [ ] The documented manual validation for that step succeeds.
- [ ] No temporary logging, skipped test or untracked generated artifact remains.
- [ ] The commit uses the proposed commit message or an equivalent conventional commit.

---

# 8. Ordered implementation plan

## [x] Step 00: Move the planning project and preserve the verified baseline

**Commit:** `chore: move project into implementation repository`

**Working software after completion:** the existing asset importer, verifier and tests run from `C:\Users\Natha\coding\ygo-story-duel-simulator` with the complete generated snapshot and image archive.

- [x] Move all project files into the implementation folder. The source was part of the Brain repository and had no project-local Git metadata to transfer.
- [x] Preserve `.gitignore` rules for `.cache/`, `generated/` and third-party data.
- [x] Keep `node_modules` and generated upstream assets ignored.
- [x] Run `npm ci` from the new location.
- [x] Run `npm test` and confirm all existing importer tests pass.
- [x] Run `npm run typecheck`.
- [x] Run the engine, catalog and image verifiers against the transferred snapshot.
- [x] Preserve the transferred snapshot and verify it through `npm run assets:mvp -- --offline`.
- [x] Record observed verified counts in the asset-pipeline documentation without hard-coding them into tests.

**Long-term test:** clean checkout plus `npm ci && npm test && npm run typecheck`.

## [ ] Step 01: Add the Vite, TypeScript and Svelte application shell

**Commit:** `feat: add browser application shell`

**Working software after commit:** `npm run dev` opens a Svelte page showing the application name and a non-interactive “Duel engine not initialized” status.

- [ ] Install `svelte`, `vite` and `@sveltejs/vite-plugin-svelte`.
- [ ] Add `index.html` and `src/main.ts`.
- [ ] Add `src/app/App.svelte` with a minimal semantic application shell.
- [ ] Add `vite.config.ts` with Svelte support.
- [ ] Extend strict TypeScript configuration for DOM and Web Worker builds.
- [ ] Add `dev`, `build` and `preview` package scripts.
- [ ] Keep existing Node asset scripts under their own TypeScript configuration if browser and Node globals conflict.
- [ ] Add one component smoke test asserting the application heading and initial status.
- [ ] Verify `npm run build` emits static browser assets.

**Manual validation:** open the development and production-preview URLs and confirm the same initial screen renders.

## [ ] Step 02: Add repeatable quality and browser-test commands

**Commit:** `test: establish application quality gates`

**Working software after commit:** one command runs formatting checks, lint, typecheck, unit tests and production build; Playwright can open the built application.

- [ ] Install Vitest and coverage support.
- [ ] Install ESLint with TypeScript and Svelte plugins.
- [ ] Install Prettier with the Svelte plugin.
- [ ] Install Playwright.
- [ ] Add `lint`, `format`, `format:check`, `test:unit`, `test:e2e` and `check` scripts.
- [ ] Preserve the existing Node tests or migrate them to Vitest without reducing assertions.
- [ ] Add a Playwright web-server configuration using the production preview build.
- [ ] Add one browser smoke test that loads the shell and checks the initial status.
- [ ] Add CI configuration running `npm ci`, asset-independent tests, typecheck, lint and build.

**Long-term test:** `npm run check` must remain the local pre-commit quality command.

## [ ] Step 03: Define stable duel-domain and Worker contracts

**Commit:** `feat: define typed duel worker contract`

**Working software after commit:** the shell imports and displays a typed initial `PublicDuelState`; no engine integration exists yet.

- [ ] Add branded types for `DuelId`, `PromptId`, `ChoiceId`, `CardCode` and `SnapshotId`.
- [ ] Define `DuelCommand`: `initialize`, `startDuel`, `respond`, `surrender`, `dispose`.
- [ ] Define `DuelWorkerEvent`: `ready`, `loading`, `state`, `event`, `prompt`, `result`, `error`.
- [ ] Define `PublicDuelState` without raw protocol fields.
- [ ] Define `PlayerPrompt`, `DuelPresentationEvent`, `DuelResult` and `DuelError` discriminated unions.
- [ ] Add exhaustive `assertNever` handling for every union consumer.
- [ ] Add serialization tests proving all contract examples survive structured cloning.
- [ ] Add compile-time fixtures that reject raw `bigint`, functions and non-cloneable values at the Worker boundary.

**Long-term test:** contract fixtures become mandatory review points for any protocol shape change.

## [ ] Step 04: Establish a real typed Worker transport

**Commit:** `feat: connect application to duel worker`

**Working software after commit:** the browser starts a dedicated Worker, sends `initialize`, and displays a mocked typed `ready` event.

- [ ] Add `src/worker/duel.worker.ts`.
- [ ] Add a main-thread `DuelWorkerClient` with typed `send`, event subscription and disposal.
- [ ] Give every Worker instance a session identifier.
- [ ] Ignore events from disposed or replaced sessions.
- [ ] Convert uncaught Worker errors and message errors into typed `DuelError` events.
- [ ] Display Worker startup, ready and failure states in Svelte.
- [ ] Add unit tests using a fake Worker transport.
- [ ] Extend the browser smoke test to assert the mocked ready state.

**Manual validation:** reload and dispose the application repeatedly without duplicate ready events.

## [ ] Step 05: Pin and load the synchronous WASM core in the Worker

**Commit:** `feat: load pinned ocgcore wasm in worker`

**Working software after commit:** the Worker loads `ocgcore.sync.wasm` and reports the real core version to the shell.

- [ ] Install and pin `ocgcore-wasm` or add the selected vendored/forked package.
- [ ] Record the package and embedded core revisions in the project manifest.
- [ ] Add a Worker-owned `OcgCoreAdapter` module as the only engine import location.
- [ ] Configure Vite to emit and resolve the WASM binary in development and production.
- [ ] Load only the synchronous build.
- [ ] Read and validate the exposed core version.
- [ ] Fail with `engine_initialization_failed` when the module or binary cannot load.
- [ ] Terminate the Worker after a configurable initialization timeout.
- [ ] Add adapter tests with a fake WASM module.
- [ ] Extend Playwright smoke coverage to assert the real core version is visible.

**Manual validation:** temporarily remove the WASM asset and confirm a readable error replaces an indefinite loading state.

## [ ] Step 06: Expose and validate the atomic asset snapshot at runtime

**Commit:** `feat: load verified asset snapshot manifest`

**Working software after commit:** the startup screen displays the active snapshot ID and refuses to continue when an artifact hash or schema is incompatible.

- [ ] Define a versioned runtime manifest TypeScript schema.
- [ ] Extend the existing generator to publish browser-consumable artifacts under a Vite-served location.
- [ ] Add a generated snapshot ID derived from the complete manifest digest.
- [ ] Add artifact byte length and SHA-256 validation.
- [ ] Load the manifest before enabling `startDuel`.
- [ ] Compare core, database, CardScripts, strings and image-manifest revisions as one unit.
- [ ] Reject unsupported manifest schema versions.
- [ ] Add fixtures for valid, missing, malformed and hash-mismatched manifests.
- [ ] Display snapshot validation progress and specific failure information.

**Long-term test:** `npm run assets:verify` and runtime-manifest fixture tests run for every asset pipeline change.

## [ ] Step 07: Add bundled preset decks and strict deck parsing

**Commit:** `feat: add validated mvp preset decks`

**Working software after commit:** the application lists one preset duel and validates both decks against the active catalog without starting the engine.

- [ ] Select the final simple player and opponent deck lists.
- [ ] Store presets as versioned project data, not component constants.
- [ ] Implement strict `.ydk` parsing for Main, Extra and Side sections.
- [ ] Reject malformed lines, invalid IDs and unsupported Side Deck content.
- [ ] Validate every card code against the active catalog.
- [ ] Validate MVP constraints such as deck size and supported mechanics.
- [ ] Derive the unique active-duel card-code set.
- [ ] Add parser tests for comments, line endings, invalid values and duplicate entries.
- [ ] Add a locked fixture containing the exact MVP deck lists and expected counts.

**Manual validation:** corrupt one deck ID and confirm duel start is disabled with the exact missing code.

## [ ] Step 08: Build the active-duel dependency resolver

**Commit:** `feat: resolve active duel data and scripts`

**Working software after commit:** selecting the preset duel loads all required card records, text, global scripts and card scripts into Worker-owned memory and reports dependency counts.

- [ ] Load only catalog shards needed by the active card-code set.
- [ ] Load localized text shards for the same cards.
- [ ] Load `constant.lua`, `utility.lua` and all required global/procedure scripts.
- [ ] Load the active decks' `c<ID>.lua` scripts.
- [ ] Resolve aliases and script dependencies required by the selected cards.
- [ ] Store normalized card data in a synchronous `Map<CardCode, OcgCardData>`.
- [ ] Store scripts in a synchronous `Map<string, string>`.
- [ ] Fail before duel creation if required data, text or script is missing.
- [ ] Emit loading progress by artifact group.
- [ ] Add dependency-resolver tests with complete and intentionally incomplete fixtures.

**Long-term test:** every preset deck update runs dependency resolution without creating a duel.

## [ ] Step 09: Wrap the core callbacks and duel-handle lifetime

**Commit:** `feat: manage ocgcore duel sessions`

**Working software after commit:** the Worker can create and immediately destroy a duel using real synchronous card and script callbacks without leaking handles.

- [ ] Implement synchronous `cardReader` using only the in-memory card map.
- [ ] Implement synchronous `scriptReader` using only the in-memory script map.
- [ ] Convert missing callback inputs into captured fatal diagnostics.
- [ ] Add a `DuelSession` owner around the raw duel handle.
- [ ] Make `dispose` idempotent.
- [ ] Ensure initialization failure also destroys a partially created duel.
- [ ] Reject a second `startDuel` while a live session exists.
- [ ] Add handle-lifecycle tests with create/destroy counters.
- [ ] Add a repeated create/dispose integration test.

**Manual validation:** start and dispose 100 empty sessions in a development diagnostic and confirm active handle count returns to zero.

## [ ] Step 10: Start a seeded headless duel and capture raw messages

**Commit:** `feat: run seeded headless duel loop`

**Working software after commit:** the Worker creates the preset duel, adds deck cards, starts processing and stops cleanly at the first unimplemented interactive message.

- [ ] Define a reproducible non-zero duel seed format.
- [ ] Add cards to the correct player, location, sequence and position.
- [ ] Apply starting LP, draw count and Master Rule configuration.
- [ ] Start the duel only after all synchronous callback inputs are available.
- [ ] Implement the `duelProcess` loop and message-buffer reads.
- [ ] Capture process statuses and raw message bytes in development traces.
- [ ] Detect `MSG_WIN`, engine error, process timeout and unsupported message.
- [ ] Add a maximum process-iteration guard against runaway execution.
- [ ] Emit a structured failure instead of hanging on the first unsupported prompt.
- [ ] Add an integration test asserting the first deterministic message sequence.

**Long-term test:** the same seed and snapshot must preserve the expected trace prefix.

## [ ] Step 11: Parse non-interactive core events

**Commit:** `feat: parse core duel events`

**Working software after commit:** the headless trace shows typed draw, move, summon, phase, LP, chain and finish events until an interactive prompt is reached.

- [ ] Inventory non-interactive message constants from the pinned core.
- [ ] Implement a bounded binary reader with offset and length errors.
- [ ] Parse draw, shuffle, move, position and set events.
- [ ] Parse summon, special summon, flip summon and negation events.
- [ ] Parse phase, turn, attack, battle and damage/recovery events.
- [ ] Parse chain creation, solving and completion events.
- [ ] Parse hints, card hints and system-string references.
- [ ] Parse `MSG_WIN` into a domain `DuelResult`.
- [ ] Preserve unknown message type and bytes in a diagnostic error.
- [ ] Add one binary fixture per parsed message shape.

**Long-term test:** malformed and truncated fixtures must fail deterministically without reading outside their buffers.

## [ ] Step 12: Project authoritative public duel state

**Commit:** `feat: project public duel state`

**Working software after commit:** the shell displays live LP, turn, phase and zone counts from immutable Worker snapshots while the headless duel progresses.

- [ ] Implement a Worker-side `DuelStateProjector`.
- [ ] Project player identities, LP, turn player and current phase.
- [ ] Project Main Deck and Extra Deck counts.
- [ ] Project human hand identities and opponent hand count only.
- [ ] Project monster, spell/trap, field, GY and banished zones.
- [ ] Project card position, controller, owner and public/hidden state.
- [ ] Project overlay materials and active chain summary where available.
- [ ] Reconcile ambiguous event state through core field/location queries.
- [ ] Assert that a physical card instance cannot occupy two zones.
- [ ] Strip private opponent fields before posting snapshots.
- [ ] Add recorded event-to-state fixture tests.
- [ ] Add explicit hidden-information regression tests.

**Manual validation:** inspect Worker messages and confirm opponent hand identities are absent, not merely hidden by CSS.

## [ ] Step 13: Implement idle and battle command prompts

**Commit:** `feat: support idle and battle commands`

**Working software after commit:** a debug control surface can select legal Main Phase and Battle Phase commands and return encoded responses to the core.

- [ ] Parse idle-command options into stable domain choices.
- [ ] Parse battle-command options into stable domain choices.
- [ ] Represent summon, set, activate, change position, attack, phase and cancel choices.
- [ ] Generate opaque prompt and choice IDs.
- [ ] Keep raw response indexes in a Worker-private lookup.
- [ ] Encode the selected command through the pinned adapter.
- [ ] Reject stale, duplicate and unknown choice IDs.
- [ ] Add binary prompt fixtures and response-byte assertions.
- [ ] Add a test proving a response cannot answer a later prompt.

**Long-term test:** all command response encodings remain pinned to fixtures when the core dependency changes.

## [ ] Step 14: Implement yes/no, effect, option and chain prompts

**Commit:** `feat: support decision and chain prompts`

**Working software after commit:** the debug control surface handles effect confirmation, options and chain decisions and can continue past the preset decks' first interaction.

- [ ] Parse generic yes/no prompts.
- [ ] Parse effect yes/no prompts with card and effect context.
- [ ] Parse option selection using localized card/system strings.
- [ ] Parse chain selection including pass/cancel rules.
- [ ] Preserve mandatory versus optional semantics.
- [ ] Encode each response family inside the Worker.
- [ ] Add labels suitable for human UI without exposing protocol indexes.
- [ ] Add fixture tests for zero, one and multiple chain candidates.
- [ ] Add fixture tests for missing string fallback diagnostics.

**Long-term test:** every prompt fixture includes both parsed domain output and encoded response assertions.

## [ ] Step 15: Implement card, tribute and sum selection prompts

**Commit:** `feat: support card selection prompts`

**Working software after commit:** the debug control surface supports single and multi-card selection required by the preset decks.

- [ ] Parse card selection with minimum, maximum and cancelability.
- [ ] Parse unselect-card toggles.
- [ ] Parse tribute selection and contribution values.
- [ ] Parse sum selection and required arithmetic constraints.
- [ ] Represent selectable cards using stable public card-instance IDs.
- [ ] Validate minimum, maximum and sum constraints before encoding.
- [ ] Prevent selection of stale or non-candidate card instances.
- [ ] Encode ordered and unordered selections as required by each message.
- [ ] Add boundary fixtures for minimum, maximum, cancellation and impossible sum.
- [ ] Add property-style tests for valid sum combinations if the algorithm is non-trivial.

**Long-term test:** each reported selection bug becomes a minimal fixture before its fix.

## [ ] Step 16: Implement place, position, sort, counter and announcement prompts

**Commit:** `feat: complete core prompt families`

**Working software after commit:** the debug control surface can represent and answer every interactive prompt family in the pinned compatibility inventory.

- [ ] Parse place and disabled-field selection.
- [ ] Parse battle-position selection.
- [ ] Parse card and chain sorting.
- [ ] Parse counter allocation.
- [ ] Parse number announcement.
- [ ] Parse attribute and race announcement.
- [ ] Parse card-name announcement without adding a user-facing deck editor.
- [ ] Parse rock-paper-scissors and turn-choice messages where present.
- [ ] Classify any additional pinned-core prompt family.
- [ ] Encode and fixture every response family.
- [ ] Document internal or non-presentational messages that require no UI.
- [ ] Fail with a downloadable compatibility trace for an unknown prompt.

**Long-term test:** a generated compatibility matrix fails CI when a pinned message constant has no parser classification.

## [ ] Step 17: Complete a deterministic headless duel to `MSG_WIN`

**Commit:** `test: complete deterministic headless duel`

**Working software after commit:** an automated Worker integration test loads real assets and decks, answers both players deterministically and reaches `MSG_WIN`.

- [ ] Add a deterministic legal-choice strategy for both players.
- [ ] Prefer the first valid choice only where no semantic policy is needed.
- [ ] Record every prompt, selected choice and encoded response.
- [ ] Persist the expected result, winner, finish reason and trace digest fixture.
- [ ] Run the same seed twice and compare ordered traces.
- [ ] Assert no missing card, script, string or image-manifest record is reported.
- [ ] Assert all created duel handles are destroyed.
- [ ] Add a timeout that reports the last message and pending prompt.
- [ ] Run this test against the production-built Worker asset path.

**Release significance:** this is the first proof that the complete engine integration works without UI assistance.

## [ ] Step 18: Add the deterministic deck-specific opponent policy

**Commit:** `feat: add scripted mvp opponent`

**Working software after commit:** the human side remains debug-controlled while the opponent takes coherent turns using explicit priorities and logged reasons.

- [ ] Define a pure `OpponentPolicy` interface over typed prompts and visible state.
- [ ] Add phase-progression priorities.
- [ ] Add normal summon and set priorities.
- [ ] Add spell/trap activation priorities.
- [ ] Add chain yes/no priorities.
- [ ] Add target scoring.
- [ ] Add attacker and battle-target scoring.
- [ ] Add mandatory-prompt fallback behavior.
- [ ] Return a machine-readable decision reason with every choice.
- [ ] Prevent access to human hidden information.
- [ ] Add one unit fixture per decision-table row.
- [ ] Add fixed-seed integration tests for meaningful opponent turns.

**Long-term test:** policy tests use typed prompt fixtures and do not instantiate Phaser, Svelte or WASM.

## [ ] Step 19: Add the main-thread duel store and presentation bridge

**Commit:** `feat: add duel presentation state store`

**Working software after commit:** Svelte displays the current state, prompt, event log and result from the real Worker without Phaser.

- [ ] Add a main-thread store that owns the latest immutable Worker snapshot.
- [ ] Track initialization, loading, active, awaiting-input, completed and failed states.
- [ ] Keep only one current prompt.
- [ ] Clear stale prompts when a new session starts.
- [ ] Add a bounded presentation-event log.
- [ ] Expose command methods for start, respond, surrender, restart and dispose.
- [ ] Add a presentation bridge interface for Phaser.
- [ ] Keep the Worker client out of Phaser modules.
- [ ] Add store tests using ordered fake Worker events.

**Long-term test:** out-of-order and previous-session events cannot mutate the current session store.

## [ ] Step 20: Implement the Svelte duel controls

**Commit:** `feat: add human duel controls`

**Working software after commit:** the human can complete the preset duel through accessible Svelte controls without debug response entry.

- [ ] Add startup and asset-loading progress states.
- [ ] Add LP, turn, phase and deck-count display.
- [ ] Add typed controls for every prompt family.
- [ ] Add card detail and effect-text inspection.
- [ ] Add chain and event log display.
- [ ] Add explicit confirmation where a destructive or irreversible choice needs it.
- [ ] Disable controls immediately after a response is sent.
- [ ] Restore focus predictably when a new prompt appears.
- [ ] Add keyboard access and visible focus for every action.
- [ ] Add empty, unsupported and engine-error states.
- [ ] Add component tests for representative prompt families.
- [ ] Extend Playwright to make one real human choice.

**Manual validation:** complete one duel using keyboard-only controls.

## [ ] Step 21: Add the Phaser field and zone layout

**Commit:** `feat: render duel field with phaser`

**Working software after commit:** Phaser renders both players' zones and card placeholders from public snapshots while Svelte remains responsible for controls.

- [ ] Install and initialize Phaser only after the containing element mounts.
- [ ] Add a `DuelScene` with a deterministic desktop coordinate system.
- [ ] Render monster, spell/trap, field, deck, Extra Deck, GY and banished zones.
- [ ] Render human hand and hidden opponent hand placeholders.
- [ ] Map public card-instance IDs to presentation objects.
- [ ] Apply snapshots idempotently.
- [ ] Highlight selectable cards and zones from the current domain prompt.
- [ ] Forward selection intent to Svelte/store rather than directly to the Worker.
- [ ] Dispose the Phaser game and scene listeners on application teardown.
- [ ] Add pure layout tests for zone coordinates and card mapping.

**Long-term test:** applying the same snapshot twice does not duplicate sprites or listeners.

## [ ] Step 22: Add card images, card backs and persistent image caching

**Commit:** `feat: render and cache active duel card images`

**Working software after commit:** all active-duel cards preload before input is enabled and render the correct face or card back in every public location.

- [ ] Install `idb`.
- [ ] Resolve active-deck image records from the versioned image manifest.
- [ ] Preload unique active-deck images before enabling duel input.
- [ ] Use snapshot-aware Cache Storage keys.
- [ ] Deduplicate concurrent requests for the same image.
- [ ] Add deterministic missing-image placeholders.
- [ ] Use card backs for face-down and hidden cards.
- [ ] Revoke temporary object URLs when no longer needed.
- [ ] Surface provider, snapshot and missing-code diagnostics.
- [ ] Render images in Phaser, Svelte prompts and the card inspector.
- [ ] Add cache hit, miss, provider failure and stale-snapshot tests.
- [ ] Extend Playwright to assert a face-up card image and hidden card back.

**Long-term test:** image-provider outages do not prevent a duel when cached images or placeholders are available.

## [ ] Step 23: Add minimal non-blocking duel presentation feedback

**Commit:** `feat: add duel presentation feedback`

**Working software after commit:** summons, moves, attacks and LP changes have clear visual feedback without changing engine timing or response order.

- [ ] Translate typed duel events into presentation commands.
- [ ] Add short card-move feedback.
- [ ] Add summon, set and position-change feedback.
- [ ] Add attack indication.
- [ ] Add damage, recovery and LP-change feedback.
- [ ] Add chain-state emphasis.
- [ ] Make all feedback cancellable on restart or disposal.
- [ ] Respect `prefers-reduced-motion`.
- [ ] Never delay Worker processing while an animation runs.
- [ ] Add presentation-command tests independent of Phaser rendering.

**Long-term test:** disabling all animation produces the same Worker response trace and final result.

## [ ] Step 24: Add surrender, result, restart and clean session replacement

**Commit:** `feat: complete duel lifecycle controls`

**Working software after commit:** users can surrender, see a structured result and start a clean replacement duel without reloading the page.

- [ ] Implement Worker-side surrender handling through the appropriate core path.
- [ ] Emit winner, loser and finish reason from core messages.
- [ ] Add completed, surrendered, unsupported and engine-error result variants.
- [ ] Add a Svelte result screen.
- [ ] Add restart that first disposes the current session.
- [ ] Replace the Worker if graceful disposal exceeds the timeout.
- [ ] Clear presentation sprites, prompts, event log and transient image references.
- [ ] Add lifecycle tests for finish, surrender, restart during loading and restart after error.
- [ ] Add a repeated restart browser test.

**Long-term test:** repeated restart does not increase active handles, Worker listeners or Phaser objects.

## [ ] Step 25: Add structured diagnostics and trace download

**Commit:** `feat: add reproducible duel diagnostics`

**Working software after commit:** any unsupported message, engine error or timeout produces a downloadable JSON trace sufficient to reproduce the run.

- [ ] Record application build and browser metadata.
- [ ] Record core, database, script, string and image-manifest revisions.
- [ ] Record preset duel ID and deterministic seed.
- [ ] Record ordered process statuses and parsed message types.
- [ ] Record projected events and both players' responses.
- [ ] Record opponent decision reasons.
- [ ] Record the last successful message and pending prompt on failure.
- [ ] Exclude hidden card identities not needed for an authorized local debug trace, or clearly mark debug traces as sensitive.
- [ ] Bound in-memory trace size.
- [ ] Add “Download diagnostics” to error and result surfaces.
- [ ] Add trace-schema and redaction tests.

**Long-term test:** every production error variant has a fixture proving its trace remains serializable and schema-compatible.

## [ ] Step 26: Add versioned snapshot storage and atomic activation

**Commit:** `feat: cache and activate asset snapshots atomically`

**Working software after commit:** the application caches a verified snapshot, activates it only after full validation and can continue with the previous known-good snapshot after a failed update.

- [ ] Define IndexedDB stores for snapshot metadata, preferences and debug-run metadata.
- [ ] Stage a new snapshot under its immutable snapshot ID.
- [ ] Verify every required staged artifact.
- [ ] Mark the snapshot active in one final transaction.
- [ ] Retain one previous known-good snapshot.
- [ ] Reject mixed artifact revisions.
- [ ] Clean abandoned staging data safely.
- [ ] Namespace image caches by snapshot/provider version.
- [ ] Add upgrade, rollback, interrupted-write and quota-error tests.
- [ ] Display active and fallback snapshot IDs in diagnostics.

**Long-term test:** kill the browser during staging and confirm the previous snapshot remains active on next startup.

## [ ] Step 27: Complete deterministic duel and end-condition coverage

**Commit:** `test: cover mvp duel scenarios and end conditions`

**Working software after commit:** automated scenarios prove both players can win and all MVP lifecycle paths complete without unsupported reachable prompts.

- [ ] Add a deterministic scenario where the human wins.
- [ ] Add a deterministic scenario where the opponent wins.
- [ ] Add LP-zero coverage.
- [ ] Add deck-out coverage if reachable by the selected decks.
- [ ] Add surrender coverage.
- [ ] Add at least one chain interaction.
- [ ] Add summon, set, activation, targeting, battle and damage coverage.
- [ ] Assert no human prompt is silently auto-selected.
- [ ] Assert every opponent mandatory prompt receives a policy response.
- [ ] Assert each scenario ends within a bounded turn and process count.
- [ ] Store response transcripts as reviewable fixtures rather than opaque snapshots.

**Long-term test:** any deck-list change must intentionally update these scenario fixtures.

## [ ] Step 28: Add protocol compatibility and asset-integrity CI gates

**Commit:** `ci: enforce protocol and asset compatibility`

**Working software after commit:** CI rejects partial upstream updates, unclassified protocol messages and broken catalog/script/image coverage.

- [ ] Generate the pinned core message and response inventory.
- [ ] Compare the inventory with parser/encoder classifications.
- [ ] Run all binary protocol fixtures.
- [ ] Run catalog, text and image one-to-one coverage checks.
- [ ] Run script index and required-global checks.
- [ ] Run active-deck dependency resolution.
- [ ] Run the deterministic real-Worker duel.
- [ ] Run the production Chromium smoke test.
- [ ] Upload failure diagnostics and traces as CI artifacts.
- [ ] Block snapshot publication unless all compatibility gates pass.

**Long-term test:** upstream synchronization occurs on a separate branch and never mutates the live release snapshot directly.

## [ ] Step 29: Verify production browser behavior

**Commit:** `test: verify production browser duel flow`

**Working software after commit:** the production static bundle initializes, renders cards, accepts human actions and completes a deterministic duel in supported desktop browsers.

- [ ] Run Chromium smoke coverage against the production bundle.
- [ ] Add Firefox after Chromium is stable.
- [ ] Add WebKit as the Safari compatibility proxy.
- [ ] Verify Worker and WASM asset paths under a non-root base URL.
- [ ] Verify refresh during asset loading.
- [ ] Verify refresh after a completed duel.
- [ ] Verify missing-image fallback.
- [ ] Verify Worker termination after a forced timeout.
- [ ] Verify hidden information through main-thread message inspection.
- [ ] Verify keyboard-only prompt completion.
- [ ] Record browser-specific limitations instead of silently skipping tests.

**Long-term test:** the production browser smoke path is required before every release artifact is published.

## [ ] Step 30: Produce the MVP release candidate

**Commit:** `chore: prepare browser duel mvp release`

**Working software after commit:** a clean checkout produces a static, test-verified MVP artifact with documented limitations and no development filesystem assumptions.

- [ ] Run `npm ci` from a clean checkout.
- [ ] Run the complete `npm run check` gate.
- [ ] Regenerate and independently verify the pinned asset snapshot.
- [ ] Run deterministic Worker integration tests.
- [ ] Run production browser tests.
- [ ] Confirm no `console.log`, focused test, skipped test or debug-only control remains.
- [ ] Confirm all active-deck images resolve or use a documented fallback.
- [ ] Document build, run, test and snapshot-update commands.
- [ ] Document known unsupported behavior.
- [ ] Document AGPL source-availability obligations.
- [ ] Verify BabelCDB, strings and image-provider redistribution posture.
- [ ] Keep deployment private if image or content permission remains unresolved.
- [ ] Archive the exact revision manifest and release artifact together.

**Final manual validation:** from a clean browser profile, load the static production application, start the preset duel, perform human actions, finish the duel, restart and download a valid diagnostic trace.

---

# 9. Long-term testing strategy

## Test layers

### Pure unit tests

- [ ] Binary readers reject malformed lengths and offsets.
- [ ] Every protocol message fixture maps to the expected domain event or prompt.
- [ ] Every response fixture produces the expected bytes.
- [ ] State projection preserves zone and hidden-information invariants.
- [ ] Opponent policy returns legal choices and decision reasons.
- [ ] Deck and asset dependency resolvers are deterministic.

### Worker integration tests

- [ ] Real WASM initializes inside a Worker.
- [ ] Real pinned assets satisfy synchronous callbacks.
- [ ] Fixed seeds reproduce traces.
- [ ] Complete duel scenarios reach `MSG_WIN`.
- [ ] Disposal and restart release all session resources.

### Browser tests

- [ ] Production bundle loads from static assets.
- [ ] Worker, WASM and snapshot URLs resolve.
- [ ] Human prompt controls send exactly one response.
- [ ] Face-up images and hidden card backs render correctly.
- [ ] Result, restart and diagnostic download work.

### Asset and compatibility tests

- [ ] Manifest hashes and byte lengths match generated files.
- [ ] Catalog, text and image records have exact ID coverage.
- [ ] Every indexed script exists and has a unique code.
- [ ] Required global scripts exist.
- [ ] Every pinned protocol constant is classified.
- [ ] Upstream updates pass full compatibility tests before activation.

## Regression rule

- [ ] Reproduce every bug with the smallest failing fixture or deterministic duel transcript.
- [ ] Commit the failing test before or with the fix.
- [ ] Keep fixtures human-readable and tied to the pinned core revision.
- [ ] Never update a trace snapshot only to make CI green without explaining the protocol or behavior change.

## Dependency-update rule

- [ ] Update engine, core, BabelCDB, CardScripts, strings and image metadata on an isolated branch.
- [ ] Generate a new immutable snapshot ID.
- [ ] Run protocol inventory comparison.
- [ ] Run all unit and deterministic duel tests.
- [ ] Run production browser tests.
- [ ] Review changed traces and counts.
- [ ] Activate the snapshot only after all checks pass.
- [ ] Retain the previous known-good snapshot for rollback.

# 10. Recommended implementation checkpoints

- [ ] **Checkpoint A, after Step 05:** real WASM loads in a Worker.
- [ ] **Checkpoint B, after Step 10:** a seeded duel starts and emits raw messages.
- [ ] **Checkpoint C, after Step 17:** a deterministic headless duel reaches `MSG_WIN`.
- [ ] **Checkpoint D, after Step 20:** a human can duel without raw debug controls.
- [ ] **Checkpoint E, after Step 24:** the complete visible duel lifecycle works.
- [ ] **Checkpoint F, after Step 29:** the production bundle passes browser verification.
- [ ] **Checkpoint G, after Step 30:** the MVP release artifact is reproducible and documented.

Do not begin story, deck-editor or progression implementation before Checkpoint G is accepted.
