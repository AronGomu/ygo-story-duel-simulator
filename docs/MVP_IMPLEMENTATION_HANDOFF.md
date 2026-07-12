# MVP implementation handoff

> Date: 2026-07-13  
> Status: headless Checkpoint B implemented; mandatory visual gate **not** green  
> Canonical plan: [`MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](MVP_TECHNICAL_IMPLEMENTATION_PLAN.md)

## 1. Start here

Continue from the current uncommitted working tree. Do not install Svelte, Phaser, Vite, Playwright, or `idb` yet. The canonical plan forbids visual implementation until every Step 17 programmed real-WASM scenario reaches its expected result and the full supported action/prompt matrix is genuinely covered.

Run this first:

```bash
npm run check:headless
```

Last result: **passed** on 2026-07-13.

- 20 legacy asset-pipeline tests passed.
- 35 Vitest unit tests passed.
- 8 real/integration tests passed.
- Formatting, ESLint, and TypeScript passed.
- Vendored engine verification passed (21 manifested payload files).
- Asset verification passed (14,794 cards/texts/images, 13,399 official scripts, 125 prerelease scripts, 25 globals).
- Atomic runtime snapshot verification passed.
- Current snapshot ID: `194ff636420904ae40d12b648ba358d097d44964b4800751679ee541c5f3356e`.

No commits or pushes were made.

## 2. What was implemented

### Quality harness

- Added Vitest, coverage support, ESLint, Prettier, and focused headless scripts in `package.json`.
- Added `eslint.config.js`, `vitest.config.ts`, and `.prettierignore`.
- Preserved the original Node test suite as `test:legacy`.
- Added `test:unit`, `test:integration`, `vendor:verify`, `snapshot:generate`, `snapshot:verify`, and `check:headless`.
- No CI workflow has been added yet.

### Typed contracts

Implemented clone-safe Worker/domain contracts under `src/duel/contracts/`:

- branded duel, prompt, choice, card, instance, and snapshot IDs;
- `DuelCommand` and `DuelWorkerEvent` unions;
- `PlayerPrompt`, `PublicDuelState`, presentation events, results, and structured errors;
- structured-clone validation and `assertNever`.

`respond` currently carries `choiceIds: ChoiceId[]`, rather than the canonical plan's singular `choiceId`, because multi-card, ordering, place, sum, race, attribute, and counter prompts require multiple domain selections.

### Preset decks and programmed specification

- Added versioned YDK presets:
  - `src/duel/presets/decks/player.ydk`
  - `src/duel/presets/decks/opponent.ydk`
- Added strict parsing, size/Side Deck/catalog validation, and unique active-code derivation.
- Added an action/prompt matrix and scenario specifications under `tests/fixtures/`.

The two decks both contain 40 cards. The human deck includes simple classic spells/traps to make future action-family scenarios possible; the opponent deck stays straightforward.

### Vendored engine

Vendored `ocgcore-wasm@0.1.2` under `vendor/ocgcore-wasm/0.1.2/` with:

- exact npm URL and SHA-512 integrity;
- upstream package revision `9f36452f2a2464f057f7fd6e2273aa5ab589401e`;
- embedded Project Ignis core revision `8e5f4e4f0ab6b8ca750e8e1c91c1a58f407e3272`;
- exposed core version `11.0`;
- MIT license copied from the exact upstream package revision because the npm tarball omitted it;
- full SHA-256/byte manifest and a verifier;
- no local patches;
- only synchronous files under `lib/` (the package's distributed `dist/` remains intact).

Key files:

- `vendor/ocgcore-wasm/0.1.2/VENDORING.md`
- `vendor/ocgcore-wasm/0.1.2/vendor-manifest.json`
- `scripts/verify-vendor.ts`

### Atomic runtime snapshot

Implemented runtime manifest schema/build/verification:

- `src/worker/assets/runtime-manifest.ts`
- `src/worker/assets/runtime-snapshot-node.ts`
- `scripts/generate-runtime-snapshot.ts`
- `scripts/verify-runtime-snapshot.ts`

The snapshot ID is derived from the exact asset-manifest and vendor-manifest digests. Verification checks every asset's declared byte length and SHA-256 and rejects unsafe relative paths.

### Active dependency loading

Implemented active-deck shard resolution in:

- `src/worker/assets/active-duel-dependencies.ts` (browser-safe contracts/helpers)
- `src/worker/assets/active-duel-dependencies-node.ts` (Node filesystem loader)

It loads only needed card/text/image/script shards, follows card aliases, loads all indexed global scripts, converts race flags to `bigint`, and fails with exact missing codes/names.

### Core adapter and session

Implemented:

- `src/worker/engine/OcgCoreAdapter.ts`
- `src/worker/engine/load-vendored-core-node.ts`
- `src/worker/engine/DuelSession.ts`
- `src/worker/engine/duel-seed.ts`
- `src/worker/engine/engine-constants.ts`

Current behavior:

- real local synchronous WASM initializes and reports core `11.0`;
- production seeds are fresh/non-zero;
- programmed mode accepts fixed seed/deck order and enables pseudo-shuffle internally;
- public production commands cannot select deterministic mode;
- required globals are loaded before card scripts;
- card/script callbacks read preloaded maps only;
- one handle is owned per `DuelSession`;
- partial creation failure destroys the handle;
- `dispose()` is idempotent;
- processing has an iteration guard and stops at waiting/end boundaries.

### Protocol, projection, diagnostics, and opponent

Implemented:

- `src/worker/protocol/PromptRegistry.ts`
- `src/worker/protocol/message-classification.ts`
- `src/worker/projection/DuelStateProjector.ts`
- `src/worker/diagnostics/duel-trace.ts`
- `src/worker/opponent/OpponentPolicy.ts`
- `src/worker/HeadlessDuelController.ts`

Highlights:

- all prompt families exported by the pinned adapter have a domain mapping/response path;
- raw response indexes are retained in Worker-private closures;
- stale, duplicate, unknown, count-invalid, and sum-invalid selections are rejected;
- the pinned message enum is classified and compared against the actual vendored enum;
- human hand identities are projected; opponent hidden hand identities are absent from serialized snapshots;
- a simple deterministic policy summons, activates/sets, attacks, advances phases, passes optional chains, and answers mandatory prompts;
- bounded traces record process statuses, message types, prompts, opaque choices, opponent reasons, results, and stringified seeds.

### Worker runtime shell

Implemented:

- `src/worker/DuelWorkerRuntime.ts`
- `src/worker/duel.worker.ts`
- `src/worker/create-node-runtime.ts`

The runtime accepts typed commands and emits loading/ready/state/event/prompt/result/error events. The Node bootstrap initializes the real engine, runtime manifest, preset, and active dependencies. `duel.worker.ts` currently exports an attachment function; it is not yet bootstrapped as a production browser Worker.

### Real integration proof

`tests/integration/programmed-duel.test.ts` runs the same fixed real-WASM duel twice. A deterministic domain policy drives both sides. Both runs reach:

```json
{ "type": "completed", "winner": 1, "loser": 0, "reason": 1 }
```

The complete ordered trace digest is identical across both runs. The test observes draw, turn/phase, idle/place/chain/battle prompts, move, summon, attack, damage, and `MSG_WIN`.

## 3. Honest plan status

Do **not** mark the following canonical steps complete yet.

| Plan range | Status | Notes |
|---|---|---|
| Step 01 | Partial | Matrix/specification exists, but scenarios are not complete exact response transcripts and do not genuinely cover every row. |
| Step 02 | Mostly complete | Local headless command is green; CI configuration is missing. |
| Step 03 | Mostly complete | Typed clone-safe contracts exist; add broader real-event cloning tests and reconcile plural response IDs in docs. |
| Step 04 | Complete locally | Vendor/provenance/hash verification is implemented. |
| Step 05 | Mostly complete | Real WASM loads; tests call the runtime directly rather than a real OS/browser Worker thread. |
| Step 06 | Partial | Runtime manifest/verifier exists; production browser packaging/immutable publication is not implemented. |
| Step 07 | Mostly complete | Deck parser/presets/catalog checks exist; unsupported-mechanic/format validation is basic. |
| Step 08 | Partial | Active aliases/scripts/globals/text/images load; transitive script dependency analysis is not implemented. |
| Step 09 | Partial | Creation/disposal works, but normal core completion does not yet auto-dispose the handle. |
| Step 10 | Mostly complete | Production/programmed starts and process loop work; production randomness is asserted by seed, not repeated hand/order observations. |
| Steps 11-12 | Partial | The vendored adapter parses messages and projection handles primary state/events; full reconciliation/query coverage is absent. |
| Steps 13-16 | Partial | Prompt/response mappings exist, but permanent binary fixtures for every shape are absent. |
| Step 17 | **Not complete** | Only a core gameplay subset is proven by real WASM. The exhaustive action/prompt matrix is not green. |
| Step 18 | Partial | Basic policy completes real turns/duels; one fixture per priority/mandatory family is not complete. |
| Steps 19-30 | Not started | Correctly blocked by the mandatory visual gate. |

## 4. Critical issues to fix next

### A. Handle cleanup on normal completion

`HeadlessDuelController` returns a result but does not immediately dispose its `DuelSession`. Tests clean up in `finally`, but production must destroy the core handle after `MSG_WIN`, engine failure, timeout, and unsupported behavior.

Relevant files:

- `src/worker/HeadlessDuelController.ts`
- `src/worker/DuelWorkerRuntime.ts`
- `src/worker/engine/DuelSession.ts`

Add create/destroy counters in a fake adapter and a real repeated-completion/restart test.

### B. Worker command serialization/races

`attachDuelWorker()` starts each async `runtime.handle()` independently. Rapid `initialize`, `startDuel`, `respond`, and `dispose` messages can overlap. `DuelWorkerRuntime` also has no internal command queue or initialization promise.

Relevant files:

- `src/worker/duel.worker.ts`
- `src/worker/DuelWorkerRuntime.ts`

Serialize commands, make initialization single-flight, and ensure disposal invalidates late completions/events.

### C. The action matrix currently overstates coverage

`tests/fixtures/action-coverage.ts` maps every family to a scenario, but the real integration suite only proves a subset. `tests/fixtures/programmed-scenarios.ts` is a specification and is not currently executed by the full-duel test. `tests/integration/programmed-duel.test.ts` uses the deterministic basic policy rather than exact persisted human transcripts.

This is the main blocker. Replace the mapping-only assertion with evidence collected from executed real-WASM scenarios. Missing rows must fail CI.

Recommended shape:

1. Persist every human domain response as opaque prompt/choice IDs or stable domain fingerprints (never raw engine indexes).
2. Replay without fallback auto-selection.
3. Record observed message/prompt/action families from the actual trace.
4. Compare observed families to the canonical matrix.
5. Split across multiple games using the same two preset decks.
6. Run every scenario twice and compare trace/result digests.

### D. Unknown raw-message evidence is unavailable

The distributed `ocgcore-wasm` high-level adapter parses messages internally and logs/skips an unknown shape. Current code cannot retain unknown raw bytes as required by the architecture.

Options to investigate:

- wrap the lower-level synchronous Emscripten module and own bounded parsing;
- make a clearly documented local adapter patch with provenance/hash updates;
- verify whether a supported package API can expose raw message bytes.

Do not silently accept the current behavior as Step 11/16 complete.

### E. Runtime initialization does not verify every file

`createNodeDuelWorkerRuntime()` builds the runtime manifest but does not call `verifyRuntimeSnapshotFiles()` before reporting ready. `npm run snapshot:verify` does full verification separately, while runtime dependency loading only touches active shards.

Decide whether initialization must verify all files each time or consume a previously verified immutable activation marker. Keep the architecture's atomic-activation guarantee explicit.

### F. Projection is intentionally incomplete

`DuelStateProjector` is event-driven and does not yet reconcile via core field/location queries. Overlay materials, rich chain details, ownership after unusual control/move flows, field/pendulum separation, and some shuffle/swap/reload messages are incomplete. Card-instance IDs are best-effort rather than proven stable across every message family.

Add permanent fixtures before expanding. Keep opponent hidden identities absent, not merely hidden in UI.

### G. Production randomness proof is incomplete

Current tests prove fresh non-zero production seeds but do not run repeated production starts and assert differing deck order/starting hands. Add this before claiming Step 10 or the visual gate.

### H. Surrender is local

`HeadlessDuelController.surrender()` emits a structured local result and disposes the session. It does not currently drive a core surrender path because the vendored high-level API exposes no obvious surrender method. Reconcile this with the canonical requirement and document the chosen core-compatible behavior.

## 5. Additional cleanup/debt

- `src/worker/protocol/PromptRegistry.ts` and `src/worker/projection/DuelStateProjector.ts` are large; split by prompt/event family only after behavior is pinned by fixtures.
- Add binary/domain fixtures for every prompt and response family, not only idle/card examples.
- Add tests for counter allocation limits, place-mask perspectives, card announcement opcode filtering, selection cancellation, impossible sums, sorting, races/attributes, and RPS.
- Add all required trace metadata: application/build/browser versions, all upstream revisions, last successful message, pending prompt, truncation status, sensitivity/redaction marker, and downloadable schema support.
- Add CI after the headless suite is truthful.
- Review whether the human preset's duplicate limited/forbidden classic cards are acceptable for this offline preset or whether banlist validation belongs in MVP constraints.
- The future browser bundle must avoid Node-only modules (`*-node.ts`, `create-node-runtime.ts`) and must ensure Vite does not package the unused JSPI engine chunks.

## 6. Review status

The production workflow attempted code, contracts, concurrency, observability, data-integrity, security, performance, and bundle reviews. Reviewer subagents were unavailable or returned no report. Therefore no independent gated review has been completed.

Before declaring the headless gate production-ready:

- run an independent code review;
- run contract/concurrency/observability/data-integrity/security/dependency reviews;
- run duplication/simplification after tests pin current behavior;
- fix or explicitly record every finding.

No UI/a11y/loading-state review applies yet because visual implementation has not started.

## 7. Working-tree caveats

Initial repository status already contained untracked `.pi/`. It is project tooling, not MVP source. Do not accidentally include it in implementation commits.

A broad Prettier invocation briefly touched untracked `.pi/` files before formatting was narrowed. The tracked pre-existing source/docs were restored. Because `.pi/` has no Git baseline, verify/restore it from its original skill source before committing project tooling if that directory matters.

`.agentsystem/ship-run.md` is a scratch workflow record, not application source.

Expected implementation changes are:

- tracked: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`;
- new config/scripts: `.prettierignore`, `eslint.config.js`, `vitest.config.ts`, runtime/vendor scripts;
- new source: `src/duel/**`, `src/worker/**`;
- new tests: `tests/fixtures/**`, `tests/unit/**`, `tests/integration/**`;
- new vendor payload: `vendor/ocgcore-wasm/0.1.2/**`.

## 8. Recommended next sequence

1. Run `npm run check:headless` and inspect `git status`.
2. Fix normal-completion/error handle disposal and add leak tests.
3. Serialize Worker commands and add race/disposal tests.
4. Make runtime snapshot activation/verification explicit at initialization.
5. Turn the scenario specification into exact no-fallback real-WASM transcripts.
6. Replace mapping-only action coverage with observed real-WASM evidence.
7. Complete prompt/event/projection fixtures until every matrix row is genuinely green.
8. Run the independent gated reviews and simplify large modules.
9. Re-run `npm run check:headless` from a clean asset snapshot.
10. Only when the canonical mandatory visual gate is fully green, begin Step 19 and install Svelte/Vite.

## 9. Useful commands

```bash
# Full current headless gate
npm run check:headless

# Focused checks
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run vendor:verify
npm run assets:verify
npm run snapshot:verify

# Regenerate ignored runtime manifest for inspection
npm run snapshot:generate

# Inspect changes
git status --short
git diff --stat
```
