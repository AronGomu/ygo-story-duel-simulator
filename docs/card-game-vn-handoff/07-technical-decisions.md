# Technical Decisions

> Status: approved future design; implementation remains phased

## Accepted

### Product and presentation

- Product remains Yu-Gi-Oh!-specific.
- Generalize internal seams only when it reduces coupling.
- Visual-novel presentation covers non-battle game modes.
- Existing Svelte prompt UI + Phaser duel field remains battle presentation.
- Campaign uses authored chapters with gated illustrated map hubs.
- Map provides positioned hotspots plus equivalent accessible location list.
- No free movement or world simulation.

### Baseline preservation

- Preserve all current duel guarantees and release gates.
- Preserve Worker authority, hidden-information filtering, typed protocol, atomic duel snapshot, diagnostics, deterministic compatibility fixtures, bounded failure handling, and reproducible/browser gates.
- Permit shell decomposition and file moves only with behavior parity.
- Do not rewrite current duel to add story.

### Repository and boundaries

- Keep one npm application package.
- Use domain folders, public `index.ts` entry points, focused README/AGENTS files, and import-boundary lint rules.
- No deep cross-domain imports.
- No generic shared/common/utils/core dumping ground.
- No monorepo/workspace migration.

### Shell and campaign

- Plain Svelte SPA on current Vite app.
- Explicit discriminated `GameMode`; separate typed overlays.
- Campaign engine is pure reducer over immutable serializable state.
- Campaign state is sole source for at most one correlated blocking effect.
- Effect lifecycle uses ID derived from persisted campaign-session ID + load/restore generation + monotonic sequence, plus attempt number and ready/running/failed status.
- Normal feature outcomes return through typed `effect-completed`; executor faults use `effect-execution-failed`.
- Reject stale ID/attempt, duplicate completion, and mismatched result type.
- User retries keep effect ID and increment attempt.
- Only idempotent content transfer may auto-retry with bounded backoff.

### Narrative and maps

- Versioned strict JSON content; no executable code.
- Deterministic serializable cursor interpreter.
- Full target command families recognized by schema; shell supplies immutable RuntimeCapabilities including app semantic/schema versions plus domain capabilities, and activation rejects incompatible ranges/capabilities.
- Typed campaign variables declared in manifest.
- Strict typed JSON expression AST; no eval/string code.
- Campaign owns map availability and destination revalidation.
- Campaign controls map cancellation.

### Battle

- Shell opens self-contained battle facade.
- Facade owns current Worker client, store, prompts, Phaser, restart/result/diagnostics UI, and disposal for one mounted interactive session.
- Facade completion settles exactly once only after explicit Continue/Return or teardown cleanup; abort/dispose cannot strand completion.
- Battle readiness API is sole public source for default-active/fallback or exact required runtime snapshot, activation snapshot, image-manifest revision, and battle capabilities.
- Facade accepts validated immutable preset/deck request matching readiness data.
- Facade returns normalized `resolved | aborted | failed` result.
- Technical failure never becomes player loss.
- Current low-level Worker contracts remain battle-private.

### Decks

- Target includes unrestricted local deck library with create/edit/validate/import/export/select.
- Campaign card ownership does not restrict editor card access.
- Canonical storage is versioned JSON deck record in IndexedDB.
- YDK is import/export format.
- Save pins deck ID + revision.
- First vertical slice may use existing fixed deck; editor ships later.

### Saves

- Save outside active battles only.
- Save writes use explicit manual slot, autosave stream, or pre-battle target; repository never guesses manual slot.
- Manual slots + bounded rotating autosave.
- Durable pre-battle checkpoint request carries exact stable pre-effect state, deterministic write ID, and expected revision; successful idempotent write must return checkpoint ref before battle effect is created/dispatched.
- Pre-battle envelope persists typed interrupted-battle metadata; load restores stable state plus retry/return recovery rather than losing intent.
- Save only at explicit serializable stable states.
- Reducer-owned gameplay stable revision schedules idempotent autosave; persistence/effect/UI bookkeeping never increments it, so completion cannot reschedule itself.
- Versioned envelope stores one authoritative campaign state containing campaign, session pack set, exact duel snapshot ref, and deck revision; summary indexes derive and must match.
- Save-envelope migrations use revision-guarded atomic migrate/re-read API.
- Campaign/content migrations use app-owned pure planner; migrated state + target pack ref write together, original save retained on failure.
- SaveRepository owns save bytes/schema only; shell checks saved pinned set through ContentManager and offers install path for missing compatible packs.
- No silent coercion/defaulting/revision substitution.

