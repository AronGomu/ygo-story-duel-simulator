# YGO Story Duel Simulator: Technical MVP Implementation Plan

> Status: headless Checkpoint C complete locally; visual implementation not started
> Scope: browser-based offline duel client only
> Planning source: canonical [`architecture/architecture.md`](architecture/architecture.md) and its granular decision files.

## 1. Goal

Build a static browser duel simulator that starts a normal Yu-Gi-Oh! game between:

- one human player using a bundled preset deck;
- one basic computer opponent using a bundled deck made only from simple, straightforward cards;
- Project Ignis `ygopro-core` / `ocgcore` as the authoritative rules engine;
- a vendored copy of `ocgcore-wasm@0.1.2`, with `ocgcore.sync.wasm` running exclusively in a dedicated Web Worker.

Production games shuffle both Main Decks and draw randomized starting hands normally. Deterministic deck orders, starting hands, seeds and responses exist only in the integration-test harness and diagnostic replay path.

The MVP is complete when a production browser build can initialize the vendored engine and verified asset snapshot, shuffle and start the preset duel, display all public duel state, accept every human choice, let the basic opponent take legal straightforward actions, and finish with a core-provided result such as `MSG_WIN`.

## 2. MVP boundaries

### Included

- [ ] Direct-to-duel browser application.
- [x] One bundled player deck and one deliberately simple opponent deck.
- [x] Normal randomized deck shuffling and starting hands in production duels.
- [x] Programmed integration scenarios that inject exact deck order, starting hands and responses for the same two preset decks.
- [x] Current standard-format BabelCDB catalog converted to browser artifacts.
- [x] Current official and prerelease CardScripts plus required global scripts.
- [x] Project Ignis system strings required by the duel protocol.
- [ ] Versioned card-image manifest and active-duel image preload.
- [x] Typed Worker protocol, core adapter and serializable public state (unknown raw-message byte retention remains deferred).
- [x] Headless human prompt contracts and a basic legal-action opponent policy with no combo planning.
- [ ] Svelte application UI and Phaser duel-field rendering.
- [ ] Surrender, restart, result screen and downloadable failure trace.
- [ ] Unit, programmed real-WASM integration, asset-integrity and browser smoke tests (all except browser smoke tests exist).
- [x] A mandatory green headless integration gate covering every supported game-action family before any visual duel simulator is implemented.

### Excluded

- [ ] Story, dialogue, maps, relationships and progression.
- [ ] Deck editor, card collection, packs, rewards and shops.
- [ ] User-provided decks, deck selection, deck construction or strategic/general-purpose AI.
- [ ] Online multiplayer, lobbies, chat and server authority.
- [ ] Match and side-deck flow.
- [ ] Replay compatibility with EDOPro.
- [ ] Mobile-first polish.
- [ ] Bundling every card image into the initial application download.

## 3. Technical stack

| Concern | Technology | Responsibility |
|---|---|---|
| Language | TypeScript with strict settings | Browser orchestration, contracts, projection, programmed integration driver and basic opponent policy |
| Build | Vite | Development server, Worker/WASM assets and production static build |
| Application UI | Svelte | Loading, prompts, logs, inspector, controls, errors and result |
| Duel field | Phaser | Board coordinates, zones, cards, highlights and presentation feedback |
| Rule engine | Project Ignis `ygopro-core` through `ocgcore-wasm` | Legal actions, effects, rules and final result |
| Isolation | Dedicated Web Worker | Sole owner of WASM, duel handles, scripts and raw protocol |
| Persistent data | IndexedDB through `idb` | Versioned snapshot metadata, preferences and debug runs |
| Image cache | Cache Storage API | Snapshot-aware card-image cache |
| Unit/integration tests | Vitest | Pure modules, Worker adapter, reducers, encoders and programmed real-WASM duels |
| Browser tests | Playwright | Production browser smoke path |
| Static quality | ESLint and Prettier | Code and formatting checks |
| CI | GitHub Actions or repository-equivalent CI | Clean install, generation, verification, tests and production build |

## 4. Dependencies to import

Versions must be pinned in `package-lock.json`. Do not use floating Git branches for the rule engine or Project Ignis data.

### Runtime dependencies

Do not install visual runtime dependencies before the mandatory headless integration gate. After it is green, add them only in the step that first uses them:

```bash
npm install svelte       # Step 19
npm install phaser       # Step 21
npm install idb          # Step 22/26
```

- `svelte`: application controls and overlays.
- `phaser`: duel-field rendering only.
- `idb`: small typed wrapper over IndexedDB.

### Vendored engine dependency

