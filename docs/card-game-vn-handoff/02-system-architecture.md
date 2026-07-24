# System Architecture

> Status: approved future design; not implemented

## Architectural goal

Add campaign, narrative, map, save, deck, content, and PWA systems around the completed duel client without rewriting its authority boundary or converting the repository into a monorepo.

## Runtime topology

```text
Browser main thread
├── App Shell
│   ├── typed GameMode
│   ├── campaign store/reducer
│   ├── effect executor
│   └── global overlays and recovery
├── Narrative Feature
├── Map Feature
├── Battle Feature Facade
│   ├── existing DuelWorkerClient + duel store
│   ├── existing Svelte prompt/result UI
│   └── existing Phaser field
├── Deck Library
├── Save Repository
├── ContentManager
├── AssetResolver
└── PWA Update Coordinator

Dedicated Duel Worker — unchanged authority
├── verified synchronous WASM
├── duel session/process loop
├── protocol + response encoding
├── public-state projection
├── opponent policy
└── duel diagnostics

Service Worker
├── app-shell precache
├── navigation fallback
├── offline startup
└── app-version update signaling

ContentManager — main-thread application service
├── story/media pack download + staging
├── hash/length/dependency verification
├── atomic pack-set activation
├── quota/progress/rollback
└── content cache ownership
```

Service Worker does not own story/media pack lifecycle. ContentManager does not own duel runtime snapshots. Battle subsystem keeps current snapshot and image-cache rules.

## Source layout

Remain one npm package. Add domain folders with public entry points; do not create workspace packages.

```text
src/
├── main.ts
├── shell/
│   ├── index.ts
│   ├── app-mode.ts
│   ├── shell-store.ts
│   ├── effect-executor.ts
│   ├── AppShell.svelte
│   ├── README.md
│   └── AGENTS.md
├── campaign/
│   ├── index.ts
│   ├── contracts/
│   ├── reducer/
│   ├── conditions/
│   ├── content/
│   ├── README.md
│   └── AGENTS.md
├── narrative/
├── map/
├── battle/
│   ├── index.ts                  # new facade only
│   ├── battle-facade.ts
│   ├── battle-result-map.ts
│   ├── README.md
│   └── AGENTS.md
├── decks/
├── saves/
├── content/
├── assets/
└── pwa/
```

Existing `src/app/`, `src/duel/`, `src/field/`, `src/worker/`, and relevant `src/storage/` files remain in place initially. `src/battle/index.ts` wraps them. Move existing duel files only in a later behavior-preserving phase with full parity gates; no move is required for first slice.

Authored content lives outside runtime code:

```text
content/
├── campaigns/
├── scenes/
├── maps/
├── encounters/
├── characters/
└── packs/
```

## Dependency direction

Runtime imports follow this exact graph:

```text
main.ts
→ shell public API

shell
→ campaign public API
→ narrative / map / battle / decks / saves / content / assets / pwa public APIs

campaign
→ narrative public pure-runtime API
→ map public contract types
→ battle public contract types
→ decks public reference types
→ content public reference types
→ owned condition/content contracts

battle
→ existing duel client/store/UI internals
→ existing duel contracts
→ decks public reference types + built-in deck provider

decks
→ duel catalog/validation public types only

saves
→ campaign persisted state/checkpoint types
→ decks/content/battle public reference types
→ implements read-only pack-retention source for ContentManager GC

map / narrative
→ no shell, campaign implementation, storage, Worker, or browser service imports

content
→ browser adapters behind owned interfaces
→ content-owned validation port injected by shell

assets / pwa
→ browser adapters behind owned interfaces
```

All campaign imports outside campaign/narrative are type-only port DTOs. Map, battle, and decks never import campaign. Content validation contracts may type-import immutable validated-index types, but ContentManager never imports campaign/feature implementation, preventing runtime cycles. `persist-checkpoint` effect uses campaign-owned request; shell adapts it to SaveRepository so campaign does not import saves. Shell composes content-owned `ContentValidationPort` from campaign/narrative/map/encounter pure validator public APIs.

Rules:

- Every domain exposes `src/<domain>/index.ts`.
- Cross-domain imports target public entry points only.
- No deep import into another domain.
- No relative import escaping a domain except through approved public entry points during staged migration.
- No generic `shared`, `common`, `utils`, or `core` folder.
- Shared type ownership follows business authority: campaign IDs in campaign, pack IDs in content, deck IDs in decks, battle result mapping in battle.

## App Shell ownership

Shell owns composition and I/O, not game rules.

### Full-screen mode

Use one discriminated union:

```ts
type GameMode =
  | { type: "boot" }
  | { type: "title" }
  | { type: "narrative" }
  | { type: "map" }
  | { type: "battle" }
  | { type: "deck-library" }
  | { type: "save-load" }
  | { type: "content-install" }
  | { type: "fatal-error" };
```

Modal/overlay state is separate and typed. Independent booleans must not create contradictory full-screen modes.

Mode changes occur only through:

- explicit global shell commands, such as returning to title;
- accepted campaign state transitions;
- correlated effect completion.

### Effect execution

Campaign state is sole effect source. It records at most one `PendingCampaignEffect` with stable effect ID, attempt number, status, request, and last executor error.

- Shell dispatches facade only after observing reducer transition to `status: "ready"`.
- Shell first sends `effect-started`, then invokes exactly one matching facade.
- Normal map/battle/content/save outcomes return as typed `effect-completed` domain results.
- Thrown/mount/transport faults return as `effect-execution-failed`.
- Retry keeps effect ID, increments attempt, and returns status to ready.
- Reject stale ID, stale attempt, duplicate completion, and mismatched result type.
- Only idempotent content-transfer sub-operations may auto-retry with bounded backoff.
- Battle, map, and persistence never auto-repeat silently.
- Reward/variable mutation remains pure reducer work, not external effect.

