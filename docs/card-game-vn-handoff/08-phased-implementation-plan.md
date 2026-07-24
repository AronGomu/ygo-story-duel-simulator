# Phased Implementation Plan

> Status: approved handoff; no phase implemented by this documentation change  
> Goal: ship minimal end-to-end prologue without weakening completed duel MVP

## Execution rules

- No big-bang rewrite or repository move.
- Existing duel remains runnable and green after every phase.
- Add facade before changing consumers.
- Add pure contracts/validators before UI.
- Add red test before behavior where practical.
- Update canonical architecture docs when implementation changes reality.
- Run focused tests during iteration; every phase ends with `npm run check`.
- Public build rejection remains active throughout.
- Generated runtime/card assets remain managed by existing pipeline.

## Baseline gate

Before Phase 1:

```bash
npm run format
npm run check
```

Record:

- current runtime snapshot ID;
- active runtime/image closure counts;
- programmed trace digests;
- unit/component/integration/e2e counts;
- reproducible build result;
- private packaging marker.

If baseline is red, fix/reconcile current baseline before story work. Do not combine baseline repair with new architecture.

## Phase 0 — Contract and ownership scaffolding

### Goal

Create domain boundaries without changing runtime behavior.

### Work

- Add target domain directories only as first used.
- Add `index.ts`, README, AGENTS for shell/campaign/narrative/map/battle/content/assets/saves/decks/pwa.
- Add import-boundary ESLint rules.
- Add temporary narrow migration exceptions for existing duel paths.
- Define shared opaque IDs in owning domains.
- Add architecture tests/lint fixtures proving forbidden deep imports fail.
- Keep current `src/main.ts` → existing `App.svelte` behavior unchanged.

### Verification

- Current application still launches directly into duel.
- No production bundle change except inert scaffolding.
- Lint rejects representative forbidden imports.
- `npm run check` passes.

### Stop gate

Do not extract battle facade until import ownership and public API rules are enforceable.

## Phase 1 — Self-contained battle facade

### Goal

Wrap completed duel as one feature without changing duel behavior.

### Work

- Add `src/battle/index.ts` and facade contracts.
- Extract current duel page composition from oversized app shell into battle-owned screen/component while preserving UI semantics.
- Keep existing `DuelWorkerClient`, store, prompts, Phaser field, image cache, diagnostics, snapshot storage, and Worker internals behavior-identical.
- Add immutable discriminated request parser.
- Add versioned built-in deck provider for current preset.
- Add battle readiness API as sole public source of active/fallback runtime snapshot, activation snapshot, image digest, and battle capabilities.
- First slice accepts only exact `preset` request matching current preset, built-in deck revision, and full `DuelSnapshotRef`; reject deck/rules/opponent mismatches instead of ignoring fields.
- Keep arbitrary `deck` request unavailable until Phase 7.
- Map current `DuelResult` variants to `resolved | aborted | failed` with exhaustive finish-reason table.
- Advertise draw capability only after Worker/result projection can emit and tests can prove it; reject encounter draw route otherwise.
- Add host/mount session lifecycle: battle UI owns prompts, restart, result, diagnostics, Continue/Return; completion settles only after cleanup.
- Preserve a direct battle harness for current e2e regression flow.

### Tests

- Request exact-key/bounds/privacy tests.
- Result mapping for complete, surrender, unsupported, engine error, Worker failure.
- Engine failure never maps to player loss.
- Mount/unmount/retry/replacement cleanup and completion-after-disposal ordering.
- Exact preset request acceptance plus mismatched snapshot/deck/request rejection.
- Draw-capability absent/present validation.
- Existing full prompt, Phaser, image, diagnostics, restart, privacy, and browser tests unchanged or equivalently routed.

### Verification

```bash
npm run test:unit
npm run test:component
npm run test:integration
npm run check
```

### Stop gate

Campaign work cannot consume Worker client/store or `DuelResult`; only facade public API.

## Phase 2 — Content schemas and bundled prologue pack

### Goal

Prove content is safe, deterministic, versioned data before implementing game flow.

### Work

- Define versioned campaign, variable, condition, scene, map, encounter, character, and pack schemas.
- Implement bounded exact-key parsers and semantic validation.
- Implement typed JSON condition AST validator/evaluator.
- Add canonical hash generation, cross-reference validation, required-runtime-capability collection, and migration-chain ID validation against app-owned registry.
- Author minimal bootstrap/prologue fixtures:
  - one campaign;
  - one chapter;
  - one short scene;
  - one choice;
  - one map with two locations;
  - one encounter referencing exact existing preset/built-in deck;
  - one win outcome scene;
  - one loss outcome scene;
  - no draw route unless runtime advertises support;
  - one flag/reward.
