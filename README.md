# YGO Story Duel Simulator

Browser-first, offline Yu-Gi-Oh! duel simulator built around Project Ignis `ygopro-core` through `ocgcore-wasm`.

The MVP launches directly into a normal duel between one human player and a basic computer opponent. Both sides use bundled preset decks; production games shuffle the decks and draw randomized starting hands normally. The opponent uses only simple, straightforward cards and shallow legal-action priorities rather than strategic combo planning.

Development is headless-first. Programmed real-WASM integration scenarios must cover every supported game-action family before Svelte, Phaser, or other visual duel-simulator work begins. The target architecture requires `ocgcore-wasm@0.1.2` to be vendored and integrity-verified.

> **Current status:** headless Checkpoint C is green locally. Six persisted real-WASM scenarios replay deterministically without human fallback, all 45 supported action/prompt rows have executed evidence, production core shuffling produces varied hands, and lifecycle cleanup is pinned. The playable browser UI remains intentionally unimplemented pending clean-checkout gate acceptance and Step 19.

## Included asset pipeline

The existing tooling acquires and verifies:

- the pinned synchronous `ocgcore-wasm@0.1.2` package;
- the current standard-format BabelCDB card catalog and text;
- official, prerelease, and global Project Ignis CardScripts;
- Project Ignis English system strings;
- full-card JPEGs available from the configured image provider;
- manifests, hashes, coverage reports, and readiness status.

Generated data, downloaded images, caches, and `node_modules/` are intentionally excluded from Git.

## Requirements

