# Testing Architecture

> Status: accepted

## Mandatory order

Build the programmed real-WASM headless integration suite before visual duel code. It must cover every supported action/prompt family and reach `MSG_WIN` using the two preset decks. Svelte, Phaser, and visual rendering begin only after this gate is green.

## Test layers

- **Pure unit:** binary readers, message fixtures, response bytes, contracts, projection invariants, deck/dependency resolution, opponent decisions, and presentation mappings.
- **Worker integration:** vendored real-WASM load, synchronous callbacks, fixed-seed traces, complete duels, and handle cleanup.
- **Asset/compatibility:** hashes/counts/coverage, required globals, script indexes, protocol constant classification, and active-deck dependencies.
- **Browser:** production static bundle at a non-root base, Worker/WASM paths, one-response prompts, image/back rendering and fallback, keyboard flow, result/restart, diagnostic download, loading/completion refresh, forced Worker timeout, mobile overflow/touch targets, reduced motion, and hidden-message inspection. The full flow runs in Chromium; startup smoke also runs in Firefox and WebKit.

## Regression and update rules

- Reproduce each bug with the smallest fixture or deterministic transcript before fixing it.
- Keep fixtures human-readable; never update traces merely to silence CI.
- Any engine/data update creates a new snapshot and runs all layers.
- Typecheck, lint, format, unit/component/real-WASM tests, asset verification, independently verified production packaging, reproducible-build comparison, and the browser matrix are release gates.
- CI regenerates the pinned asset snapshot and uploads traces/reports when a compatibility or browser gate fails.