## Campaign ownership

Campaign is progression authority. It owns:

- chapter, objective, variable, flag, reward, unlock, and selected-deck references;
- active narrative checkpoint;
- current map and evaluated location availability;
- durable pre-battle checkpoint reference plus serializable deck/battle recovery state;
- campaign-session pinned content-pack set reference;
- exact duel runtime/activation/image revision reference sourced from battle readiness API;
- stable-state/autosave revision counters;
- one pending blocking effect with attempt state.

Campaign is a pure reducer over immutable serializable state and explicit validated content input. It performs no I/O and imports no Svelte/browser code. Autosave scheduling is reducer-owned from stable revision, never inferred from Svelte rerenders.

## Narrative ownership

Narrative runtime owns scene cursor and derived presentation state. It does not call map, battle, save, asset, or storage services. It returns typed internal intents to campaign. Campaign converts external intents into blocking effects.

## Map ownership

Campaign evaluates map conditions and supplies immutable `EvaluatedMapView`. Map feature renders image hotspots and accessible list, then returns selected/cancelled result. Campaign revalidates location ID before state transition.

## Battle ownership

Battle facade is self-contained. Its readiness API is sole public source for active/fallback `DuelSnapshotRef` used by New Game, saves, packs, and battle requests. It mounts into shell-provided host and owns existing Worker client, duel store, prompt UI, Phaser field, image handling, diagnostics, restart/surrender/result controls, and cleanup for one invocation. Restart stays inside battle session. Explicit Continue/Return settles normalized completion only after facade disposal.

First slice accepts exact built-in preset request matching current Worker contract. Arbitrary validated deck request remains unavailable until deck phase extends Worker start contract. Current Worker contracts remain internal to battle domain. Campaign never subscribes to duel events or imports `DuelResult`.

## Save ownership

Save repository owns explicit manual slot, autosave stream, and pre-battle targets; summaries, physical slots, versioned envelopes, checksums, save-schema migrations, and atomic writes. Campaign owns checkpoint target/ref DTOs plus exact persistable pre-effect snapshot, so campaign never imports saves. Shell maps each campaign target explicitly; repository never guesses manual slot. Pre-battle envelope persists typed interrupted-battle recovery metadata from continuation. Save envelope stores one authoritative persistable campaign state; derived campaign/deck/pack/snapshot indexes must match or read reports corruption.

SaveRepository does not decide content availability. Shell load orchestration performs: save read/migrate → battle readiness snapshot → ContentManager `checkInstalled` for pinned set → built-in/local deck revision validation → campaign load/restore. Existing snapshot storage remains battle-owned. First slice validates built-in deck revision through immutable provider; local deck repository remains separate for later deck phase.

## Content/PWA ownership

- ContentManager owns installed pack sets plus installation-global default/fallback and caches.
- Install-only commit satisfies saved/session dependencies without changing default; activate-default is explicit bootstrap/update operation with CAS.
- Each running tab holds unique expiring pack lease for pinned campaign `sessionPackSet`; saves expose committed pack refs as read-only GC source.
- Multiple tabs loading same campaign session never share runtime lease identity.
- Global activation never mutates active play.
- AssetResolver receives explicit pinned set and returns disposable revision-bound handles.
- Service Worker owns app shell only.
- PWA update coordinator activates new shell only after explicit confirmation plus all-controlled-client safety lease.
- Shell battle/save/content-staging/content-activation/snapshot-activation/effect/transient-UI starts must synchronously acquire operation permit; update lease freezes gate before final activation CAS.
- Current/previous shell caches remain until no client uses previous build.

## End-to-end flow

```text
Shell dispatches campaign command
→ campaign reducer updates serializable state
→ pending effect enters ready state
→ shell sends effect-started with ID + attempt
→ shell invokes one matching feature facade
→ facade returns typed domain outcome OR executor throws
→ shell sends effect-completed OR effect-execution-failed
→ campaign rejects stale/mismatched result or reduces it
→ shell derives next GameMode
→ stable state may autosave
```

Battle path:

```text
Narrative command requests battle
→ campaign validates encounter + session pack set + duel snapshot
→ selected-deck encounter emits resolve-deck effect
→ shell loads/validates exact selected revision; campaign rejects mismatch
→ campaign builds immutable battle request
→ campaign emits persist-checkpoint effect carrying stable pre-effect snapshot + battle continuation
→ SaveRepository atomically writes pre-battle checkpoint + interrupted-battle metadata
→ campaign stores returned checkpoint ref
→ campaign emits run-battle effect
→ shell mounts self-contained battle facade
→ current duel Worker/UI runs unchanged
→ facade maps DuelResult to normalized result and disposes
→ campaign routes resolved outcome through encounter definition
→ aborted/failed result stores recovery state
→ interrupted reload restores stable state + typed retry/return metadata
→ Return emits restore-checkpoint effect and loads exact checkpoint ref
→ durable post-result autosave may retire checkpoint
```

## Failure containment

- Domain parsers return typed boundary errors.
- Campaign effect failure does not mutate progression as success.
- Engine failure is never mapped to player loss.
- Missing compatible content blocks load and offers install/recovery.
- Service-worker update never reloads during battle, save write, pack activation, or unresolved effect.
- Current Worker timeout/replacement behavior remains authoritative for duel hangs.
