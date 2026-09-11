# Testing Architecture

> Status: accepted

## Mandatory order

The programmed real-WASM headless integration suite remains prerequisite for visual work. It covers every supported action/prompt family and reaches `MSG_WIN` using the two preset decks. DOM-field changes start with failing projection/interaction/component fixtures and must preserve this gate.

## Test layers

- **Pure unit:** binary readers, message fixtures, response bytes, contracts, fixed-slot projection invariants, physical-zone/board mappings, interaction spec/session/navigation reducers, deck/dependency resolution, opponent decisions, and presentation mappings.
- **Worker integration:** vendored real-WASM load, synchronous callbacks, fixed-seed traces, complete duels, and handle cleanup.
- **Asset/compatibility:** hashes/counts/coverage, required globals, script indexes, protocol constants, active-deck dependencies, deterministic bundle/publication/install contracts, cross-origin immutable content transport and frozen core staging. Small handoff fixture runs on Ubuntu/Windows/macOS and asserts common snapshot/ZIP hashes; >4 GiB/memory proof stays explicit opt-in.
- **Component/browser:** role/name/state field controls, pointer/keyboard equivalence, focus return, explicit confirmation, production static bundle at a non-root base, Worker/WASM paths, one-response prompts, nonblocking image/back fallback, result/restart, diagnostic download, loading/completion refresh, forced Worker timeout, responsive overflow/touch targets, reduced motion, resource disposal, performance/resource budgets, and hidden-message inspection. **Product browser gate:** full flow on Chromium (PWA-capable engine family). Firefox/WebKit startup smoke is optional hygiene, not field acceptance.

## Regression and update rules

- Reproduce each bug with the smallest fixture or deterministic transcript before fixing it.
- Keep fixtures human-readable; never update traces merely to silence CI.
- Any engine/data update creates a new snapshot and runs all layers.
- Typecheck, lint, format, unit/component/real-WASM tests, asset verification, independently verified production packaging, reproducible-build comparison, and the browser matrix are release gates.
- CI regenerates the pinned asset snapshot and uploads traces/reports when a compatibility or browser gate fails.
- DF-16 records machine-readable Chromium parity/perf/resource evidence in `test-results/df-16-results.json` and the acceptance baseline in `docs/architecture/05-presentation/duel-field-performance-baseline.md`.
