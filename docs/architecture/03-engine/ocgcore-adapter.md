# OcgCore Adapter

> Status: accepted

## Engine source

- Use Project Ignis `ygopro-core` through the synchronous build from `ocgcore-wasm@0.1.2`.
- Check the integrity-verified package into `vendor/ocgcore-wasm/0.1.2/`; do not resolve it from npm or floating Git during build/runtime.
- Record package URL, npm SHA-512, embedded core revision when discoverable, every file hash, and local patches.
- Any engine update requires the complete protocol and programmed real-WASM suite.

## Import boundary

A focused Worker-owned adapter is the only application module allowed to import the engine. Svelte, Phaser, stores, contracts, and policies depend only on domain types.

## Synchronous callback rule

`cardReader` and `scriptReader` read only preloaded Worker-owned maps. They never call `fetch`, IndexedDB, Cache Storage, or any async API. Missing data/script input is a fatal, structured compatibility error.

## Lifetime and failure behavior

- Validate exposed core version before duel creation.
- Wrap each raw handle in a single session owner.
- Destroy handles after completion, failure, partial initialization, surrender, and disposal.
- Bound initialization and processing with timeouts/iteration guards.
- Missing module/WASM reports `engine_initialization_failed`; unknown engine behavior includes diagnostic bytes/status.