- Package immutable prologue bytes outside JS chunks.
- Do not add runtime activation yet; build/test validates bytes and manifest.

### Tests

- Valid fixture.
- Unknown/missing/extra keys.
- Type/range/size failures.
- Undeclared variable reads/writes.
- Invalid condition operand types.
- Duplicate IDs and broken refs.
- Goto/label errors and bounded nesting/cycles.
- Map coordinate and destination errors.
- Pack dependency, duel-snapshot, and required-runtime-capability errors.
- Encounter outcome/abort policy and unsupported draw-route errors.
- Deterministic manifest/hash output.

### Stop gate

No content UI may consume unvalidated raw JSON.

## Phase 3 — Pure campaign and narrative runtimes

### Goal

Complete deterministic, serializable game logic without browser/storage/UI dependencies.

### Work

- Implement validated `createCampaign(content, request)` plus immutable `CampaignState` and pure reducer.
- Implement one-pending-effect source in campaign state with ready/running/failed status, persisted session ID + load/restore effect generation + monotonic effect sequence, attempt counter, and stale/duplicate/mismatched-result rejection.
- Implement declared variable writes and objective/reward/map evaluation.
- Implement deterministic narrative cursor interpreter.
- Implement command families used by first slice.
- Recognize target schema variants for later audio/effects while rejecting packs that require unimplemented capabilities.
- Convert narrative map/battle/reward/variable intents into campaign reductions/effects.
- Define explicit stable save-point predicate plus reducer-owned stable revision/last-autosaved revision scheduling; shell rerender cannot create autosave.
- Implement durable pre-battle saga state carrying exact stable pre-effect snapshot, deterministic write ID, explicit pre-battle target, expected revision, and continuation; persist-checkpoint ready creates battle effect; typed conflict/quota/invalid/storage-unavailable never dispatch battle.
- Implement serializable battle recovery state and retry/return transitions for aborted/failed results; Return creates restore-checkpoint effect and accepts only exact checkpoint revision.
- Implement normalized battle-result reduction plus encounter outcome routing.
- Implement pure campaign/content migration planner registry with missing-pack/unsupported/invalid-result outcomes.

### Tests

- Complete pure prologue transcript through checkpoint-write effect, successful checkpoint ref, battle effect emission, and win/loss scene routing.
- Save-failure transcript proves battle effect is absent until checkpoint succeeds.
- Same commands produce same state/effect digest.
- Invalid/stale choice and intent IDs.
- Stale/duplicate effect completion, deterministic effect-ID allocation, sequence persistence, generation bump across load/restore, and old-generation/attempt late completion.
- Autosave stable-revision dedupe and deterministic write ID.
- Failed battle does not mutate progression as loss.
- Cancel/abort behavior.
- Independent hidden/locked/available access plus completed-state truth table.
- Save-safe vs unsafe state matrix.
- Serialization/structured-clone fixtures.

### Verification

Pure runtime tests must run without JSDOM/browser APIs.

### Stop gate

No shell effect executor until full pure transcript is green.

## Phase 4 — Shell, narrative UI, and map UI

### Goal

Render pure state through accessible Svelte screens and execute map/battle effects.

### Work

- Replace root composition with typed App Shell.
- Add `GameMode` union and separate overlays.
- Add title/New Game/Load shell surfaces.
- Add narrative screen layers and controls.
- Add illustrated map hotspots plus always-present accessible location list.
- Add shell effect executor: dispatch `effect-started` before facade invocation; return typed `effect-completed` for domain outcomes or `effect-execution-failed` for executor faults; explicit retry increments attempt.
- Adapt campaign `InstallPacksIntent` to ContentManager request by injecting battle readiness snapshot + composed runtime capabilities.
- Exercise battle facade mount/result integration through direct battle harness and isolated shell tests.
- Production campaign `run-battle` remains blocked until Phase 5 provides real durable pre-battle persistence; fake save/content/PWA adapters are test-only and cannot enter production New Game flow.
- Preserve direct battle regression harness.

### UI requirements

- Keyboard complete.
- Visible focus.
- Correct heading/focus restoration on mode change.
- Accessible names/states for hotspots and list items.
- 44px touch targets.
- Reduced-motion behavior.
- Deterministic missing background/sprite fallback.
- Loading, empty, recoverable error, fatal error, and retry surfaces.
- No duplicate effect dispatch on double click/re-render.

### Tests

- Exhaustive `GameMode` rendering.
- Narrative advance/choice focus.
- Hotspot/list parity.
- Locked/hidden behavior.
- Campaign-controlled map cancel.
- Isolated battle effect dispatch once and normalized completion without claiming durable campaign integration.
- Effect retry keeps ID, increments attempt, and rejects late prior-attempt result.
- Stale completion cannot switch mode.

### Stop gate

Do not call first slice complete with fake save/content/PWA adapters.

