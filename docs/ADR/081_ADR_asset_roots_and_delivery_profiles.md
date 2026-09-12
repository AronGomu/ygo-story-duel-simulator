# ADR-081: Asset ownership roots and delivery profiles

> Status: accepted; planned
> Decided: 2026-09-09
> Owners: asset tooling / shell / battle / deck-editor / story
> Baseline: `3fa800c` — source baseline, not implementation evidence.
> Amends: ADR-022 dependency-direction shared-directory prohibition for asset-only storage; code ownership rules unchanged.
> Relates: ADR-075 (core versus downloadable content), ADR-082 (publication identities)

## Context

Current source assets span generated data/runtime/card/set paths, public fonts and story assets. Dev bootstrap needs every local asset, including unused originals and unreleased content, while player delivery distinguishes PWA core, shared runtime and chapter media. Domain ownership and release channels answer different questions. Moving files between nightly/prod directories changes references without changing their identity.

Existing card-art paths are computed from card IDs rather than enumerated literal source imports (`src/decks/catalog/runtime-catalog.ts`). Source-text scanning therefore cannot prove complete asset use. Existing Vite adapter already translates physical sources into stable browser URLs (`scripts/lib/vite-runtime-assets.ts`).

## Decision

D1. Four managed downloadable asset roots own bytes: `assets/battle/`, `assets/deck-editor/`, `assets/story/`, `assets/shared/`. Shared root contains asset bytes, not generic application modules. Existing public-entry/import boundaries remain. Frozen `vendor/ocgcore-wasm/0.1.2/` remains tracked, unmoved and authoritative.

D2. Tracked `asset-profiles/` declarations map exact files or recursive directory prefixes into `core`, `runtime` or chapter delivery. Nightly selects profiles, not a separate copy of asset files. Undeclared files are dev-only. Core is delivery category; nightly/versioned release is publication identity.

D3. Dev ZIP recursively includes all regular asset files within four roots, irrespective of Git ignore status or gameplay references. Credentials, unsafe paths, links and unrelated dependencies are rejected, not accidentally published. Public dev archives intentionally expose eligible unused/unreleased/original content.

D4. Promotion changes profile declarations only. Exact-file selection freezes named membership; directory rules automatically include new matching files. One maintained source-to-logical-path map serves generation, packaging, serving and checks. Browser URLs remain stable through physical-root migration.

D5. Profile/reference checks belong development. Producer selects actual files, freezes paths/hashes and enforces structural/transport safety; it does not decode media, infer card legality, scan source reachability or repin upstream locks. Missing optional media does not become fabricated content or proof of gameplay readiness.

D6. Player packs retain explicit runtime/chapter dependency ownership. Shared bytes belong one delivery owner; dependants reuse references. Core assets remain in PWA shell, outside manually downloaded player ZIPs. Immutable release inventory freezes exact membership/bytes/profile rules without moving working files.

## Consequences

C1. New directory-matched assets synchronize automatically; exact-file declarations still need explicit promotion. Files accidentally outside roots or in wrong profile can remain missing from player delivery. Development checks detect declared-path mistakes, not every dynamic runtime reference.

C2. Four-root migration touches acquisition, validators, Vite mappings and tests. A compatibility copy forest is rejected; user originals must be preserved during migration. Core ownership/profile metadata remains maintenance work.

C3. Dev archives may be much larger than player packs and expose spoilers/source artwork by design. ZIP integrity cannot certify media correctness, complete upstream availability or lawful redistribution. Existing eligibility controls remain separate.

## Alternatives rejected

A1. `assets/core/`, `assets/prod/`, `assets/nightly/`: mixes delivery role with channel, duplicates shared bytes, obscures domain ownership.

A2. Per-domain `prod/` folders: manual moves break paths and do not express chapter/core distinctions.

A3. Infer used files by grepping imports: misses computed card/media paths and makes unused dev assets disappear.

A4. Exhaustive handwritten filename lists only: every added asset requires synchronization edits; directory rules provide deterministic discovery where intended.

A5. Generic `src/shared/` module bucket: weakens explicit authority and existing boundary enforcement; sharing bytes does not require shared business logic.
