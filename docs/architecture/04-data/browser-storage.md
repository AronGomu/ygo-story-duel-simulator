# Browser Storage

> Status: accepted

## IndexedDB (`idb`)

Store snapshot metadata, active/previous snapshot pointers, preferences, and bounded debug-run metadata. Stage immutable snapshots under their IDs and switch the active pointer only after complete verification in a final transaction.

## Cache Storage

Store card images using snapshot/provider-aware namespaces. Image cache state cannot determine whether the engine/data snapshot is valid.

## Reliability rules

- Startup validates schema and revision compatibility.
- Interrupted staging leaves the previous snapshot active.
- Keep one previous known-good snapshot for rollback.
- Handle upgrades, abandoned staging, quota errors, and cleanup explicitly.
- Do not perform storage access from synchronous core callbacks.
- Diagnostics expose active/fallback snapshot IDs without leaking unnecessary hidden duel information.