- [Node.js](https://nodejs.org/) 24 or newer
- [Git](https://git-scm.com/)
- npm, included with Node.js
- Network access for the initial asset download
- Approximately 2.5 GB of free disk space for the current image archive

## Setup

```bash
git clone git@github.com:AronGomu/ygo-story-duel-simulator.git
cd ygo-story-duel-simulator
npm ci
npm run assets:mvp
npm test
npm run typecheck
```

`npm run assets:mvp` is resumable. Existing Git caches and valid JPEGs are reused, so rerun the same command after a temporary network failure.

There is no `dev` or `build` command yet because the browser application is intentionally blocked behind the headless integration-test milestone.

## Quick asset launchers

### Windows

```powershell
.\download-mvp-assets.cmd
```

### macOS and Linux

```bash
./download-mvp-assets.sh
```

Both launchers accept the same options as `npm run assets:mvp` and can be launched from outside the repository because they set their own working directory.

## npm commands

| Command | Description |
|---|---|
| `npm ci` | Install the exact development dependencies from `package-lock.json`. |
| `npm run assets:mvp` | Download, generate, and verify all currently supported external MVP assets. |
| `npm run assets:engine` | Download, integrity-check, extract, and publish the pinned engine package. |
| `npm run assets:engine:verify` | Verify the extracted engine package and WASM header. |
| `npm run assets:sync` | Fetch Project Ignis sources and regenerate catalog, text, scripts, strings, and image manifests. |
| `npm run assets:sync:offline` | Regenerate data from the existing local Git source caches without fetching. |
| `npm run assets:verify` | Verify generated data manifests, hashes, counts, shards, and coverage. |
| `npm run assets:images` | Download or resume the full-card JPEG archive. |
| `npm run assets:images:verify` | Verify image coverage, report consistency, sizes, and JPEG boundaries. |
| `npm test` | Run the legacy, Vitest unit, and real-WASM integration suites. |
| `npm run test:unit` | Run the focused Vitest unit suite. |
| `npm run test:integration` | Run real asset/WASM integration tests. |
| `npm run lint` | Run ESLint. |
| `npm run format:check` | Verify Prettier formatting. |
| `npm run typecheck` | Run strict TypeScript checking without emitting files. |
| `npm run vendor:verify` | Verify every vendored engine file against its reviewed manifest. |
| `npm run snapshot:verify` | Verify the generated runtime snapshot files and digests. |
| `npm run check:headless` | Run the complete mandatory local headless quality gate. |

To display the unified downloader help:

```bash
npm run assets:mvp -- --help
```

## Unified asset command options

```bash
npm run assets:mvp -- [options]
```

| Option | Description |
|---|---|
| `--offline` | Regenerate and verify using existing Git and image caches without network access. |
| `--force-images` | Redownload images even when a valid cached JPEG exists. |
| `--concurrency <count>` | Set simultaneous image workers; default is `18`. |
| `--requests-per-second <count>` | Set the image request rate; default is `18`, maximum is `20`. |
| `-h`, `--help` | Print command usage. |

Examples:

```bash
npm run assets:mvp -- --offline
npm run assets:mvp -- --concurrency 8 --requests-per-second 12
npm run assets:mvp -- --force-images
```

The Windows and Unix launchers accept the same arguments:

```powershell
.\download-mvp-assets.cmd --offline
.\download-mvp-assets.cmd --concurrency 8 --requests-per-second 12
```

```bash
./download-mvp-assets.sh --offline
./download-mvp-assets.sh --concurrency 8 --requests-per-second 12
```

## Lower-level command lines

Use these commands for diagnosis, custom output directories, pinned source revisions, or partial maintenance. Prefer `npm run assets:mvp` for normal setup.

### Engine acquisition

```bash
node scripts/sync-engine.ts
node scripts/sync-engine.ts --offline
node scripts/verify-engine.ts
```

### Catalog, scripts, strings, and image manifests

```bash
node scripts/sync-assets.ts [options]
```

| Option | Default | Description |
|---|---:|---|
| `--offline` | disabled | Use existing source repositories without fetching. |
| `--cache-dir <directory>` | `.cache/upstream` | Set the Git source cache directory inside the project. |
| `--output <directory>` | `generated/assets/current` | Set the generated snapshot output directory. |
| `--babel-ref <ref>` | `master` | Pin a BabelCDB branch, tag, or commit. |
| `--scripts-ref <ref>` | `master` | Pin a CardScripts branch, tag, or commit. |
| `--distribution-ref <ref>` | `master` | Pin a Project Ignis Distribution branch, tag, or commit. |

Example:

```bash
node scripts/sync-assets.ts \
  --babel-ref <commit-or-ref> \
  --scripts-ref <commit-or-ref> \
  --distribution-ref <commit-or-ref>
```

Verify the default or a custom generated snapshot:

```bash
node scripts/verify-assets.ts
node scripts/verify-assets.ts --output <directory>
```

### Card-image archive

```bash
node scripts/download-images.ts [options]
```

| Option | Default | Description |
|---|---:|---|
| `--assets <directory>` | `generated/assets/current` | Set the source image-manifest snapshot. |
| `--output <directory>` | `generated/card-images/archive` | Set the local image archive directory. |
| `--concurrency <count>` | `18` | Set simultaneous download workers. |
| `--requests-per-second <count>` | `18` | Set request rate; cannot exceed `20`. |
| `--limit <count>` | all records | Process only the first number of image records, useful for testing. |
| `--force` | disabled | Redownload valid cached images. |

Examples:

```bash
node scripts/download-images.ts --limit 20
node scripts/download-images.ts --concurrency 8 --requests-per-second 12
node scripts/download-images.ts --force
node scripts/verify-images.ts
```

## Generated output

```text
generated/
├── mvp-assets-status.json
├── engine/current/
├── assets/current/
│   ├── catalog/
│   ├── scripts/
│   ├── strings/
│   └── images/
└── card-images/archive/
    ├── download-report.json
    └── full/<CARD_ID>.jpg
```

A successful unified run writes `status: "ready"` to `generated/mvp-assets-status.json`. Do not consume a snapshot marked `in-progress` or `failed`.

## Worker diagnostics

The Worker IPC boundary emits structured warning/error/completion objects to the browser Worker console (or the Node console in a headless host). A caller can inject a debug logger for receive/dispatch traces. Grep/filter the stable `duel.worker.*` event prefix:

- `duel.worker.command.*` — receive, rejection, failure, completion, or intentional skip at `src/worker/duel.worker.ts`;
- `duel.worker.event.*` — event dispatch and posting failures at `src/worker/duel.worker.ts`;
- `duel.worker.detached` — attachment teardown at `src/worker/duel.worker.ts`;
- `duel.worker.logging.failed` — injected logger failure fallback at `src/worker/diagnostics/worker-log.ts`.

Per-duel bounded in-memory traces also record engine errors and successful terminal session-close reasons. Persistent/downloadable diagnostics remain a later MVP milestone.

## Documentation

- [`context.md`](context.md) — concise project context and target architecture
- [`docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md) — ordered MVP implementation plan
- [`docs/assets/asset-import-pipeline.md`](docs/assets/asset-import-pipeline.md) — asset sources, transformations, integrity guarantees, and observed counts
- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/architecture/architecture.md`](docs/architecture/architecture.md) — canonical architecture map and granular decisions
- [`docs/archive/`](docs/archive/) — superseded technical research and decisions

## Current limitations

- Headless Checkpoint C is green: six persisted no-fallback real-WASM scenarios replay twice with fixed trace digests, and the supported action/prompt matrix has no uncovered row. The browser duel UI has not been implemented yet.
- Rare protocol families are exercised by test-only startup scripts inside the real core; normal Worker commands cannot select programmed mode or load those scripts.
- The vendored high-level adapter still cannot preserve unknown raw message bytes, so downloadable compatibility traces remain incomplete.
- The initial image run resolved 14,579 of 14,794 manifest IDs; 215 provider-missing IDs are recorded explicitly.
- Card artwork and Yu-Gi-Oh! data may have redistribution restrictions. Review image hosting, licenses, AGPL obligations, and intellectual-property requirements before public deployment.
