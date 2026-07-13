# YGO Story Duel Simulator

Browser-first, offline Yu-Gi-Oh! duel simulator built around Project Ignis `ygopro-core` through `ocgcore-wasm`.

The MVP launches directly into a normal duel between one human player and a basic computer opponent. Both sides use bundled preset decks; production games shuffle the decks and draw randomized starting hands normally. The opponent uses only simple, straightforward cards and shallow legal-action priorities rather than strategic combo planning.

Development is headless-first. Programmed real-WASM integration scenarios must cover every supported game-action family before Svelte, Phaser, or other visual duel-simulator work begins. The target architecture requires `ocgcore-wasm@0.1.2` to be vendored and integrity-verified.

> **Current status:** the browser MVP is implemented through Checkpoint G. The pinned synchronous core runs in a dedicated Worker; Svelte provides exhaustive accessible controls; Phaser renders the public field; active runtime/image artifacts are integrity-checked and revision-cached; diagnostics, restart, rollback, and failure fallbacks are bounded. Programmed and randomized real-WASM suites remain the compatibility gate, while the production bundle is exercised in Chromium with Firefox/WebKit startup smoke coverage.

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
npm run check
npm run dev
```

`npm run assets:mvp` is resumable. Existing Git caches and valid JPEGs are reused, so rerun the same command after a temporary network failure. The development server prints its local URL and serves the same trusted runtime files used by production packaging.

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
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Verify vendor/snapshot integrity, build `dist/`, and independently verify the package. |
| `npm run preview` | Serve the current production build locally. |
| `npm run build:reproducible` | Produce two isolated builds and require identical file hashes. |
| `npm test` | Run the legacy, unit, component, and real-WASM integration suites. |
| `npm run test:unit` | Run the focused Vitest unit suite. |
| `npm run test:component` | Run Svelte component tests. |
| `npm run test:integration` | Run real asset/WASM integration tests. |
| `npm run test:e2e` | Build at a non-root base and run Chromium plus Firefox/WebKit smoke coverage. |
| `npm run check` | Run every headless, component, build, reproducibility, and browser gate. |
| `npm run lint` | Run ESLint. |
| `npm run format:check` | Verify Prettier formatting. |
| `npm run typecheck` | Run strict TypeScript and Svelte checking. |
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
├── runtime-snapshot.json
├── runtime/current/manifest.json
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
- `duel.worker.node.*` — Node Worker bootstrap, message-deserialization, and thread-boundary failures;
- `duel.worker.logging.failed` — injected logger failure fallback at `src/worker/diagnostics/worker-log.ts`.

Per-duel bounded traces record revisions, process/message ordering, public events, opaque responses, opponent reasons, terminal state, and the production seed. Error/result surfaces can download a schema-versioned JSON diagnostic. These files are explicitly marked `contains-production-seed`; treat them as sensitive and share them only with an authorized debugger.

## Documentation

- [`context.md`](context.md) — concise project context and target architecture
- [`docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md) — ordered MVP implementation plan
- [`docs/assets/asset-import-pipeline.md`](docs/assets/asset-import-pipeline.md) — asset sources, transformations, integrity guarantees, and observed counts
- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/architecture/architecture.md`](docs/architecture/architecture.md) — canonical architecture map and granular decisions
- [`docs/archive/`](docs/archive/) — superseded technical research and decisions

## Production build and static hosting

```bash
npm run build
npm run preview -- --host 127.0.0.1
```

Deploy the contents of `dist/` as immutable static files. For a subpath, set Vite's base while building (for example `BASE_PATH=/duel/ npm run build` on POSIX or `$env:BASE_PATH='/duel/'; npm run build` in PowerShell). The Worker, WASM, runtime closure, card images, and licenses are emitted beneath that base. `npm run build:verify` rejects missing/extra artifacts, hash drift, Node-only imports, disabled engine fallbacks, missing third-party licenses, and size-budget regressions. `npm run build:app` deliberately uses Vite's `private` mode; an ordinary production-mode build refuses to package artwork while redistribution remains unapproved and every private artifact includes `PRIVATE_DEPLOYMENT_ONLY.txt`.

Keep the deployment private. The generated active-image manifest records `redistributionApproved: false`, and the documented BabelCDB, Project Ignis, artwork, trademark, AGPL source-availability, and other content obligations still require an authorized distribution review.

## Updating the pinned snapshot

1. Update upstream inputs on an isolated branch with `npm run assets:sync` (or `assets:sync:offline`).
2. Refresh/verify images with `npm run assets:images` and `npm run assets:images:verify`.
3. Run `npm run snapshot:generate` and `npm run snapshot:verify`.
4. Review revision, count, protocol, trace, and active-dependency changes.
5. Run `npm run check`; activate/publish only if every gate passes. Keep the previous snapshot available for rollback.

## Current limitations

- The MVP has two fixed preset decks, a deliberately basic legal-action opponent, and no story, progression, deck editor, multiplayer, or save/resume system.
- Rare protocol families use reviewable programmed real-core fixtures. An unclassified/unsupported runtime message ends safely and offers a diagnostic rather than guessing a response.
- Desktop Chrome, Firefox, and Safari are targeted. Chromium runs the complete automated flow; Firefox and WebKit currently run production startup smoke coverage. Mobile controls remain usable, but the Phaser field uses contained horizontal scrolling rather than a mobile redesign.
- Missing or invalid card art uses deterministic placeholders. The current full archive has documented provider-missing IDs, while the production package contains only the preset decks' active subset.
- Downloaded diagnostics include the production seed and are sensitive.
- Public deployment remains blocked on BabelCDB/content/image redistribution review and AGPL/source-availability compliance.