## Phase 5 — Saves, ContentManager, AssetResolver, and PWA shell

### Goal

Make first slice installable, durable, version-compatible, and offline.

### Saves

- Implement explicit manual slot/autosave stream/pre-battle write targets plus SaveSummary; no implicit key-to-slot guess.
- Implement versioned save envelope with one authoritative CampaignState; derived summary/index mismatch reports corruption.
- Persist pre-battle recovery metadata from continuation and produce interrupted-battle GameLoadResult with retry/return state.
- Implement immutable built-in deck revision provider validation before local deck repository exists.
- Implement atomic manual/autosave/pre-battle writes in IndexedDB.
- Implement bounded autosave rotation.
- Implement checksum and exact-key validation.
- Implement pure migration registry plus revision-guarded atomic `migrate` API and revalidation.
- Implement SaveRepository read outcomes for ready/migration/incompatible-save-schema/corrupt.
- Implement shell load orchestration: save read/migrate → battle readiness exact snapshot → ContentManager `checkInstalled` → deck revision validation → typed ready/deck-recovery/missing/incompatible campaign load.
- Implement campaign/content migration: install/check target set, run pure planner, validate target state, atomically write new save revision containing migrated state + pack ref; retain original on failure.
- Pin campaign version, pack set, duel snapshot, deck revision.
- Implement idempotent checkpoint writes from request-carried stable snapshot; never persist current running effect state.
- Wire production durable two-step pre-battle saga: checkpoint write success returns campaign-owned ref before campaign creates battle effect.
- Restore pre-battle checkpoint after interrupted/aborted/failed battle according to policy.

### Content

- Compose content-owned validation port from campaign/narrative/map/encounter pure public validators; ContentManager supplies bounded reader over exact staged bytes and commits/loads immutable validated indexes by exact PackSetRef without feature deep imports.
- Implement typed ContentManager install results for cancel/network/quota/verification/incompatibility/conflict plus ready.
- Implement staging/verification with separate install-only commit and activate-default CAS; saved dependency install cannot change New Game default.
- Reserve executor failure for unexpected thrown transport/implementation faults.
- Activate bundled prologue bytes through real path.
- Implement installation-global default/fallback pack-set pointers with staged expected-ID + generation CAS and cross-tab lock.
- Pin independent campaign-session pack set; global default update cannot mutate active play.
- Implement unique per-tab runtime pack leases with content-owned opaque client/owner IDs, heartbeat/expiry/release; shell maps app IDs and same persisted campaign in two tabs receives independent leases.
- Make SaveRepository implement read-only retained-pack source from committed envelopes; do not duplicate save retention records.
- Implement one cross-tab exclusive retention lock shared by save write/delete/migrate, runtime lease mutations/expiry, default/fallback activation/rollback, manual pack removal, and GC; removal/GC hold it from all-source rescan through deletion.
- Implement save-aware garbage-collection protection across default/fallback, live leases, and committed save-envelope retention sources.
- Implement read-only AssetResolver + disposable handles.
- Keep battle snapshot storage separate.

### PWA

- Compose immutable RuntimeCapabilities including app semantic version/schema plus narrative/condition/battle/deck public exports and require it for pack staging.
- Add web app manifest.
- Add `vite-plugin-pwa` in `injectManifest` mode.
- Implement base-safe typed service worker for shell precache/navigation fallback/update signaling.
- Implement all-controlled-client safe-state handshake plus synchronous unsafe-operation gate; update lease freezes new battle/save/content-staging/content-activation/snapshot-activation/effect/transient-UI starts before final nonce/client-set CAS.
- Implement safe-boundary confirmation flow and retain current/previous shell caches until old-build clients close.
- Preserve private package rejection/marker.

### Tests

- Discriminated manual create/overwrite, autosave rotation, and pre-battle requests/envelopes; pre-battle recovery metadata required only for pre-battle writes; interruption/atomicity/corruption, typed migration conflict/re-read with mandatory replacement checkpoint identity, idempotent lost-completion retry, and exact load-by-checkpoint revision/key.
- Interrupted-battle envelope restores stable state plus retry/return metadata; continuation not lost.
- Missing pack recovery through ContentManager check/install, deck-recovery load/reselection, unsupported campaign migration, and incompatible save block.
- Built-in/local deck revision mismatch block; no silent substitution.
- Pack hash/length/ref/dependency failure and every typed normal install failure result.
- Install missing saved dependency without changing global default.
- Interrupted staging keeps active set.
- Discriminated install-only/activate-default request validation, typed CAS activation/rollback/removal conflicts, protected-pack removal, stale-tab rejection, session/default separation, per-tab lease isolation/expiry, save-source retention, and concurrent lease/activation/save/removal-vs-GC TOCTOU tests.
- Asset handle disposal/stale set behavior.
- Offline app-shell startup.
- Update waits during battle/save/content staging/activation/snapshot activation/effect/transient UI, including unsafe second tab and race attempting unsafe start after safety report.
- Non-root base URL.

