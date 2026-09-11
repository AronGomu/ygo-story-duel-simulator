# Atomic Asset Snapshots

> Status: accepted

## Snapshot unit

Treat engine/core revision, BabelCDB catalog, CardScripts, Project Ignis strings, and image manifest as one immutable compatibility unit. Never silently update or activate only one part.

## Manifest

A versioned generated `manifest.json` records schema version, upstream commits/package integrity, artifact paths, byte lengths, SHA-256 hashes, generation time, and a runtime snapshot ID. Browser persistence uses a separate activation ID derived from the runtime snapshot ID plus the active-image manifest digest, so an image-only release cannot collide with an existing stored revision.

## Generation and activation

- Upstream inputs are pinned build-time sources, not runtime packages.
- Generate into staging, verify every artifact receipt, then publish/activate with an IndexedDB compare-and-swap transaction.
- Reject unsupported schema, missing/extra files, hash/length mismatches, and mixed revisions.
- The static browser package includes the trusted full root manifest but only the recursively resolved active-deck runtime closure; production verification rejects missing, extra, or modified packaged files.
- Keep the previous known-good snapshot and verified runtime cache for rollback, and safely clean abandoned staging/cache data.
- A failed or mixed-revision update cannot replace the active snapshot; startup may use the last verified cached runtime without activating the failed candidate.

## Delivery boundary

- Deterministic bundle snapshots expose separate dev, prod inventory, core and immutable content-index refs.
- R2 `channels/index.json` is the only mutable publication point; release pointers and content objects remain immutable/hash-addressed.
- Anonymous developer bootstrap verifies and installs the dev archive. Local edits block replacement; removed managed files require explicit hash-safe prune.
- `stageCoreAssets` fetches exact published prod inventory/core bytes into a hash-addressed CoreCopyPlan. Planned PWA builds consume that plan plus the same snapshot's index; current workspace files are never fallback input.
- Browser network URLs use injected `__CONTENT_BASE_URL__`/`__CONTENT_INDEX_SHA256__`; Cache Storage synthetic keys and installed/save refs remain same-origin and unchanged. Native installer activation remains planned.

Implemented acquisition/verification details live in [`../../assets/asset-import-pipeline.md`](../../assets/asset-import-pipeline.md). Delivery commands and limits live in [`../../assets/asset-delivery-bundles.md`](../../assets/asset-delivery-bundles.md).