`ocgcore-wasm@0.1.2` is mandatory and must be vendored into this repository. It must not remain a runtime dependency resolved from npm or a floating Git reference.

Vendor the exact integrity-verified package contents required by the synchronous build:

```text
vendor/ocgcore-wasm/0.1.2/
├── LICENSE
├── README.md
├── package.json
├── dist/
└── lib/
    ├── ocgcore.sync.mjs
    └── ocgcore.sync.wasm
```

Record the source package URL, npm SHA-512 integrity value, package version, embedded core revision when discoverable, complete file hashes and local patches in the project manifest. The application imports only this checked-in vendored copy. Updating it requires an explicit reviewed vendor update and the complete programmed integration suite.

Do not import the engine from Svelte or Phaser modules. Only Worker-owned adapter files may import it.

### Development dependencies

Install only headless quality tooling before the integration gate:

```bash
npm install --save-dev \
  typescript vitest @vitest/coverage-v8 \
  eslint @eslint/js typescript-eslint prettier
```

After Step 17 is green and the visual gate is accepted, install browser tooling:

```bash
npm install --save-dev \
  vite @sveltejs/vite-plugin-svelte \
  @playwright/test eslint-plugin-svelte \
  prettier-plugin-svelte
npx playwright install chromium
```

Firefox and WebKit can be added when the Chromium production smoke test is green.

### Upstream build-time inputs

These are source inputs to the existing asset synchronization pipeline, not application runtime packages:

- Project Ignis BabelCDB.
- Project Ignis CardScripts.
- Project Ignis Distribution strings.
- Project Ignis-compatible `ygopro-core` embedded by the vendored `ocgcore-wasm@0.1.2` package.
- Configurable card-image provider manifest.

All upstream revisions must be recorded in one generated `manifest.json` with hashes and schema version.

## 5. Repository target layout

