# ADR-085: Content module owns verified installation lifecycle

> Status: accepted; planned
> Decided: 2026-09-12
> Owners: content / shell / battle
> Amends: ADR-076 D1–D3 (content storage ownership and activation seam)
> Relates: ADR-022 (public boundaries), ADR-077 (runtime/catalog identity)
> Baseline: `36c6f41e35cca9a4d5ca21ae0de00d325736bbe9` — existing ContentManager/ContentReadPort/RuntimeActivationPort declarations only.

## Context

`src/content/contracts/` already defines manager, immutable reads and runtime activation port. No concrete installer exists. Cache Storage writes cannot share IndexedDB transaction. Existing Battle snapshot store requires legacy active-images receipt, which cannot be relabeled as runtime/catalog verification.

## Decision

D1. Content module owns manifests, downloads, staging, byte/hash verification, install receipts, active refs, invalidation and removal. Shell owns Svelte installer, routing and core-safe read-only save-ref adapter. Story owns save writes; Battle owns runtime validation and actual Worker initialization. Content never imports gameplay domains.

D2. `src/content/index.ts` remains content public entry. One narrow Battle validation sub-entry, `src/battle/content-activation.ts`, exports only `createRuntimeActivationPort`; this planned exception avoids importing BattleFacade during install verification. It never initializes Worker/core. Existing engine binary, loader resolution and vendor manifest remain frozen.

D3. Content DB `ygo-story-content` owns job/metadata/receipt/current records. Verified immutable Cache files precede one IndexedDB generation-CAS activation. Private job-scoped validation reader can inspect verified staging; public gameplay reads cannot. Failed CAS/quota/crash preserves previous active set; orphan preparation alone grants nothing.

D4. Battle DB `ygo-story-duel` version3 adds `installedRuntimeReceipts`, keyed by activationId. Tagged schema1 receipt kind `installed-runtime-v1` carries exact RuntimeSnapshotRef, runtime pack ref, raw-byte digest/length/path refs for runtime/asset/vendor manifests, verified timestamp. ActivationId remains SHA256 of UTF8 `JSON.stringify({runtimeSnapshotId,releaseCatalogSha256})` in that order, no LF. Old image receipts remain distinct. Worker validates exact receipt plus content receipts/actual files, never unrelated active/previous fallback.

D5. One Web Lock `ygo-content-installer-v1` serializes lifecycle mutation; hashing/network/extraction stay outside IndexedDB transactions. Reads rehash expected raw bytes. Error codes are fixed ContentFailure values, not unsafe remote bodies or input paths. Service Worker owns executable-shell caching only, never activation decisions.

## Consequences

C1. CORE can verify/install while gameplay stays unloaded. Cache and DB crash boundaries have explicit proof points rather than fictitious cross-storage atomicity.

C2. New tagged receipt store and public validation exception require intentional boundary/contract tests. Interrupted preparation may leave harmless storage until safe cleanup.

C3. Rehashing and staged immutable bytes consume CPU/storage. One installer mutation limits throughput but bounds race and quota behavior.

## Alternatives rejected

A1. Shell owns entire install engine: expands UI authority over download/storage lifecycle and duplicates reusable content contracts.

A2. Activate Cache writes progressively: partial chapter becomes visible before closure verifies.

A3. Reuse active-images receipt label: changes persisted evidence meaning without proving runtime/catalog pair.

A4. Import BattleFacade to validate runtime: loads gameplay UI unnecessarily and risks eager Worker creation.
