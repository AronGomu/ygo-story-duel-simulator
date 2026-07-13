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

The implemented acquisition/verification details live in [`../../assets/asset-import-pipeline.md`](../../assets/asset-import-pipeline.md).