### Content and assets

- Keep current atomic duel snapshot intact.
- Story/media use separate immutable content-addressed packs.
- Campaign emits pack intent only; shell injects battle readiness snapshot + composed runtime capabilities into ContentManager request.
- Expected save/content conflict, quota, cancellation, network, verification, incompatibility, and storage outcomes are typed domain results; executor failure is reserved for unexpected thrown faults.
- ContentManager owns pack lifecycle, quota, progress, cache, activation, rollback, cleanup.
- AssetResolver is read-only and returns revision-bound disposable handles.
- Pack sets stage and fully verify; install-only commit satisfies pinned save/session dependencies without pointer change, while activate-default uses expected ID + generation CAS.
- Active play and saves pin independent session pack set; global update never mutates running campaign.
- Keep previous compatible default as fallback.
- Content-owned opaque per-tab runtime lease IDs protect running sessions; shell maps campaign/PWA IDs at boundary, preserving dependency direction. Heartbeat/expiry/release prevents one tab dropping another tab's protection.
- Committed save envelopes are read-only pack-retention source; no duplicate save-retention record.
- Save mutations, runtime lease changes, default/fallback activation/rollback, manual pack removal, and GC share cross-tab exclusive retention lock held through all-source rescan/deletion; protected removal returns typed outcome.
- Garbage-collect only packs unreferenced by default/fallback, live runtime leases, or retained saves.
- First slice ships bundled bootstrap/prologue pack bytes outside JS and activates through ContentManager.

### PWA and distribution

- Installable offline PWA.
- Use `vite-plugin-pwa` `injectManifest` with project-owned typed service worker.
- Service Worker owns app shell, navigation fallback, offline startup, and update signaling only.
- ContentManager owns story/media caches.
- App update activates after user confirmation plus all-controlled-client versioned safety lease, synchronous unsafe-operation gate freeze for every declared unsafe operation, and final nonce/client-set CAS; unsafe second tab blocks activation.
- Retain current/previous shell caches until no old-build client remains.
- Persist safe state before reload.
- Continue private-only builds/installs.
- Preserve hard rejection for unapproved public package.

### First acceptance slice

- New Game + Load.
- One short scene, one choice.
- One map hub, two locations.
- One required current battle.
- Win/loss branches.
- One persisted progression flag/reward.
- Safe-boundary manual save, autosave, pre-battle recovery.
- Bundled prologue pack activation.
- PWA install + complete offline replay.
- Deck editor and network download UI deferred.

## Deferred with explicit boundary

- Localization catalog: first slice English-only; stable IDs required now.
- Auto-play, skip, dialogue backlog/history, voice, and cinematics.
- Actual music/sound assets; target schema reserves commands.
- Exact schema-validation library and code-generation tool, chosen during implementation dependency review.
- Exact autosave rotation count and UI layout; storage remains bounded.
- Exact download concurrency/rate caps; implementation config + tests own values.
- OPFS; use Cache Storage first and migrate only after measured need.
- Full card-image strategy beyond current verified behavior.
- Shops, quests, relationships, tournaments, and card-ownership progression.
- Stronger/general opponent policy.
- Public deployment and legal approval process.
- Server-authoritative multiplayer.

## Rejected

- Treating this handoff as current implementation before phases land.
- Immediate canonical replacement without migration.
- Full workspace monorepo.
- SvelteKit migration.
- Campaign or narrative direct calls into Worker/battle internals.
- One terminal `startBattle()` Promise with no defined interactive ownership.
- Exposing raw `DuelResult` to campaign.
- Map-owned availability evaluation from raw campaign variables.
- Live WASM/battle-state serialization.
- Arbitrary executable story content.
- String `eval` conditions.
- Mutable in-place pack updates.
- Service-worker-owned story pack activation.
- Size-only integrity verification.
- Mixed rules/catalog/script versions.
- Immediate service-worker reload during active state.
- Silent save coercion.
- Free movement, tile maps, collision, pathfinding, NPC schedules.
- Public distribution while current approval flags remain false.

## Decision-change protocol

Changing accepted decision requires:

1. update affected handoff docs together;
2. identify current canonical decisions impacted;
3. state migration/data/runtime consequences;
4. preserve or explicitly replace acceptance tests;
5. run full current gate after implementation;
6. never leave competing active decisions undocumented.
