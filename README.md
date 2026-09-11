# Ascencio

Revisit the different era of Yu-Gi-Oh! through the Story of Ascencio !

This is a Fan Game project with the gola of recreating old YGO solo game experience akin to YGO Spirit Troubadour, Spirit Caller, Tag Forces.

Play through a mostly linear Story, open cards, build decks and beat your opponents.

You start at the DUEL MONSTER era and you will eventually progress up to modern ERA yugioh (that's the goal at least) !

This game will be release in chapters, each chapter corresponding to a new story arc and new era of YGO !

Current Road Map :
DUEL MONSTER => GX => Synchros => XYZ => PENDULUM => LINKS

This roadmap may be redefined as the Story is refined.

## Who is this for ?

This experience is tailored for experienced Yu‑Gi‑Oh! players and newcomers.
Unlike modern Yu‑Gi‑Oh games, this experience is built knowing that modern Yu‑Gi‑Oh can be extremely complicated.
That's why I start at the basis of the game in the Duel Monsters era.
Discover new mechanics and new archetypes progressively, so you are never overloaded with information.

## Online ?

There is no online mode ! This is an experience tailored for solo play experience.

## Thanks to [find names]

This project is browser-first and designed to run on any OS and machines.
If you encounter any performance issue, do not hesitate to send feedback.
I want to design an experience that can be accessed by everyone.

Deep thanks to Project Ignis, ygopro-core, and ocgcore-wasm, which allowed me to start with a very solid base.

## AI

This project was made only thanks to AI.
The entire codebase and most of the assets used for this game are AI-generated.

## Copyright

Copyright does not exist; it's a scam and pure evil.
Everything everything built and released in this project is fully open source and accessible to anyone to do anything with it.

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

After the owner supplies the no-secret `asset-delivery.config.json` described in [asset delivery setup](docs/assets/asset-delivery-setup.md), fresh-clone development uses:

```bash
git clone git@github.com:AronGomu/ascencio.git
cd ascencio
npm ci
npm run assets:download
npm run dev
```

`assets:download` anonymously resolves the latest published nightly, verifies every immutable object/archive/file hash, then restores all four managed roots. No publisher environment is required. Requests retry at most three times; rerun after a temporary outage. Keep free disk for archive + extracted stage + installed files + replacement backups. A retired nightly can expire after 24 hours; `ASSET_REVISION_UNAVAILABLE` means rerun to resolve the current nightly.

Run quality gates separately:

```bash
npm run check:headless
npm run check:browser
```

`npm run assets:mvp` remains the resumable upstream acquisition command for maintainers. It no longer represents complete fresh-clone bootstrap because it does not consume the published four-root delivery snapshot.

## Public asset delivery setup

- A1. Developer downloads need **no publisher credentials**. `npm run assets:download` is the canonical published-snapshot bootstrap; `assets:mvp` remains upstream acquisition only.
- A2. `npm run assets:setup -- --help` explains read-only preflight. `npm run assets:setup -- --check` validates local config; optional `--remote --origin <exact-origin>` performs bounded read-only public/S3 probes. It never provisions or publishes.
- A3. [Owner setup](docs/assets/asset-delivery-setup.md) defines the no-secret config, exact CORS origins, bounded retries, storage budget, rights scope and explicit empty-index bootstrap. Public originals and unreleased bytes require explicit approval; availability does not establish rights.
- A4. `npm run assets:publish` and remote prune are explicit maintainer writes. Do not run them for development setup. Real R2 canary, Pages deploy and native PWA acceptance remain owner-authorized work.
- A5. Dev metadata truth means matching archive membership and bytes, **not** exhaustive upstream availability or gameplay readiness. `content:setup:verify` remains separate.

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

| Command                        | Description                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `npm ci`                       | Install the exact development dependencies from `package-lock.json`.                             |
| `npm run assets:setup -- --check` | Validate no-secret delivery config and local prerequisites; add `--remote --origin <origin>` for read-only probes. |
| `npm run assets:download` | Anonymously download, verify and install latest published dev nightly; `--version 0.1.0` selects an immutable release. |
| `npm run assets:profiles:sync -- --check` | Check canonical roots, references and profile ownership without mutation. |
| `npm run assets:promote -- --help` | Preview/apply exact-file or tree delivery rules; no asset moves. |
| `npm run assets:migrate -- --plan` | Preview hash-guarded copy-only legacy migration; originals retained. |
| `npm run assets:bundle -- --target dev\|prod\|all` | Build deterministic local object graph; prod/all require prepared player metadata and explicit history. |
| `npm run assets:publish -- --target dev\|prod\|all --origin <origin>` | Explicit rights-gated R2 write; add `--version 0.1.0` for immutable release. |
| `npm run assets:prune -- --local` | Preview hash-safe retired local files; apply reviewed generated plan explicitly. |
| `npm run assets:prune -- --remote` | Preview expired remote nightly objects; requires publisher environment and explicit apply. |
| `npm run assets:mvp`           | Acquire and verify upstream MVP inputs; not complete published-snapshot bootstrap.                 |
| `npm run assets:engine`        | Download, integrity-check, extract, and publish the pinned engine package.                       |
| `npm run assets:engine:verify` | Verify the extracted engine package and WASM header.                                             |
| `npm run assets:sync`          | Fetch Project Ignis sources and regenerate catalog, text, scripts, strings, and image manifests. |
| `npm run assets:sync:offline`  | Regenerate data from the existing local Git source caches without fetching.                      |
| `npm run assets:verify`        | Verify generated data manifests, hashes, counts, shards, and coverage.                           |
| `npm run assets:images`        | Download or resume the full-card JPEG archive.                                                   |
| `npm run assets:images:verify` | Verify image coverage, report consistency, sizes, and JPEG boundaries.                           |
| `npm run dev`                  | Start the Vite development server.                                                               |
| `npm run build`                | Verify vendor/snapshot integrity, build `dist/`, and independently verify the package.           |
| `npm run preview`              | Serve the current production build locally.                                                      |
| `npm run build:reproducible`   | Produce two isolated builds and require identical file hashes.                                   |
| `npm test`                     | Run the legacy, unit, component, and real-WASM integration suites.                               |
| `npm run test:unit`            | Run the focused Vitest unit suite.                                                               |
| `npm run test:component`       | Run Svelte component tests.                                                                      |
| `npm run test:integration`     | Run real asset/WASM integration tests.                                                           |
| `npm run test:e2e`             | Build at a non-root base and run the Playwright browser suite.                                   |
| `npm run check`                | Run every headless, component, build, reproducibility, and browser gate.                         |
| `npm run lint`                 | Run ESLint.                                                                                      |
| `npm run format:check`         | Verify Prettier formatting.                                                                      |
| `npm run typecheck`            | Run strict TypeScript and Svelte checking.                                                       |
| `npm run vendor:verify`        | Verify every vendored engine file against its reviewed manifest.                                 |
| `npm run snapshot:verify`      | Verify the generated runtime snapshot files and digests.                                         |
| `npm run check:headless`       | Run the complete mandatory local headless quality gate.                                          |

Display developer downloader help with `npm run assets:download -- --help`. Maintainer acquisition help remains `npm run assets:mvp -- --help`.

Player producer adapters:

```bash
npm run content:catalog -- --help
npm run content:pack -- --help
npm run content:verify -- --help
```

Root/profile migration details: [`docs/assets/asset-profiles.md`](docs/assets/asset-profiles.md). Legacy acquisition is explicit; scan/promotion never refresh upstream inputs.

## Unified asset command options

```bash
npm run assets:mvp -- [options]
```

| Option                          | Description                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `--offline`                     | Regenerate and verify using existing Git and image caches without network access. |
| `--force-images`                | Redownload images even when a valid cached JPEG exists.                           |
| `--concurrency <count>`         | Set simultaneous image workers; default is `18`.                                  |
| `--requests-per-second <count>` | Set the image request rate; default is `18`, maximum is `20`.                     |
| `-h`, `--help`                  | Print command usage.                                                              |

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

| Option                     |                    Default | Description                                              |
| -------------------------- | -------------------------: | -------------------------------------------------------- |
| `--offline`                |                   disabled | Use existing source repositories without fetching.       |
| `--cache-dir <directory>`  |          `.cache/upstream` | Set the Git source cache directory inside the project.   |
| `--output <directory>`     | `assets/shared/data/current` | Set the generated snapshot output directory.             |
| `--babel-ref <ref>`        |                   `master` | Pin a BabelCDB branch, tag, or commit.                   |
| `--scripts-ref <ref>`      |                   `master` | Pin a CardScripts branch, tag, or commit.                |
| `--distribution-ref <ref>` |                   `master` | Pin a Project Ignis Distribution branch, tag, or commit. |

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

| Option                          |                         Default | Description                                                         |
| ------------------------------- | ------------------------------: | ------------------------------------------------------------------- |
| `--assets <directory>`          |      `assets/shared/data/current` | Set the source image-manifest snapshot.                             |
| `--output <directory>`          | `assets/shared/card-images` | Set the local image archive directory.                              |
| `--concurrency <count>`         |                            `18` | Set simultaneous download workers.                                  |
| `--requests-per-second <count>` |                            `18` | Set request rate; cannot exceed `20`.                               |
| `--limit <count>`               |                     all records | Process only the first number of image records, useful for testing. |
| `--force`                       |                        disabled | Redownload valid cached images.                                     |

Examples:

```bash
node scripts/download-images.ts --limit 20
node scripts/download-images.ts --concurrency 8 --requests-per-second 12
node scripts/download-images.ts --force
node scripts/verify-images.ts
```

## Asset sources and operational output

```text
assets/
├── battle/engine/current/       # Explicit legacy acquisition; vendor stays authoritative
├── deck-editor/
├── story/
└── shared/
    ├── data/current/           # Catalog, scripts, strings, image metadata
    ├── runtime/current/
    ├── card-images/{full,cropped}/
    ├── card-back.jpg
    ├── set-images/
    └── fonts/
asset-profiles/                 # Tracked ownership rules + nightly selection
generated/                     # Status, download reports, delivery receipts/outputs
```

A successful unified run writes `status: "ready"` to `generated/mvp-assets-status.json`. Do not consume a snapshot marked `in-progress` or `failed`.

## Worker diagnostics

The Worker IPC boundary emits structured warning/error/completion objects to the browser Worker console (or the Node console in a headless host). A caller can inject a debug logger for receive/dispatch traces. Grep/filter the stable `duel.worker.*` event prefix:

- `duel.worker.command.*` — receive, rejection, failure, completion, or intentional skip at `src/battle/worker/duel.worker.ts`;
- `duel.worker.event.*` — event dispatch and posting failures at `src/battle/worker/duel.worker.ts`;
- `duel.worker.detached` — attachment teardown at `src/battle/worker/duel.worker.ts`;
- `duel.worker.node.*` — Node Worker bootstrap, message-deserialization, and thread-boundary failures;
- `duel.worker.logging.failed` — injected logger failure fallback at `src/battle/worker/diagnostics/worker-log.ts`.

Per-duel bounded traces record revisions, process/message ordering, public events, opaque responses, opponent reasons, terminal state, and the production seed. Error/result surfaces can download a schema-versioned JSON diagnostic. These files are explicitly marked `contains-production-seed`; treat them as sensitive and share them only with an authorized debugger.

## Documentation

- [`AGENTS.md`](AGENTS.md) — concise project context and target architecture
- [`docs/DUEL_FIELD_DOM_IMPLEMENTATION_PLAN.md`](docs/DUEL_FIELD_DOM_IMPLEMENTATION_PLAN.md) — current TDD ticket/dependency plan
- [`docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md) — completed MVP/Phaser baseline plan
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

## Contribution

Feel free to open PR requests for this project, or to fork and create your own versions.
For now, I accept all kinds of contributions.
