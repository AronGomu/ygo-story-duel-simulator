# MVP implementation handoff

> Date: 2026-07-13
> Status: **Checkpoints A–G are complete. The private MVP release candidate passed the full local and isolated clean-checkout gates.**
> Canonical plan: [`MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](MVP_TECHNICAL_IMPLEMENTATION_PLAN.md)

## 1. Start here

The browser-duel MVP is complete. Preserve the release constraints below when beginning post-MVP work.

Run after any change:

```bash
npm run format
npm run check
```

Latest local result on 2026-07-13:

- formatting, ESLint and TypeScript/Svelte checks passed;
- 20 legacy asset-pipeline tests, 158 unit tests, 16 real-WASM integration tests and 10 Svelte component tests passed;
- the verified private build passed with 70 active runtime files and snapshot `e0a1fc92e5564e7ab20f79c8b3662294eb38fa15ee72a6f51acfb108886bb5a5`;
- reproducibility verification matched all 109 packaged files;
- all eight Chromium cases and the Firefox/WebKit production startup smokes passed;
- the Firefox IndexedDB close race is fixed and passed both the complete local gate and the isolated gate;
- an isolated copy installed 249 packages with `npm ci --offline`, reported zero vulnerabilities, and passed the same complete gate.

The mandatory pre-visual isolated `npm ci --offline && npm run check:headless` gate was accepted before the browser dependencies were installed. Svelte, Vite, Playwright, Phaser and `idb` are now implemented at their designated checkpoints.

## 2. Current implementation

### Runtime and lifecycle

- `OcgCoreAdapter` loads only the checked-in synchronous `ocgcore-wasm@0.1.2` payload.
- `src/worker/duel.worker-node.ts` derives the trusted project root from its own module URL, creates the real Node runtime inside `node:worker_threads`, and connects it to `attachDuelWorker`; the parent test process never imports the engine.
- Runtime initialization verifies every declared snapshot file's byte length and SHA-256 before loading the engine.
- `DuelSession` owns exactly one native handle and destroys it once after completion, surrender, failure, timeout, unsupported waiting behavior, or disposal.
- Worker commands pass runtime validation and execute in a bounded arrival-order queue.
- Initialization is single-flight and cooperatively abortable; disposal suppresses queued and late work.
- Prompt/choice IDs include runtime and duel namespaces, preventing stale responses from previous Workers or sessions.
- Errors cross boundaries as typed `DuelOperationError`/`DuelError` values.
- Structured `duel.worker.*` diagnostics remain safe even when an injected logger throws; engine diagnostics, parser/encoder context, replay metadata, trace tails, and cleanup failures are retained.
- Reentrant diagnostic disposal invalidates immediately but defers native handle destruction until the active core command unwinds.

### Production shuffling

The embedded core does not automatically shuffle decks at `OCG_StartDuel`. Production sessions therefore load a small application-owned `EVENT_STARTUP` script that calls `Duel.ShuffleDeck(0)` and `Duel.ShuffleDeck(1)`. The real core performs both shuffles with its fresh cryptographic seed and emits two `MSG_SHUFFLE_DECK` messages before opening draws.

`tests/integration/duel-session.test.ts` starts four production sessions and proves:

- fresh non-zero seeds;
- one core shuffle message per player;
- varied opening hands.

Programmed sessions remain deterministic and use pseudo-shuffle plus explicit deck order. Production Worker commands cannot select programmed mode or inject startup scripts.

### Protocol and projection

- Every prompt family exported by the pinned adapter has a typed domain mapping and response path, including exact/at-least sum selection with packed alternative contributions and mandatory-only totals.
- The projector handles primary draw/shuffle/move/set/summon/position/phase/LP/chain/battle/result events.
- Human hand identities are visible; opponent hidden hand identities are absent from serialized state.
- Hidden code-zero deck moves emitted by core sorting no longer create invalid card IDs.
- A terminal result later in a message batch takes precedence over an earlier prompt.

### Browser runtime, presentation and persistence

- The production Svelte app talks only to a dedicated, generation-aware browser Worker; only that Worker imports the integrity-checked synchronous vendored engine.
- The browser package carries the recursively resolved 70-file active dependency closure, active image manifest, WASM, license/provenance files and a private-deployment marker.
- Root and non-root static paths, one-shot Worker responses, bounded watchdog replacement and stale-generation suppression are covered.
- Phaser is lazy, abortable and non-authoritative. Its deterministic field, feedback and image failures fall back to a fully operable semantic Svelte field.
- Verified active images use revisioned Cache Storage, bounded loading and deterministic placeholders. Prompt and field actions wait only until every active image has resolved or received a placeholder.
- IndexedDB v2 stages immutable runtime-plus-image activation IDs, keeps active/previous pointers, migrates v1 data and serializes activation/cleanup across tabs.
- Diagnostics contain bounded lifecycle/message/presentation/prompt/response/result traces plus aggregate image-cache status. Downloads are available only after a session is inactive and are labeled `contains-production-seed`.
- The UI includes keyboard-complete controls, public card inspection, surrender, result, restart, storage recovery, image retry and visual-field retry paths.
- Unapproved artwork can be packaged only with explicit private mode; ordinary production mode is rejected.

## 3. Headless checkpoint evidence

### Checkpoint A: actual Worker isolation

`tests/integration/node-worker-thread.test.ts` launches the production Node Worker entry and proves across real structured-clone IPC that:

- the Worker validates the local snapshot and reports core version `[11, 0]`;
- a production preset duel emits public state and a human prompt;
- surrender emits the typed result;
- graceful disposal closes an active session and exits with code `0`, while cleanup failure exits nonzero;
- a missing runtime snapshot returns a sanitized typed error;
- an unresponsive Worker falls back to bounded forced termination;
- an initialized live Worker can be forcibly terminated and reclaimed.

The alternate missing-snapshot, cleanup-failure, and unresponsive entries exist only under `tests/fixtures/`; the production Worker accepts no project-root, seed, deck-order, startup-script, or programmed-mode override.

### Checkpoint C: programmed duel coverage

Six persisted scenarios run against real vendored WASM, verified assets, and the two 40-card preset decks. Every human response is resolved from a stable semantic fingerprint—never a raw engine index—and no human policy fallback is allowed.

| Scenario                        | Human responses | Expected result                     |
| ------------------------------- | --------------: | ----------------------------------- |
| `battle-and-chain`              |             182 | opponent wins by LP zero            |
| `tribute-special-and-target`    |             110 | human wins by LP zero               |
| `effects-recovery-and-position` |             141 | human wins by LP zero               |
| `real-wasm-prompt-matrix`       |              16 | human wins by core `MSG_WIN`        |
| `shuffle-and-sort-chain`        |               5 | human wins by core `MSG_WIN`        |
| `surrender-at-opening`          |               0 | opponent wins by explicit surrender |

Each scenario:

- is replayed twice;
- must produce the same ordered trace digest both times;
- must consume exactly the persisted response count;
- must report no engine diagnostics;
- must reach the expected result;
- must have disposed its native handle before returning.

`tests/fixtures/action-coverage.ts` contains 24 action rows and 21 prompt rows. Coverage is collected from executed prompts, selections, presentation events, and core message types. `uncoveredProgrammedCoverage()` now returns `[]`, and the unit test fails if any row becomes uncovered.

The rare prompt families are produced by test-only startup scripts in `tests/fixtures/core-scripts/`. These scripts execute inside the real core and exercise its real wire messages and response validation; they are not available through public Worker commands. Ordinary gameplay evidence remains in the three full preset-duel transcripts.

## 4. Vendored adapter corrections

The pinned package contained two integration-blocking adapter defects. Both corrections are recorded in `VENDORING.md`, `vendor-manifest.json`, and updated source maps/hashes:

1. Backported upstream commit `1dabded283959f44a2c34494b5575434911b2c02` so `MSG_SELECT_SUM` reads mandatory/optional groups in core wire order and includes the complete location/position record.
2. Removed an invalid length prefix from `SORT_CARD` responses; the embedded core expects one raw order byte per card.

The WASM binary and package version remain unchanged; the `SELECT_SUM` declaration now reflects the patched location record. `npm run vendor:verify` validates the patched payload.

## 5. Honest plan status

| Plan range  | Status                     | Notes                                                                                                                                                                         |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps 01-18 | Complete for the MVP       | Real Worker/WASM isolation, verified assets, deterministic programmed coverage, production shuffling, projection, typed prompts and the legal basic opponent are all retained. |
| Steps 19-20 | **Complete: Checkpoint D** | The base-safe browser app, Worker client/store, exhaustive controls and keyboard-only duel are green.                                                                          |
| Steps 21-24 | **Complete: Checkpoint E** | Phaser/semantic field parity, verified images/placeholders, bounded presentation and complete surrender/result/restart lifecycle are implemented.                              |
| Steps 25-29 | **Complete: Checkpoint F** | Bounded sensitive diagnostics, atomic persistence/fallback, randomized coverage, compatibility CI and three-engine browser verification are implemented.                       |
| Step 30     | **Complete: Checkpoint G** | Private release safeguards, documentation, reproducibility, CI archival, all browser tests and the isolated `npm ci --offline` release gate are green.                         |

The canonical plan checks off Steps 21–30 and Checkpoints E–G.

## 6. Historical Checkpoint D implementation notes (complete)

This section records the constraints used to accept Checkpoint D. It is retained for audit context, not as the next-session work list. Phaser and persistence were subsequently added in Steps 21–27 without weakening these constraints.

### 6.1 Final gate before installing visual dependencies

1. Preserve the current working tree and exclude `.pi/` and `.agentsystem/`.
2. Reproduce the source plus verified ignored runtime snapshot in a clean checkout or equivalent isolated directory.
3. Run `npm ci` and `npm run check:headless` without network engine resolution.
4. Add the same canonical headless command to CI, or explicitly record acceptance of the equivalent isolated run.
5. Confirm all six programmed transcripts retain their digests and `uncoveredProgrammedCoverage()` remains `[]`.

Do not install Svelte, Vite, Playwright, Phaser, or `idb` until this gate is accepted. After acceptance, install only the dependencies first used by Steps 19–20; Phaser and `idb` remain deferred. Pin the resolved versions in `package-lock.json`:

```bash
npm install svelte
npm install --save-dev vite @sveltejs/vite-plugin-svelte eslint-plugin-svelte prettier-plugin-svelte
# Step 20, only when the Chromium smoke flow is ready:
npm install --save-dev @playwright/test
npx playwright install chromium
```

### 6.2 Step 19: browser shell, Worker client, and duel store

Build the smallest production browser application that runs the existing domain/runtime contract and displays it textually. Do not add the duel field yet.

Expected implementation surfaces:

```text
index.html
vite.config.ts
src/main.ts
src/app/App.svelte
src/app/DuelWorkerClient.ts
src/app/stores/duel-store.ts
src/worker/duel.worker-browser.ts
src/worker/create-browser-runtime.ts
```

Exact filenames may follow the conventions established by the Svelte/Vite setup, but responsibilities must remain separate:

- **Browser Worker entry:** create the browser runtime and compose it with `attachDuelWorker`; never import `create-node-runtime.ts` or any `*-node.ts` module.
- **Browser runtime:** fetch the vendored synchronous WASM and verified runtime snapshot assets before reporting `ready`; synchronous card/script callbacks still read only preloaded memory.
- **Vite packaging:** emit the reviewed WASM and immutable runtime artifacts under URLs that work at both root and non-root base paths; never resolve another engine copy from `node_modules`.
- **Worker client:** own one Worker instance, validate/forward typed commands, subscribe to typed events, convert `error`/`messageerror`/unexpected exit into `DuelError`, and provide bounded graceful-dispose then forced-terminate behavior.
- **Session isolation:** assign a main-thread Worker generation/session token and ignore events from disposed or replaced Workers, even if they arrive late.
- **Duel store:** own the latest immutable snapshot, one current prompt, one result/error, and a bounded presentation-event log. Track `idle`, `initializing`, `loading`, `active`, `awaiting-input`, `completed`, and `failed` states.
- **Textual shell:** show initialization progress, LP, turn, phase, zone/deck/hand summaries, current prompt, event log, typed result, and a readable failure state. Phaser state must not exist yet.

Step 19 tests must prove:

- ordered Worker events produce the expected store state;
- stale and previous-Worker events cannot mutate the current session;
- a new session clears prompt/result/error/transient logs;
- each command is sent at most once;
- Worker `error`, `messageerror`, unexpected exit, graceful timeout, and replacement are bounded and observable;
- production `vite build` packages and initializes the same vendored core/snapshot used by the headless suite.

**Step 19 stop gate:** do not start prompt-control expansion until the production browser build can initialize the real Worker and render textual state plus the first human prompt.

### 6.3 Step 20: accessible controls for every prompt family

Render controls from `PlayerPrompt` domain choices only. The UI sends opaque `promptId` and `choiceIds`; raw core response indexes, message bytes, seeds, deck order, startup scripts, and programmed mode never cross into the component layer.

The control inventory must cover every current prompt family:

- idle and battle commands;
- generic/effect yes-no, option, and chain/pass decisions;
- card, unselect-card, tribute, and exact/at-least sum selection;
- place, disabled-field, and battle-position selection;
- card/chain sorting and counter allocation;
- number, attribute, race, and card-name announcements;
- rock-paper-scissors.

Interaction requirements:

- disable the active controls immediately after one response is sent;
- reject stale prompts and never silently auto-select a human choice;
- show minimum, maximum, sum, mandatory, cancel, and ordering constraints in human-readable form;
- provide card detail/effect-text inspection without exposing hidden opponent identities;
- restore focus predictably when a new prompt arrives;
- support keyboard-only operation with visible focus and semantic labels;
- provide loading, empty, unsupported, recoverable-error, terminal-error, and result states;
- keep the event/chain log readable and bounded;
- display a minimal typed completion result, while the polished lifecycle/result/restart experience remains Step 24.

Step 20 tests must include:

- exhaustive renderer classification so a new `PlayerPrompt` variant fails tests/typechecking until it has a control;
- component tests for each control family and its boundary constraints;
- duplicate-submit, stale-prompt, focus-restoration, keyboard, and hidden-information regressions;
- a Chromium production-build smoke test that initializes the real browser Worker, starts the preset duel, and submits one real human choice exactly once;
- manual completion of one full preset duel using keyboard-only controls.

### 6.4 Checkpoint D acceptance checklist

- [x] The isolated/CI `npm run check:headless` visual gate is accepted.
- [x] `npm run build` succeeds without Node-only modules or a `node_modules` engine copy in the client bundle.
- [x] The production browser bundle resolves Worker, WASM, and snapshot URLs from a non-root base path.
- [x] The real browser Worker reaches `ready`, emits public state, and requests human input.
- [x] The textual Svelte shell renders LP, turn, phase, public zones, current prompt, log, errors, and result.
- [x] Every supported `PlayerPrompt` variant has a typed, accessible control with no raw debug entry.
- [x] One response is sent per prompt; stale/late Worker events and duplicate submissions are ignored.
- [x] Opponent hidden identities remain absent from main-thread messages and UI state.
- [x] Worker failure/disposal is bounded and uncertain cleanup replaces the Worker.
- [x] Unit/component tests, the real-WASM headless suite, production build, and Chromium smoke test pass.
- [x] A full preset duel can be completed with keyboard-only controls.
- [x] Phaser, card-image caching, IndexedDB snapshot activation, and presentation animation remained unimplemented until their later steps.

### 6.5 Explicit non-goals for Checkpoint D

Do not pull later milestones forward:

- no Phaser field, sprites, zone coordinates, or animation (Steps 21 and 23);
- no active-card image preload/cache or `idb` installation (Steps 22 and 26);
- no polished restart/result lifecycle beyond the minimal typed result needed to finish a duel (Step 24);
- no downloadable diagnostic trace UI (Step 25);
- no randomized seed matrix, multi-browser release suite, or release packaging (Steps 27–30).

## 7. Remaining risks and release limits

### Release verification evidence

Firefox exposed an IndexedDB ownership race during the first release gate: a late-open cleanup callback closed a successfully accepted `SnapshotStore` before its first transaction. `src/app/App.svelte` now closes the database only when an open operation was actually abandoned. The complete local and isolated gates subsequently passed all ten browser cases, including Firefox.

### Deliberate MVP limits

- Projection remains event-driven and does not model every obscure overlay, control-swap, reload or pendulum-edge protocol path.
- Surrender is a local authoritative lifecycle result because the pinned high-level adapter exposes no core surrender operation.
- The high-level adapter does not expose raw unknown message bytes. Diagnostics retain bounded parsed message types and public projected-event kinds instead.
- Diagnostics contain the real production seed and must be treated as sensitive.
- Card-image redistribution is not approved. The default release candidate is private-only and must not be published publicly.

## 8. Repository and release caveats

- `.pi/` and `.agentsystem/` are local tooling/scratch content; do not include them in commits or release artifacts.
- Generated runtime/image assets are ignored by Git and must be regenerated or supplied to offline verification.
- Programmed trace digests include each public projected presentation-event kind; no hidden card identity is retained.
- CI archives `dist/` with the exact runtime and vendor manifests as a private release candidate only on a successful main/workflow-dispatch run.
- Public deployment remains prohibited until card-image redistribution is explicitly approved and the manifest/build policy is changed through review.

## 9. Recommended next sequence

1. Treat Checkpoint G as the accepted browser-duel MVP baseline; begin new story/progression work from a separately reviewed plan.
2. Keep the 158-unit/16-integration/10-component suites, programmed trace digests, zero-uncovered action matrix, reproducible package check and ten Playwright cases mandatory.
3. Run `npm run check` before publishing any subsequent change; use an isolated `npm ci --offline && npm run check` gate for release candidates.
4. Regenerate immutable assets and review compatibility diffs rather than editing generated snapshots manually.
5. Keep diagnostics containing production seeds private and keep the application private-only while image redistribution is unapproved.

## 10. Useful commands

```bash
npm run format
npm run check
npm run check:headless
npm run test:component
npm run build
npm run build:reproducible
npm run test:e2e
npx playwright test --project=firefox-smoke
npm ci --offline
```

Verified private release-candidate facts:

- runtime snapshot: `e0a1fc92e5564e7ab20f79c8b3662294eb38fa15ee72a6f51acfb108886bb5a5`;
- active runtime closure: 70 files;
- reproducible static package: 109 files;
- current distribution mode: private-only.
