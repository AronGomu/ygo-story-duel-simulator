# ADR-077: Runtime activation binds catalog, not chapter artwork

> Status: accepted; planned
> Amended by [ADR-086](086_ADR_installed_chapters_own_gameplay_catalog.md) D1–D4: runtime support remains whole; gameplay requires complete verified chapter data/media and never unlocks from runtime alone.
> Decided: 2026-09-07
> Owners: battle / content
> Relates: ADR-043 (whole runtime catalog)
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.

## Context

Existing snapshot receipts pair runtime-package with active-images. Whole-manifest art preload caps at 500 images. That coupling prevents full-catalog default-AI play while optional chapter art is absent. Baseline source: src/battle/storage/snapshot-store.ts and src/battle/app/images/card-image-cache.ts.

## Decision

D1. New PWA activation receipts pair runtime-package digest with release-catalog digest. Activation identity hashes UTF-8 JSON.stringify({runtimeSnapshotId,releaseCatalogSha256}) in that exact field order, without trailing LF.

D2. Persisted format explicitly distinguishes legacy art-backed receipts from new catalog-backed receipts. Existing receipt meaning never changes by relabeling.

D3. Main thread passes exact RuntimeSnapshotRef through facade/client initialize command. Worker loads only that verified installed runtime; unrelated active/previous cache is not fallback for a pinned request.

D4. Frozen engine, scripts, strings and catalog remain one verified runtime closure. Main thread never calls core. Default-AI readiness needs runtime, not images.

## Consequences

C1. Entire supported catalog becomes playable with placeholders after runtime installation.

C2. Migration and ready-event identities need explicit compatibility handling; old receipt cannot prove new catalog. Staging consumes temporary storage.

## Alternatives rejected

A1. Require every image before runtime activation: makes presentation dictate rules availability.

A2. Split runtime/card scripts by chapter: risks engine/catalog skew and complicates callback preload.

A3. Reuse old receipt label with new meaning: silently blesses unverified persisted data.
