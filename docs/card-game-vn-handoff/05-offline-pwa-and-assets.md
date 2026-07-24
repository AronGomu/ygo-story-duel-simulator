# Offline PWA and Content Delivery

> Status: approved future design; not implemented  
> Distribution: private-only until current licensing and artwork gates are cleared

## Delivery model

One installable static PWA with two independently versioned layers:

1. **App shell** — JS/CSS/HTML/service worker and built-in UI assets.
2. **Game content** — existing atomic duel snapshot plus separate story/media pack sets.

```text
Private install
→ App shell precached
→ Bundled bootstrap + prologue pack bytes verified
→ Prologue pack set activated
→ New Game available offline
→ Later chapter packs download on demand/background
→ App update activates only at safe boundary
```

## Ownership

### Service Worker owns

- app-shell precache generated from Vite build;
- navigation fallback for SPA entry;
- offline startup of current shell;
- app-version download and readiness signaling;
- activation after app confirmation.

### ContentManager owns

- story/media pack manifests and bytes;
- download, resume, priority, concurrency, and progress;
- length and SHA-256 verification;
- dependency and compatibility validation;
- immutable staging;
- atomic installation-global default/fallback pack-set pointers;
- per-campaign pinned session pack-set compatibility;
- quota checks, removal, rollback, and garbage collection;
- content cache namespaces.

### Battle subsystem owns

- current atomic engine/catalog/scripts/strings/image-manifest snapshot;
- verified runtime closure and active-image caches;
- active/fallback duel snapshot pointers;
- existing Worker runtime resolution.

No layer may silently activate a partial duel snapshot or mixed story pack set. SaveRepository reads save bytes only; shell asks ContentManager `checkInstalled` to validate saved session pack set against battle readiness snapshot + runtime capabilities before campaign load.

## PWA implementation

Use `vite-plugin-pwa` in `injectManifest` mode.

Project-owned typed service worker implements:

- versioned shell precache;
- root/non-root base-safe navigation fallback;
- offline startup;
- install/activate lifecycle;
- waiting-update notification;
- explicit skip-waiting message only after all controlled clients report safe state;
- current + previous shell cache retention while any previous-build client remains open;
- old shell cache cleanup only after no controlled client uses previous build.

Do not let Workbox runtime rules become source of truth for content-pack activation.

## App update flow

```text
Service Worker downloads new shell
→ update coordinator reports downloaded version to every client
→ each controlled client reports safe/unsafe state
→ requesting shell waits until all clients safe or user closes blockers
→ UI prompts user
→ app writes safe save/checkpoint
→ user confirms
→ app asks waiting Worker to activate
→ page reloads
→ new app validates session/default pack sets + duel snapshot compatibility
→ previous shell cache remains while old-build clients exist
→ fallback/recovery shown on incompatibility
```

Unsafe activation states:

- active battle;
- pending campaign effect;
- save transaction;
- content pack staging/activation;
- snapshot activation;
- unrecoverable transient UI state.

No immediate forced reload. If user declines or another tab is unsafe, old shell continues until later safe boundary or next launch. A second tab in battle blocks activation; single-tab safety is insufficient. Prepare-update uses versioned client safety heartbeat plus short lease. Lease atomically freezes each client's synchronous operation gate; battle, save, content staging/activation, duel snapshot activation, new campaign effect, and declared transient-UI starts fail to acquire permits until activation aborts or reload completes. Service Worker then performs final update-version/client-set/nonce CAS.

## Existing duel snapshot compatibility

Engine/core revision, BabelCDB catalog, CardScripts, Project Ignis strings, and image manifest remain one immutable duel snapshot.

Story/media pack manifest declares:

- compatible app schema/version range;
- content schema version;
- compatible duel snapshot ID/range when encounters or card-specific content depend on it;
- dependencies on other story/media packs;
- campaign ID/version;
- required runtime capability IDs actually used by commands/operators/media;
- every file path, byte length, media type, and SHA-256.

Pack activation rejects recognized-but-unimplemented command capabilities; schema recognition alone is not runtime support. Runtime capability snapshot includes app semantic version + app schema version for manifest range checks. Shell composes remaining capability sets from narrative, condition, battle, and deck public exports. ContentManager passes bounded reader over exact staged bytes into injected content-owned validation port composed from campaign/narrative/map/encounter pure public validators; only returned immutable validated indexes commit and later load by exact PackSetRef. ContentManager never deep-imports feature implementations. Content cannot self-assert runtime support.

Card-art-only delivery may be stored separately, but any manifest used by battle must retain existing atomic activation guarantees.

## Pack structure

```text
packs/<pack-id>/<version>/
├── manifest.json
├── campaign/
├── scenes/
├── maps/
├── encounters/
├── characters/
├── backgrounds/
├── sprites/
├── audio/
└── other-media/
```

Manifest identity is content-addressed from canonical manifest bytes. Files are immutable under pack ID/version/digest.

Example logical groups:

```text
bootstrap
prologue
chapter-01
chapter-02
characters-main
audio-common
```

Do not create independent rules/card-script packs that bypass atomic duel snapshot.

## Installation and activation

```text
Resolve requested pack set
→ fetch/read manifests
→ validate schema and signatures/digests policy
→ compute dependency closure
→ check app + duel-snapshot compatibility
→ check storage estimate/quota
→ stage immutable bytes
→ verify every length + SHA-256
→ validate JSON content and cross-pack references
→ record staged receipts
→ if install-only: commit installed set without pointer change
→ if activate-default: compare expected default-active ID + generation
→ atomically switch installation-global default pointer
→ retain previous compatible fallback set
→ expose selected/default set to caller
```

