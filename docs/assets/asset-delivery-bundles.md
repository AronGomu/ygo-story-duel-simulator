# Deterministic local asset bundles

Producer implementation: `scripts/lib/asset-delivery/bundle.ts` (`bundleAssets`). No publisher, installer, network acquisition, engine update, image decoder, gameplay/source-readiness gate runs here. Existing private Vite build stays separate.

## Commands

| ID | Command | Observable result |
| --- | --- | --- |
| C1 | `npm run assets:bundle -- --target dev` | Complete safe four-root originals ZIP; no player prerequisites. |
| C2 | `npm run content:catalog` | Explicit authoring preparation at `generated/asset-delivery/prepared-player.json`. |
| C3 | `npm run assets:bundle -- --target all --empty-history` | Offline first-release candidate: dev, core, runtime, chapter-01 objects. Requires prepared metadata. |
| C4 | `npm run content:pack -- --retained-metadata generated/asset-delivery/retained/metadata.json` | Same producer, prod target; exact explicit history. |
| C5 | `npm run content:verify` | Read-only current candidate schema/hash/closure/streamed archive verification. `--run generated/asset-delivery/runs/<uuid>` checks another completed candidate. |

All commands accept `--help`. `--version <package-version>` selects release-candidate intent; it must match `package.json`. Channel/version identity beyond appVersion is operational, not hashed. JSON final stdout follows `AssetResult`; stderr contains JSON phase/path/byte progress. Expected failures exit 2; unexpected internal faults exit 1.

## Local object layout

Each run owns `generated/asset-delivery/runs/<uuid>/`. `objects/<ObjectRef.key>` contains canonical immutable JSON/ZIP bytes. `frozen/<sha256-of-source-path>` contains independent input copies, never hardlinks; short private names preserve the full 512-byte source/ZIP path budget. `candidate.json` pins snapshot bytes; `omissions.json` records missing optional references outside canonical hashes. `generated/asset-delivery/current.json` changes only after complete candidate verification. Failed runs remain private, never activate, never delete originals.

File membership ignores Git status. Dev includes every extant safe regular file under `assets/battle`, `assets/deck-editor`, `assets/story`, `assets/shared`. Missing declared optional media is diagnosed, not fabricated. Malformed paths/profiles, symlinks, credential names, collisions, source mutation remain errors. Old `generated/assets`, `generated/runtime`, image archives are never source fallbacks.

Dev/core archives use pinned `@zip.js/zip.js` 2.13.1, sequential STORE, UTF-8 names, raw DOS timestamp `0x00210000`, no variable permissions/comments/timestamp extras. Required ZIP64 fields only. Dev limit: 16 GiB compressed/inflated, 100,000 entries, 512 UTF-8 path bytes, 32 MiB metadata. Player parts remain non-ZIP64, at most 20 MiB ZIP / 32 MiB inflated / 16 MiB per file / 2,048 entries. No JS/HTML file types. Byte-validity is not decoded-media validity.

## Prepared player metadata

`content:catalog` explicitly reads chapter selection, pinned source export, chapter policy, tracked shop map, canonical runtime manifest/catalog. It records exact source digests. Shop set IDs come only from exact name→ID records; duplicate card membership does not merge sets. Unmapped/ambiguous set names fail; no slug inference or art-derived grants. Runtime support gaps are preparation diagnostics, not bundler dependencies. Chapter policy bytes inside chapter ZIP are derived solely from frozen prepared set/card/opponent IDs.

Current tracked 50-set shop map does not represent every owner-selected Chapter 1 set. Real preparation therefore reports `CONTENT_SOURCE_GAP` progress plus `ASSET_REFERENCE_MISSING`; this producer does not invent missing policy IDs. Tests use explicit, structurally complete fixtures. Passing bundle verification does not certify gameplay readiness or publication rights.

## Integration seams

| ID | Consumer | Exact handoff |
| --- | --- | --- |
| S1 | Future publisher | Acquire common local lock once; call private `bundleAlreadyLocked` in `bundle-locked.ts`. It returns `{run,snapshot,snapshotRef}`. Hold run ownership through upload. Optional `retainedObjects` is repository-relative explicit history staging. Public `bundleAssets` acquires/releases itself; never call it while already locked. |
| S2 | Retained history | Public/CLI source: `generated/asset-delivery/retained/objects/<ObjectRef.key>`. Explicit RetainedMetadata lists drive traversal. Every referenced catalog, manifest, part must exist with exact bytes/hash; no object-existence inference, remote lookup, or workspace fallback. Future publisher materializes verified history before calling private seam. |
| S3 | Future dev installer | `DevManifest.inventory`, `.archive`, `.files` match exact frozen inventory/archive file set. ZIP64 dev archive is Node-only; never feed browser installer. |
| S4 | Core staging/build | `stageCoreAssets(root, snapshot)` anonymously fetches exact `snapshot.prod.inventory`/`.core`, verifies CoreManifest/archive/files, then writes hash-addressed staged bytes plus CoreCopyPlan under `generated/asset-delivery/core/<core-manifest-sha>/`. No workspace reread fallback. Future `build:pwa` consumes this plan. |
| S5 | Browser receiver | `src/content/index.ts` exports pure parsers/constants, type-only accepted contracts/ports and `contentObjectUrl`. `ContentReadPort.readCatalog` uses `content/catalogs/<sha>.json`; startup uses `content/indexes/<sha>.json`; both contain identical canonical ContentIndex bytes. Vite injects `__CONTENT_BASE_URL__` plus `__CONTENT_INDEX_SHA256__`; current private build leaves both empty and still has no content installer. |

ContentIndex `releaseId` is `appVersion + "+" + frozenInventorySha256`. Snapshot closure includes distinct index/catalog role keys, inventories, core/dev objects, retained catalogs/manifests/parts. Snapshot excludes its own ref. Retained prod targets keep their own inventory/core refs when a future publisher combines targets. Browser synthetic Cache Storage keys remain same-origin; external URL resolver changes network transport only.

## Validation

V1. `node --test tests/asset-delivery-contracts.test.ts tests/asset-delivery-profiles.test.ts tests/asset-delivery-bundle.test.ts tests/asset-delivery-publish.test.ts tests/asset-delivery-install.test.ts tests/asset-delivery-handoff.test.ts` checks canonical determinism, profile/publication/install lifecycle, cross-origin content transport, frozen core staging, release-A retained refs and isolated conflict/prune behavior.

V2. CI runs `tests/asset-delivery-handoff.test.ts` on Node 24 across Ubuntu, Windows and macOS. Same fixture asserts pinned snapshot/dev/core archive hashes, so per-platform repeatability alone cannot pass.

V3. Large-file proof is owner-run, not inferred from synthetic ZIP64 headers. On an approved disk with a new destination:

```sh
node tests/fixtures/asset-delivery-large.ts --directory /approved-disk/new-fixture --bytes 4294967297
```

Use `--bytes 10737418240` for 10 GiB. Fixture writes real deterministic bytes, bundles twice across TZ/channel changes, streams verification, prints peak RSS/disk requirement/archive hashes. Requires 5× input bytes + 512 MiB free (50.5 GiB for 10 GiB input); retains both runs. This fixture's existence is not evidence it was executed. Windows/macOS filesystem portability and real >4 GiB proof require separate captured runs.