### Stop gate

No first-slice acceptance until production build passes cold offline start.

## Phase 6 — End-to-end prologue acceptance

### Goal

Ship code-ready minimal post-MVP vertical slice.

### Required flow

1. Install private PWA.
2. Start online once only if browser requires initial navigation.
3. Verify bundled prologue pack activates.
4. Start New Game.
5. Complete narrative choice.
6. Open map and use hotspot path.
7. Repeat using accessible list path.
8. Start required existing duel.
9. Complete player-win branch.
10. Complete player-loss branch through test-only facade composition excluded from production bundle; separately prove opponent-win → normalized player-loss mapping with real-WASM programmed scenario.
11. Persist flag/reward.
12. Verify manual save/load.
13. Verify autosave.
14. Interrupt active battle; load pre-battle checkpoint.
15. Close browser/network; cold-start installed app offline.
16. Replay complete slice offline.
17. Download diagnostics from battle failure fixture.
18. Confirm no hidden opponent data crosses Worker.

### Automated gates

- Pure campaign/narrative transcript tests.
- Component a11y/interaction tests.
- Real-WASM battle integration through production facade for reachable flow.
- Test-only injected facade covers deterministic player-loss UI/campaign branch; production build verification rejects test seam/markers.
- Real-WASM programmed opponent-win scenario covers actual result mapping to player-loss.
- Production Playwright prologue flow.
- Offline Playwright flow.
- PWA update safe-boundary flow.
- Existing complete `npm run check`.
- Reproducible private build.

### Manual QA

- Desktop Chrome, Firefox, Safari proxy coverage per current policy.
- 375px map/narrative usability.
- Keyboard-only full slice.
- Reduced motion.
- Storage quota/recovery messaging.
- PWA update prompt during safe state and suppression during battle.

### Acceptance

First slice is accepted only when all current duel gates and all new flow gates are green. No waiver converts engine/content/save/PWA failure into a successful campaign outcome.

## Phase 7 — Local deck library and editor

### Goal

Enable target unrestricted local deck management after first slice.

### Work

- Deck repository with optimistic revision checks.
- Create/edit/rename/duplicate/delete.
- Catalog search and validation.
- YDK import/export.
- Deck selection before eligible encounters.
- Add `resolve-deck` effect before pre-battle checkpoint: load/validate exact selected revision against pinned duel snapshot; persist typed missing/revision-mismatch/invalid recovery for reselection/retry; only ready exact match builds immutable deck battle request.
- Extend Worker start path to validated arbitrary deck snapshot without exposing deterministic/test seams.
- Save pins selected revision.
- Handle edited/deleted deck on load through explicit incompatibility/reselection flow.

### Gates

- CRUD surface inventory and tests.
- Deck validation and malformed YDK fixtures.
- Revision conflict tests.
- Real-WASM arbitrary validated deck integration.
- Current programmed preset compatibility unchanged.

## Phase 8 — Progressive chapter downloads

### Goal

Add network acquisition UI and background content scheduling.

### Work

- Remote pack catalog/provenance.
- Resumable verified transfer.
- Blocking/background priority queues.
- Progress, pause, retry, quota, removal UI.
- Next-chapter prefetch.
- Optional audio/high-resolution pack priority.
- Save-aware retention and offline recovery.

### Gates

- Retry/idempotency/concurrency tests.
- Corrupt/partial/range/no-range server fixtures.
- Quota and cleanup tests.
- Active-play pack-set pinning.
- Cross-tab activation race tests.
- Offline continuation after partial future download.

## Later optional phases

- Narrative history, auto-play, skip.
- Audio/music content and settings.
- Localization catalogs.
- Shops, quests, relationships, tournaments.
- Card-ownership progression if product direction changes; must not silently restrict existing unrestricted deck library.
- OPFS after measured need.

## Rollback strategy

Each phase must be removable without changing current duel engine/runtime:

- facade can route direct battle harness;
- shell feature flag may retain current direct-duel entry until first-slice acceptance;
- campaign/content/save records use new DB stores and schema versions;
- PWA update can be removed without touching duel Worker;
- default/fallback/session pack sets remain immutable;
- no migration deletes current snapshot metadata or caches.

## Documentation updates per phase

When phase lands:

- mark phase status here;
- update [`00-index.md`](00-index.md);
- update relevant current files under `docs/architecture/`;
- update domain README/AGENTS;
- update README setup/commands if dependencies/scripts change;
- update PWA/content/save operational docs;
- record new env/build inputs without weakening private deployment safeguards.
