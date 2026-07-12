# Atomic Asset Snapshots

> Status: accepted

## Snapshot unit

Treat engine/core revision, BabelCDB catalog, CardScripts, Project Ignis strings, and image manifest as one immutable compatibility unit. Never silently update or activate only one part.

## Manifest

A versioned generated `manifest.json` records schema version, upstream commits/package integrity, artifact paths, byte lengths, SHA-256 hashes, generation time, and a snapshot ID derived from the complete manifest digest.

## Generation and activation

- Upstream inputs are pinned build-time sources, not runtime packages.
- Generate into staging, verify every artifact, then publish/activate atomically.
- Reject unsupported schema, missing/extra files, hash/length mismatches, and mixed revisions.
- Keep the previous known-good snapshot for rollback and safely clean abandoned staging data.
- A failed update cannot replace the active snapshot.

The implemented acquisition/verification details live in [`../../assets/asset-import-pipeline.md`](../../assets/asset-import-pipeline.md).
