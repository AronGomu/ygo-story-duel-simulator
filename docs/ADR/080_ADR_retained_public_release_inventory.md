# ADR-080: Retain immutable content in every static public release

> Status: accepted; planned
> Decided: 2026-09-07
> Owners: release / governance
> Relates: ADR-075 (static delivery), ADR-076 (saved exact refs)
> Amended by [ADR-082](082_ADR_r2_nightly_and_immutable_asset_releases.md): D1/D2 and A4 now use R2 release retention with 24-hour superseded-nightly grace; Pages serves core only; D3 eligibility remains.
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.

## Context

Exact saved refs must remain reinstallable after local media removal. Static hosting cannot be assumed to retain old production paths across deployments. Public URLs are not redistribution permission. Chosen host is Cloudflare Pages Free with no Functions or paid fallback.

## Decision

D1. Each candidate includes every published immutable catalog/manifest/ZIP object from verified prior inventory. Prior inventory digest is pinned separately; missing/tampered history blocks publication. Explicit first-release bootstrap is not inferred from HTTP 404.

D2. Final merged site enforces Pages Free file-count/file-size constraints, plus tighter 20 MiB ZIP cap. Limit breach blocks release rather than deleting old versions or moving to paid storage.

D3. Real publication requires recorded source/license/art/media eligibility, protected manual workflow and explicit human authorization. ZIP separation never bypasses existing redistribution gate.

D4. Predeploy gates validate lawful candidate/permissions/config and test access. Native hosted release acceptance follows authorized deployment; untested release is not claimed accepted. No circular requirement for postdeploy proof before first deploy.

## Consequences

C1. Old compatible saved content remains reinstallable; public readiness is evidence-backed, not inferred.

C2. Storage/file counts grow monotonically. A future retention-policy change needs explicit decision. Rights or history gaps can block publishing indefinitely.

## Alternatives rejected

A1. Keep latest artifacts only: old saves can lose reinstall paths.

A2. Trust CI cache as permanent archive: eviction/history gaps silently erase content.

A3. Public availability implies permission: false; source availability says nothing about grants.

A4. R2/Functions/paid overage: outside chosen free static-only constraint.
