# Testing Architecture

> Status: accepted

## Mandatory order

Build the programmed real-WASM headless integration suite before visual duel code. It must cover every supported action/prompt family and reach `MSG_WIN` using the two preset decks. Svelte, Phaser, and visual rendering begin only after this gate is green.

## Test layers

- **Pure unit:** binary readers, message fixtures, response bytes, contracts, projection invariants, deck/dependency resolution, opponent decisions, and presentation mappings.
- **Worker integration:** vendored real-WASM load, synchronous callbacks, fixed-seed traces, complete duels, and handle cleanup.
- **Asset/compatibility:** hashes/counts/coverage, required globals, script indexes, protocol constant classification, and active-deck dependencies.
- **Browser:** production static bundle, Worker/WASM paths, one-response prompts, image/back rendering, keyboard flow, result/restart, and diagnostics.

## Regression and update rules

- Reproduce each bug with the smallest fixture or deterministic transcript before fixing it.
- Keep fixtures human-readable; never update traces merely to silence CI.
- Any engine/data update creates a new snapshot and runs all layers.
- Typecheck, lint, format, tests, asset verification, and production build are release gates.
