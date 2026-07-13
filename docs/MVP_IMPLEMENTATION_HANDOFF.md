# MVP implementation handoff

> Date: 2026-07-13
> Status: **Headless Checkpoint C is green locally; visual implementation has not started.**
> Canonical plan: [`MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](MVP_TECHNICAL_IMPLEMENTATION_PLAN.md)

## 1. Start here

Continue from the current uncommitted working tree. Preserve all existing changes. Do not commit, push, or open a PR unless explicitly requested.

Run:

```bash
npm run check:headless
```

Latest local result on 2026-07-13:

- 20 legacy asset-pipeline tests passed;
- 78 Vitest unit tests passed;
- 10 integration tests passed;
- formatting, ESLint, and TypeScript passed;
- vendored engine, asset snapshot, image catalog, and runtime snapshot verification passed;
- current snapshot ID: `e0a1fc92e5564e7ab20f79c8b3662294eb38fa15ee72a6f51acfb108886bb5a5`.

The remaining visual-gate caveat is procedural: this has not yet been repeated from a clean checkout/CI environment. No Svelte, Phaser, Vite, Playwright, or `idb` dependency has been installed.

## 2. Current headless implementation

### Runtime and lifecycle

- `OcgCoreAdapter` loads only the checked-in synchronous `ocgcore-wasm@0.1.2` payload.
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

## 3. Checkpoint C evidence

Six persisted scenarios run against real vendored WASM, verified assets, and the two 40-card preset decks. Every human response is resolved from a stable semantic fingerprint—never a raw engine index—and no human policy fallback is allowed.

| Scenario | Human responses | Expected result |
|---|---:|---|
| `battle-and-chain` | 182 | opponent wins by LP zero |
| `tribute-special-and-target` | 110 | human wins by LP zero |
| `effects-recovery-and-position` | 141 | human wins by LP zero |
| `real-wasm-prompt-matrix` | 16 | human wins by core `MSG_WIN` |
| `shuffle-and-sort-chain` | 5 | human wins by core `MSG_WIN` |
| `surrender-at-opening` | 0 | opponent wins by explicit surrender |

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

| Plan range | Status | Notes |
|---|---|---|
| Step 01 | Complete | Six exact scenarios, stable fingerprints, fixed results/digests, and a failing-on-gap matrix test exist. |
| Step 02 | Mostly complete | Local headless command is green; CI is still absent. |
| Steps 03-10 | Headless scope complete/mostly complete | Contracts, verified snapshot loading, presets, dependencies, lifetime, production shuffling, and process loop work. Raw message-byte retention remains absent. |
| Steps 11-12 | Partial | Primary projection works; full field-query reconciliation, overlays, and unusual move/reload flows remain. |
| Steps 13-16 | Functionally complete for Checkpoint C | Every response family passes real-WASM evidence; broader malformed binary fixtures remain debt. |
| Step 17 | **Complete locally** | All six scenarios and all 45 matrix rows are green. |
| Step 18 | Mostly complete | The basic opponent completes legal real turns; broader per-priority unit fixtures remain. |
| Steps 19-30 | Not started | Visual/browser/persistence work has not begun. |

Checkpoint C's technical condition is met. Before beginning Step 19, the safest next action is one clean-checkout/offline-equivalent run or CI job to accept the final procedural visual gate.

## 6. Remaining risks and debt

### Protocol diagnostics

The distributed high-level adapter parses messages internally and skips unknown shapes without exposing their raw bytes. A future compatibility trace cannot yet preserve unknown raw payloads. Do not claim full Step 11/25 diagnostics until this is solved through a reviewed lower-level wrapper or another documented vendor patch.

### Projection completeness

`DuelStateProjector` remains event-driven. It does not yet fully reconcile:

- overlay materials;
- rich chain metadata;
- unusual ownership/control swaps;
- field/pendulum separation;
- refresh/swap/reload message families;
- stable physical card IDs across every obscure move.

Keep opponent hidden information absent—not merely visually hidden—when expanding it.

### Lifecycle and queue semantics

- Lifecycle commands still lack per-duel/idempotency IDs.
- Queue-overflow errors may be emitted before events from earlier accepted commands.
- Native `destroyDuel` failures are terminal and are not retried because the native outcome is uncertain; the future client must replace that Worker.
- Filesystem/WASM work can only be cooperatively abandoned between initialization stages.
- `BoundedDuelTrace` still uses `Array.shift()` at capacity.

### Surrender

Surrender is a local authoritative lifecycle result because the high-level adapter exposes no core surrender API. It immediately disposes the core session and is pinned by a deterministic real-session scenario.

### Visual packaging

The future browser bundle must:

- avoid importing Node-only `*-node.ts` modules;
- package only the synchronous WASM path;
- keep test-only programmed configuration/startup scripts out of public commands;
- preserve Worker replacement after uncertain native cleanup;
- add browser smoke coverage before release.

## 7. Working-tree caveats

- All implementation remains uncommitted on `main...origin/main`.
- Preserve the current working tree.
- `.pi/` and `.agentsystem/` are pre-existing tooling/scratch content; do not include them accidentally.
- No visual dependency has been installed.
- No commit, push, or PR has been made.

## 8. Recommended next sequence

1. Run `npm run check:headless` once more after any merge/rebase or from a clean checkout with the verified ignored snapshot available.
2. Add CI for the canonical headless gate, or explicitly accept the equivalent clean-checkout result.
3. If the gate is accepted, begin Step 19 with the smallest textual browser shell and Worker client; do not jump directly to Phaser.
4. Keep the six programmed transcripts and zero-uncovered matrix mandatory for every engine, preset, script, or protocol change.
5. Continue raw-message diagnostics and projection hardening in parallel only when they do not destabilize the pinned headless contract.

## 9. Useful commands

```bash
npm run check:headless
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run vendor:verify
npm run assets:verify
npm run snapshot:verify
git status --short
git diff --stat
```