```text
.
├── context.md
├── docs/
│   ├── README.md
│   ├── MVP_TECHNICAL_IMPLEMENTATION_PLAN.md
│   ├── architecture/
│   │   ├── architecture.md
│   │   └── <numbered concern folders>/
│   ├── assets/
│   └── archive/
├── index.html
├── package.json
├── vendor/
│   └── ocgcore-wasm/0.1.2/   # Checked-in, integrity-verified engine package
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
- [x] Production games use normal randomized deck order and starting hands; only tests and diagnostic replay may inject deterministic orders or seeds.
- [x] `ocgcore-wasm@0.1.2` is checked into `vendor/` with provenance and hashes; npm or live Git resolution is forbidden at runtime and build time.
- [x] The main thread never imports or calls `ocgcore-wasm`.
- [x] Raw core messages and response indexes never leave the Worker.
- [x] The Worker sends typed domain prompts and immutable public snapshots.
- [x] Opponent hidden information is removed before a snapshot crosses the Worker boundary.
- [ ] Phaser state is presentation-only and is never queried to decide legality.
- [x] Synchronous core callbacks read only preloaded in-memory card and script maps.
- [x] No callback performs `fetch`, IndexedDB access or other asynchronous I/O.
- [ ] Every duel records the exact seed, revision manifest and ordered responses.
- [ ] Every newly supported protocol shape receives a permanent fixture test.
- [ ] The programmed real-WASM integration suite is written first and must cover every supported game-action family using the two preset decks.
- [x] No Svelte duel controls, Phaser field, card rendering or other visual duel-simulator work begins until that complete headless suite is green.
- [ ] Every implementation step below is one commit and leaves working software.

## 7. Definition of a valid implementation commit

Every step below is accepted only when:

- [ ] The step's localized code change is complete.
- [x] Existing tests still pass.
- [ ] New behavior has an automated test at the lowest practical layer, written before its implementation.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes.
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

## [x] Step 01: Write the programmed headless integration suite first

**Commit:** `test: define programmed preset duel integration scenarios`

**Working software after commit:** an executable integration specification defines two preset decks, exact test-only deck orders and starting hands, programmed responses, expected traces and a complete supported-action coverage matrix. This suite is the primary acceptance contract for all headless implementation work.

- [x] Select one preset human deck and one opponent deck made only from simple, straightforward cards.
- [x] Keep production deck lists separate from test-only ordering and starting-hand overrides.
- [x] Define multiple programmed games using the same two decks when one game cannot cover every action family.
- [x] Record exact per-player deck order, starting hand, seed, ordered prompt choices, expected winner and finish reason for each scenario.
- [x] Use stable semantic card/place fingerprints (code, controller, location, sequence and occurrence) instead of raw engine indexes.
- [x] Create an exhaustive MVP action matrix for draw, shuffle, phase changes, normal/tribute/special/flip summon, set, activate, chain/pass, target/select, position change, direct and monster attacks, battle damage, effect damage/recovery, destruction, send to GY, banish, surrender and every prompt family in the pinned compatibility inventory—not only actions chosen by the basic AI.
- [x] Add a real-WASM integration entry point that will run the programmed scenarios once the headless adapter exists.
- [x] Make missing action coverage a test failure rather than a documentation warning.
- [x] Require every future preset-deck change to update the programmed scenarios intentionally through deck-equivalence and transcript-drift assertions.

**Blocking rule:** author each integration assertion before the implementation that satisfies it. The red-green work may span the headless steps below, but no visual application dependency or UI file may be introduced until the complete suite reaches `MSG_WIN` and the action matrix is green.

## [ ] Step 02: Add repeatable headless quality commands

**Commit:** `test: establish headless quality gates`

**Working software after commit:** one command runs formatting, lint, typecheck, unit tests, asset verification and the programmed integration suite without a browser or visual framework.

- [x] Install Vitest and coverage support.
- [x] Install ESLint with TypeScript support.
- [x] Install Prettier.
- [x] Add `lint`, `format`, `format:check`, `test:unit`, `test:integration` and `check:headless` scripts.
- [x] Preserve the existing Node tests or migrate them to Vitest without reducing assertions.
- [x] Keep the programmed integration suite visibly gated in `check:headless`; do not silently skip it.
- [ ] Add CI configuration running clean install, asset verification, typecheck, lint, unit tests and programmed integration tests.
- [x] Defer Svelte, Phaser, Vite and Playwright installation until the headless visual-implementation gate is green.

**Long-term test:** `npm run check:headless` remains mandatory and must pass before any visual change is accepted.

## [ ] Step 03: Define stable duel-domain and Worker contracts

**Commit:** `feat: define typed duel worker contract`

**Working software after commit:** the programmed integration harness compiles against typed commands, prompts, events and `PublicDuelState`; no visual consumer exists yet.

- [x] Add branded types for `DuelId`, `PromptId`, `ChoiceId`, `CardCode` and `SnapshotId`.
- [x] Define `DuelCommand`: `initialize`, `startDuel`, `respond`, `surrender`, `dispose`.
- [x] Define `DuelWorkerEvent`: `ready`, `loading`, `state`, `event`, `prompt`, `result`, `error`.
- [x] Define `PublicDuelState` without raw protocol fields.
- [ ] Define `PlayerPrompt`, `DuelPresentationEvent`, `DuelResult` and `DuelError` discriminated unions.
- [ ] Add exhaustive `assertNever` handling for every union consumer.
- [ ] Add serialization tests proving all contract examples survive structured cloning.
- [ ] Add compile-time fixtures that reject raw `bigint`, functions and non-cloneable values at the Worker boundary.

**Long-term test:** contract fixtures become mandatory review points for any protocol shape change.

## [x] Step 04: Vendor `ocgcore-wasm@0.1.2`

**Commit:** `build: vendor ocgcore wasm 0.1.2`

**Working software after commit:** a clean checkout contains the complete approved synchronous engine package under `vendor/` and verifies it without contacting npm or GitHub.

- [x] Extract the integrity-verified `ocgcore-wasm@0.1.2` package into `vendor/ocgcore-wasm/0.1.2/`.
- [x] Include the synchronous WASM binary, Emscripten module, distributed adapter files, declarations, package metadata, README and applicable license text.
- [x] Record the npm tarball URL and exact SHA-512 integrity value.
- [x] Generate a reviewed manifest containing every vendored file's path, size and SHA-256.
- [x] Record any local patch in a dedicated patch/provenance section; do not edit vendored files silently.
- [x] Add a verifier that rejects missing, extra or hash-mismatched vendor files.
- [x] Make application builds and tests fail if they resolve `ocgcore-wasm` from `node_modules`.
- [x] Keep future vendor updates isolated and require the complete programmed integration suite.

**Manual validation:** remove npm/network access and confirm the vendored engine verifier still passes.

## [ ] Step 05: Load the vendored synchronous WASM core headlessly

**Commit:** `feat: load vendored ocgcore wasm headlessly`

**Working software after commit:** the headless integration harness loads the vendored `ocgcore.sync.wasm`, reports the real core version and performs no network or `node_modules` engine resolution.

- [ ] Add a headless `src/worker/duel.worker.ts` entry point used directly by the integration harness, without a main-thread visual client.
- [x] Add a Worker-owned `OcgCoreAdapter` module as the only engine import location.
- [x] Resolve the synchronous module and WASM binary only from `vendor/ocgcore-wasm/0.1.2/`.
- [x] Record the vendored package and embedded core revisions in the project manifest.
- [x] Load only the synchronous build.
- [x] Read and validate the exposed core version.
- [ ] Fail with `engine_initialization_failed` when a vendored module or binary cannot load.
- [ ] Terminate the headless Worker after a configurable initialization timeout.
- [x] Add adapter tests with a fake WASM module and one real vendored-WASM smoke test.
- [ ] Assert the test succeeds with npm/network access disabled.

**Manual validation:** temporarily remove the vendored WASM asset and confirm the headless test reports a bounded, readable initialization error.

## [ ] Step 06: Expose and validate the atomic asset snapshot at runtime

**Commit:** `feat: load verified asset snapshot manifest`

**Working software after commit:** the headless integration harness reports the active snapshot ID and refuses to create a duel when an artifact hash or schema is incompatible.

- [x] Define a versioned runtime manifest TypeScript schema.
- [ ] Extend the existing generator to publish runtime-consumable immutable artifacts without depending on Vite or visual application code.
- [x] Add a generated snapshot ID derived from the complete manifest digest.
- [x] Add artifact byte length and SHA-256 validation.
- [x] Load the manifest before enabling `startDuel`.
- [x] Compare core, database, CardScripts, strings and image-manifest revisions as one unit.
- [x] Reject unsupported manifest schema versions.
- [x] Add fixtures for valid, missing, malformed and hash-mismatched manifests.
- [x] Emit structured snapshot validation progress and specific failure information for tests and future UI consumers.

**Long-term test:** `npm run assets:verify` and runtime-manifest fixture tests run for every asset pipeline change.

## [ ] Step 07: Add bundled preset decks and strict deck parsing

**Commit:** `feat: add validated mvp preset decks`

**Working software after commit:** the headless harness validates the one bundled preset matchup against the active catalog without starting the engine.

- [x] Select the final player deck and an opponent deck containing only simple, straightforward cards with no combo line required.
- [x] Store the single preset matchup as versioned project data, not component constants or a user-facing deck picker.
- [x] Keep production deck lists unordered; store programmed test order and starting hands only in integration fixtures.
- [x] Implement strict `.ydk` parsing for Main, Extra and Side sections.
- [x] Reject malformed lines, invalid IDs and unsupported Side Deck content.
- [x] Validate every card code against the active catalog.
- [ ] Validate MVP constraints such as deck size and supported mechanics.
- [x] Derive the unique active-duel card-code set.
- [x] Add parser tests for comments, line endings, invalid values and duplicate entries.
- [ ] Add a locked fixture containing the exact MVP deck lists and expected counts.

**Manual validation:** corrupt one deck ID and confirm duel start is disabled with the exact missing code.

## [ ] Step 08: Build the active-duel dependency resolver

**Commit:** `feat: resolve active duel data and scripts`

**Working software after commit:** loading the bundled preset matchup resolves all required card records, text, global scripts and card scripts into Worker-owned memory and reports dependency counts.

- [x] Load only catalog shards needed by the active card-code set.
- [x] Load localized text shards for the same cards.
- [x] Load `constant.lua`, `utility.lua` and all required global/procedure scripts.
- [x] Load the active decks' `c<ID>.lua` scripts.
- [ ] Resolve aliases and script dependencies required by the selected cards.
- [x] Store normalized card data in a synchronous `Map<CardCode, OcgCardData>`.
- [x] Store scripts in a synchronous `Map<string, string>`.
- [x] Fail before duel creation if required data, text or script is missing.
- [ ] Emit loading progress by artifact group.
- [ ] Add dependency-resolver tests with complete and intentionally incomplete fixtures.

**Long-term test:** every preset deck update runs dependency resolution without creating a duel.

## [ ] Step 09: Wrap the core callbacks and duel-handle lifetime

**Commit:** `feat: manage ocgcore duel sessions`

**Working software after commit:** the Worker can create and immediately destroy a duel using real synchronous card and script callbacks without leaking handles.

- [x] Implement synchronous `cardReader` using only the in-memory card map.
- [x] Implement synchronous `scriptReader` using only the in-memory script map.
- [x] Convert missing callback inputs into captured fatal diagnostics.
- [x] Add a `DuelSession` owner around the raw duel handle.
- [x] Make `dispose` idempotent.
- [x] Ensure initialization failure also destroys a partially created duel.
- [x] Reject a second `startDuel` while a live session exists.
- [x] Add handle-lifecycle tests with create/destroy counters.
- [x] Add a repeated create/dispose integration test.

**Manual validation:** start and dispose 100 empty sessions in a development diagnostic and confirm active handle count returns to zero.

## [ ] Step 10: Start randomized production and programmed test duels headlessly

**Commit:** `feat: run headless duel loop`

**Working software after commit:** the Worker creates the preset duel, shuffles and draws normally in production mode, accepts exact test-only orders and starting hands in programmed mode, starts processing and stops cleanly at the first unimplemented interactive message.

- [x] Generate and record a fresh non-zero production seed for every new duel.
- [x] Let `ocgcore` shuffle both production Main Decks and draw normal randomized starting hands.
- [x] Expose deterministic seed, deck-order and starting-hand injection only through a test/diagnostic adapter that cannot be selected by normal application commands.
- [x] Add cards to the correct player, location, sequence and position.
- [x] Apply starting LP, draw count and Master Rule configuration.
- [x] Start the duel only after all synchronous callback inputs are available.
- [x] Implement the `duelProcess` loop and message-buffer reads.
- [ ] Capture process statuses and raw message bytes in development traces.
- [ ] Detect `MSG_WIN`, engine error, process timeout and unsupported message.
- [x] Add a maximum process-iteration guard against runaway execution.
- [ ] Emit a structured failure instead of hanging on the first unsupported prompt.
- [x] Add an integration test asserting the first programmed message sequence.
- [x] Add a production-mode test proving repeated unseeded starts do not always produce the same deck order or starting hand.

**Long-term test:** a recorded test seed, explicit deck order and snapshot must preserve the expected trace prefix, while normal production starts remain randomized.

## [ ] Step 11: Parse non-interactive core events

**Commit:** `feat: parse core duel events`

**Working software after commit:** the headless trace shows typed draw, move, summon, phase, LP, chain and finish events until an interactive prompt is reached.

- [x] Inventory non-interactive message constants from the pinned core.
- [ ] Implement a bounded binary reader with offset and length errors.
- [x] Parse draw, shuffle, move, position and set events.
- [ ] Parse summon, special summon, flip summon and negation events.
- [ ] Parse phase, turn, attack, battle and damage/recovery events.
- [ ] Parse chain creation, solving and completion events.
- [ ] Parse hints, card hints and system-string references.
- [x] Parse `MSG_WIN` into a domain `DuelResult`.
- [ ] Preserve unknown message type and bytes in a diagnostic error.
- [ ] Add one binary fixture per parsed message shape.

**Long-term test:** malformed and truncated fixtures must fail deterministically without reading outside their buffers.

## [ ] Step 12: Project authoritative public duel state

**Commit:** `feat: project public duel state`

**Working software after commit:** the programmed integration harness asserts live LP, turn, phase and zone state from immutable Worker snapshots while the headless duel progresses.

- [x] Implement a Worker-side `DuelStateProjector`.
- [x] Project player identities, LP, turn player and current phase.
- [x] Project Main Deck and Extra Deck counts.
- [x] Project human hand identities and opponent hand count only.
- [x] Project monster, spell/trap, field, GY and banished zones.
- [x] Project card position, controller, owner and public/hidden state.
- [ ] Project overlay materials and active chain summary where available.
- [ ] Reconcile ambiguous event state through core field/location queries.
- [x] Assert that a physical card instance cannot occupy two zones.
- [x] Strip private opponent fields before posting snapshots.
- [x] Add recorded event-to-state fixture tests.
- [x] Add explicit hidden-information regression tests.

**Manual validation:** inspect Worker messages and confirm opponent hand identities are absent, not merely hidden by CSS.

## [ ] Step 13: Implement idle and battle command prompts

**Commit:** `feat: support idle and battle commands`

**Working software after commit:** the programmed scenario driver can select legal Main Phase and Battle Phase commands and return encoded responses to the core.

- [x] Parse idle-command options into stable domain choices.
- [x] Parse battle-command options into stable domain choices.
- [x] Represent summon, set, activate, change position, attack, phase and cancel choices.
- [x] Generate opaque prompt and choice IDs.
- [x] Keep raw response indexes in a Worker-private lookup.
- [x] Encode the selected command through the pinned adapter.
- [x] Reject stale, duplicate and unknown choice IDs.
- [ ] Add binary prompt fixtures and response-byte assertions.
- [x] Add a test proving a response cannot answer a later prompt.

**Long-term test:** all command response encodings remain pinned to fixtures when the core dependency changes.

## [ ] Step 14: Implement yes/no, effect, option and chain prompts

**Commit:** `feat: support decision and chain prompts`

**Working software after commit:** the programmed scenario driver handles effect confirmation, options and chain decisions and can continue past the preset decks' first interaction.

- [x] Parse generic yes/no prompts.
- [ ] Parse effect yes/no prompts with card and effect context.
- [ ] Parse option selection using localized card/system strings.
- [x] Parse chain selection including pass/cancel rules.
- [x] Preserve mandatory versus optional semantics.
- [x] Encode each response family inside the Worker.
- [x] Add labels suitable for human UI without exposing protocol indexes.
- [ ] Add fixture tests for zero, one and multiple chain candidates.
- [ ] Add fixture tests for missing string fallback diagnostics.

**Long-term test:** every prompt fixture includes both parsed domain output and encoded response assertions.

## [ ] Step 15: Implement card, tribute and sum selection prompts

**Commit:** `feat: support card selection prompts`

**Working software after commit:** the programmed scenario driver supports single and multi-card selection required by the programmed action matrix.

- [x] Parse card selection with minimum, maximum and cancelability.
- [x] Parse unselect-card toggles.
- [x] Parse tribute selection and contribution values.
- [x] Parse sum selection and required arithmetic constraints.
- [ ] Represent selectable cards using stable public card-instance IDs.
- [x] Validate minimum, maximum and sum constraints before encoding.
- [x] Prevent selection of stale or non-candidate card instances.
- [x] Encode ordered and unordered selections as required by each message.
- [ ] Add boundary fixtures for minimum, maximum, cancellation and impossible sum.
- [ ] Add property-style tests for valid sum combinations if the algorithm is non-trivial.

**Long-term test:** each reported selection bug becomes a minimal fixture before its fix.

## [ ] Step 16: Implement place, position, sort, counter and announcement prompts

**Commit:** `feat: complete core prompt families`

**Working software after commit:** the programmed scenario driver can represent and answer every interactive prompt family in the pinned compatibility inventory.

- [x] Parse place and disabled-field selection.
- [x] Parse battle-position selection.
- [x] Parse card and chain sorting.
- [x] Parse counter allocation.
- [x] Parse number announcement.
- [x] Parse attribute and race announcement.
- [x] Parse card-name announcement without adding a user-facing deck editor.
- [x] Parse rock-paper-scissors messages; no separate turn-choice message is exported by the pinned adapter.
- [x] Classify any additional pinned-core prompt family.
- [x] Encode every response family and exercise it against real WASM; permanent low-level byte fixtures remain broader protocol debt.
- [ ] Document internal or non-presentational messages that require no UI.
- [ ] Fail with a downloadable compatibility trace for an unknown prompt.

**Long-term test:** a generated compatibility matrix fails CI when a pinned message constant has no parser classification.

## [x] Step 17: Make the complete programmed headless suite green

**Commit:** `test: complete programmed preset duel action coverage`

**Working software after commit:** automated headless integration scenarios load the real vendored WASM, verified assets and the two preset decks; inject exact test-only deck orders and starting hands; follow persisted choices; collectively exercise every supported game-action family; and reach their expected core `MSG_WIN` or explicit surrender result.

- [x] Complete every programmed game defined in Step 01 without fallback human auto-selection.
- [x] Cover every row in the action matrix, splitting coverage across six deterministic games where necessary.
- [x] Record each human prompt and semantic selection, let the real adapter encode it, and pin the resulting ordered core trace.
- [x] Persist each expected result, winner, finish reason and trace digest fixture.
- [x] Run each programmed scenario twice and compare ordered traces.
- [x] Assert no engine diagnostic reports a missing card, script, string or image-manifest dependency.
- [x] Assert all created duel handles are destroyed.
- [x] Bound core/opponent processing and report transcript index plus pending prompt on drift or exhaustion.
- [x] Run against the same checked-in vendored WASM and verified snapshot/preset paths intended for production packaging.
- [x] Fail if any supported summon, set, activation, chain, selection, position, battle, damage, movement, phase or lifecycle action lacks integration coverage.

**Release significance:** this is the mandatory proof that the complete engine integration works without UI assistance. Svelte, Phaser, visual card rendering and browser duel controls remain forbidden until this step is green.

## [ ] Step 18: Add the basic opponent policy

**Commit:** `feat: add basic mvp opponent`

**Working software after commit:** the human side remains controlled by the programmed driver while the opponent performs legal straightforward actions with shallow fixed priorities and no combo planning.

- [x] Define a pure `OpponentPolicy` interface over typed prompts and visible state.
- [x] Restrict the bundled opponent deck to simple monsters and straightforward spell/trap effects that the policy can use locally.
- [x] Advance phases when no obvious basic action remains.
- [x] Prefer a legal normal summon, then a legal set or simple activation.
- [x] Attack with available monsters using a simple strongest-attacker/legal-target rule.
- [ ] Answer mandatory prompts legally and decline optional chains the basic policy does not understand.
- [x] Avoid search trees, combo sequencing, future-turn planning, hidden-information inference and deck-generic strategy.
- [x] Return a machine-readable reason such as `summon_first_legal`, `set_first_legal`, `attack_strongest` or `advance_phase`.
- [ ] Prevent access to human hidden information.
- [ ] Add one unit fixture per basic priority and real-WASM integration coverage for complete opponent turns.

**Long-term test:** policy tests prove every returned choice is legal; strategic strength is explicitly not an MVP acceptance criterion.

## Mandatory visual-implementation gate

Before Step 19, all of the following must be true:

- [x] Every Step 01 programmed integration scenario reaches its expected result with real vendored WASM and verified preset assets; test-only startup scripts invoke rare compatibility prompts inside the real core.
- [x] The supported game-action coverage matrix has no uncovered row.
- [x] Both preset decks and all test-only starting-hand/deck-order fixtures pass dependency validation.
- [x] Production-mode tests prove core-generated shuffles produce varied starting hands rather than fixed integration fixtures.
- [x] The basic opponent completes legal turns with its simple bundled deck.
- [ ] `npm run check:headless` passes from a clean checkout without network engine resolution. It is green in the current working tree; a clean-checkout/CI run remains pending.

If any item is red, continue headless engine, protocol, fixture or opponent work. Do not install or implement Svelte, Phaser, visual duel controls, card rendering or browser duel flows.

## [ ] Step 19: Add the browser shell, Worker client and duel store

**Commit:** `feat: add browser duel application shell`

**Working software after commit:** after the mandatory headless gate is green, a minimal Svelte application connects to the real Worker and displays textual state, prompt, event log and result without Phaser.

- [ ] Install Svelte, Vite and `@sveltejs/vite-plugin-svelte` only now.
- [ ] Add `index.html`, Vite configuration, `src/main.ts` and a minimal semantic `App.svelte`.
- [ ] Add a typed main-thread `DuelWorkerClient` with send, event subscription and disposal.
- [ ] Give every Worker instance a session identifier and ignore disposed/previous-session events.
- [ ] Convert Worker errors and message errors into typed `DuelError` events.
- [ ] Add a main-thread store that owns the latest immutable Worker snapshot.
- [ ] Track initialization, loading, active, awaiting-input, completed and failed states.
- [ ] Keep only one current prompt and clear it when a new session starts.
- [ ] Add a bounded presentation-event log.
- [ ] Expose command methods for start, respond, surrender, restart and dispose.
- [ ] Add a future presentation bridge interface while keeping the Worker client out of Phaser modules.
- [ ] Add Worker-client and store tests using ordered fake events.
- [ ] Configure Vite to package the vendored WASM and verified runtime assets without copying from `node_modules`.
- [ ] Verify a production build initializes the same vendored engine used by the headless suite.

**Long-term test:** out-of-order and previous-session events cannot mutate the current session store, and browser packaging cannot resolve a different engine copy.

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
- [x] Emit winner, loser and finish reason from core messages.
- [x] Add completed, surrendered, unsupported and engine-error result variants.
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
- [x] Record preset duel ID and the generated production seed, or the explicit programmed-test/replay seed.
- [ ] Record ordered process statuses and parsed message types.
- [ ] Record projected events and both players' responses.
- [x] Record opponent decision reasons.
- [ ] Record the last successful message and pending prompt on failure.
- [ ] Exclude hidden card identities not needed for an authorized local debug trace, or clearly mark debug traces as sensitive.
- [x] Bound in-memory trace size.
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

## [ ] Step 27: Add randomized robustness and end-condition coverage

**Commit:** `test: cover randomized mvp duels and end conditions`

**Working software after commit:** the programmed scenarios remain exact and reproducible, while additional production-mode runs prove randomized shuffles and starting hands do not break legal progression or lifecycle handling.

- [ ] Retain programmed scenarios where the human wins and where the opponent wins.
- [ ] Add LP-zero, surrender and reachable deck-out coverage.
- [ ] Run a bounded matrix of recorded random production seeds and preserve any failing seed as a regression fixture.
- [ ] Assert production starts do not reuse programmed deck order or starting-hand overrides.
- [ ] Assert no human prompt is silently auto-selected.
- [ ] Assert every opponent mandatory prompt receives a legal basic-policy response.
- [ ] Assert each run ends or reaches a supported human prompt within bounded turn and process counts.
- [ ] Store programmed response transcripts as reviewable fixtures rather than opaque snapshots.

**Long-term test:** any deck-list change must intentionally update programmed fixtures and rerun the randomized seed matrix.

## [ ] Step 28: Add protocol compatibility and asset-integrity CI gates

**Commit:** `ci: enforce protocol and asset compatibility`

**Working software after commit:** CI rejects partial upstream updates, unclassified protocol messages and broken catalog/script/image coverage.

- [ ] Generate the pinned core message and response inventory.
- [ ] Compare the inventory with parser/encoder classifications.
- [ ] Run all binary protocol fixtures.
- [ ] Run catalog, text and image one-to-one coverage checks.
- [ ] Run script index and required-global checks.
- [ ] Run active-deck dependency resolution.
- [ ] Run the complete programmed real-Worker action suite and randomized production-seed matrix.
- [ ] Run the production Chromium smoke test.
- [ ] Upload failure diagnostics and traces as CI artifacts.
- [ ] Block snapshot publication unless all compatibility gates pass.

**Long-term test:** upstream synchronization occurs on a separate branch and never mutates the live release snapshot directly.

## [ ] Step 29: Verify production browser behavior

**Commit:** `test: verify production browser duel flow`

**Working software after commit:** the production static bundle initializes, shuffles and draws randomized starting hands, renders cards, accepts human actions and completes normal preset-deck duels in supported desktop browsers.

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
- [ ] Run the complete programmed Worker integration suite and randomized production-mode tests.
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
- [x] State projection preserves zone and hidden-information invariants.
- [ ] Basic opponent policy returns legal choices and simple decision reasons without strategic planning.
- [ ] Deck and asset dependency resolvers are deterministic.

### Worker integration tests

- [ ] Real WASM initializes inside a Worker.
- [x] Real pinned assets satisfy synchronous callbacks.
- [x] Programmed seeds, deck orders, starting hands and responses reproduce exact traces.
- [x] The programmed scenario set covers every supported game-action family and reaches expected `MSG_WIN`/surrender results.
- [x] Production-mode runs shuffle decks and starting hands without exposing test-only overrides.
- [x] Completion, surrender, failure, disposal and replacement release session resources exactly once.

### Browser tests

- [ ] Production bundle loads from static assets.
- [ ] Worker, WASM and snapshot URLs resolve.
- [ ] Human prompt controls send exactly one response.
- [ ] Face-up images and hidden card backs render correctly.
- [ ] Result, restart and diagnostic download work.

### Asset and compatibility tests

- [ ] Vendored `ocgcore-wasm@0.1.2` contains exactly the reviewed files and hashes, with no `node_modules` fallback.
- [x] Manifest hashes and byte lengths match generated files.
- [x] Catalog, text and image records have exact ID coverage.
- [x] Every indexed script exists and has a unique code.
- [x] Required global scripts exist.
- [x] Every pinned protocol constant is classified.
- [ ] Upstream updates pass full compatibility tests before activation.

## Regression rule

- [ ] Reproduce every bug with the smallest failing fixture or deterministic duel transcript.
- [ ] Commit the failing test before or with the fix.
- [ ] Keep fixtures human-readable and tied to the pinned core revision.
- [ ] Never update a trace snapshot only to make CI green without explaining the protocol or behavior change.

## Dependency-update rule

- [ ] Update the vendored engine/core, BabelCDB, CardScripts, strings and image metadata on an isolated branch.
- [ ] Never update `ocgcore-wasm` through a normal package install; replace the reviewed vendor directory, provenance and hashes explicitly.
- [ ] Generate a new immutable snapshot ID.
- [ ] Run protocol inventory comparison.
- [ ] Run all unit tests, programmed action-coverage scenarios and randomized production-mode tests.
- [ ] Run production browser tests.
- [ ] Review changed traces and counts.
- [ ] Activate the snapshot only after all checks pass.
- [ ] Retain the previous known-good snapshot for rollback.

# 10. Recommended implementation checkpoints

- [ ] **Checkpoint A, after Step 05:** real WASM loads in a Worker.
- [x] **Checkpoint B, after Step 10:** randomized production and programmed test duels start and emit parsed core messages.
- [x] **Checkpoint C, after Step 17:** every programmed headless scenario reaches its expected result and every supported game-action row is covered. This unlocks visual implementation after the pending clean-checkout gate is accepted.
- [ ] **Checkpoint D, after Step 20:** a human can duel without raw debug controls.
- [ ] **Checkpoint E, after Step 24:** the complete visible duel lifecycle works.
- [ ] **Checkpoint F, after Step 29:** the production bundle passes browser verification.
- [ ] **Checkpoint G, after Step 30:** the MVP release artifact is reproducible and documented.

Do not begin story, deck-editor or progression implementation before Checkpoint G is accepted.