- ContentManager owns installed sets plus installation-global `defaultActive` and `fallback` pointers.
- Missing dependency for saved/running campaign uses install-only; after commit `checkInstalled` validates pinned set and New Game default remains unchanged.
- Bootstrap/prologue or explicit app content update may use activate-default with CAS.
- New campaign copies default into `CampaignState.sessionPackSet`.
- Loaded campaign restores its pinned session set after compatibility/install checks.
- Running campaign never changes session set because global default updates.
- Explicit compatible migration may switch session set only at stable load boundary through campaign-owned pure migration planner; migrated campaign state + target pack ref commit together in new save revision.
- AssetResolver always receives explicit session/default `PackSetRef`; it never consults hidden mutable global state.
- Activation uses cross-tab lock and expected default-active ID + generation carried by staged receipt.
- Rollback also requires expected ID + generation.
- Stale tab cannot reactivate older set.
- Network, cancellation, quota, verification, incompatibility, and activation conflict are typed normal install results; unexpected thrown faults remain executor failures.
- Failed staging cannot replace default set.
- Each running tab acquires unique expiring runtime pack lease with content-owned client/owner IDs; shell maps app IDs at boundary, heartbeat extends it, normal close releases it.
- Two tabs loading same save hold independent leases; one tab closing cannot remove other tab protection.
- Save envelopes are atomic retention source; SaveRepository exposes committed pack refs without duplicate retention record.
- Save write/delete/migrate, runtime lease mutation/expiry, default/fallback activation/rollback, manual pack removal, and GC use same cross-tab exclusive retention lock; removal/GC rescan all sources under lock through deletion and return protected/conflict instead of deleting referenced pack.
- Garbage collection retains default, fallback, every live runtime lease, and every pack set reported by retained-save source.

## First vertical slice packaging

Release includes immutable bootstrap + prologue pack bytes outside JS chunks. First run:

1. reads local packaged bytes;
2. stages through normal ContentManager path;
3. verifies hashes/content/dependencies;
4. atomically activates prologue set;
5. enables New Game.

No network or downloader UI is required for first play. This still proves real pack format, validation, storage, activation, rollback, and AssetResolver behavior.

## Later progressive download scheduling

Priority:

1. blocking asset requested by current stable transition;
2. required current scene/map/encounter dependencies;
3. current chapter remainder;
4. next expected chapter;
5. optional audio/high-resolution media;
6. remaining campaign content.

Rules:

- bounded global concurrency;
- per-host rate limits when required;
- blocking queue preempts background queue;
- duplicate file requests coalesce;
- bounded exponential retry only for idempotent transient transfer failure;
- cancellation preserves verified completed chunks/files;
- HTTP Range resume when server supports stable range semantics;
- otherwise restart individual incomplete file, never trust partial bytes;
- final file enters staged pack only after full length + SHA-256 match.

Exact concurrency and retry counts are implementation config, covered by tests; content cannot override safety caps.

## Progress model

Expose separate progress:

- playable bootstrap/prologue;
- current required pack set;
- background campaign installation;
- full optional installation.

Progress uses verified bytes, not requested bytes. UI distinguishes queued, downloading, verifying, validating, staged, active, failed, paused, and quota-blocked.

## Storage

### IndexedDB

Store:

- pack manifests and receipts;
- staged/default-active/fallback pack-set pointers + generations;
- unique expiring per-tab runtime pack leases used by cleanup;
- retained save envelopes themselves provide save pack-set references; no duplicate retained-save index;
- download checkpoints;
- save and deck records in their owned repositories;
- app update metadata when needed.

### Cache Storage

Store immutable pack files under digest/revision-aware namespaces. Cache entry is not active merely because bytes exist.

### OPFS

Deferred. Introduce only when measured archive/file-count behavior proves Cache Storage inadequate. Migration must preserve receipts and rollback.

## AssetResolver

AssetResolver maps logical `AssetId` against pinned active `PackSetRef`.

- No network/download side effect.
- Missing asset returns typed error with pack + asset context.
- Returned handle includes pack revision and disposable URL.
- Concurrent resolution may share underlying bytes while retaining ref-counted disposal.
- Stale pack-set handles remain valid until released, then become eligible for cleanup.
- Deterministic placeholders/fallbacks are feature policy, not resolver mutation.

## Quota and cleanup

Before staging:

- call storage estimate;
- include staging overhead and retained fallback;
- refuse unsafe install with required/free byte summary;
- offer removal only for packs not referenced by default/fallback, running sessions, or saves;
- never evict current duel runtime, campaign session pack set, default/fallback set, or required save dependency silently.

Quota failure leaves current set active.

## Offline behavior matrix

| State | Required behavior |
|---|---|
| Fresh private install with bundled prologue | Complete first slice works offline after activation |
| Offline with active compatible set | Continue/load compatible saves |
| Offline with missing save dependency | Explain missing pack; do not corrupt/migrate save |
| Interrupted staging | Keep previous set active; resume or discard staged work |
| New shell downloaded during battle | Wait; no reload or activation |
| Image/media decode failure | Use typed feature fallback; retain diagnostic context |
| Corrupt cached file | Evict invalid entry; recover from packaged/network source when available |

## Distribution gate

Keep current private-build enforcement:

- ordinary public production build remains rejected while redistribution is unapproved;
- private artifact includes private-deployment marker;
- service-worker/PWA metadata must not imply public distribution permission;
- source-availability and provenance artifacts remain packaged as currently required;
- public mode requires separate legal/distribution decision and manifest policy change.
