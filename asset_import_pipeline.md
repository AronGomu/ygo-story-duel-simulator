---
date: 2026-07-12
title: YGO Story Duel Simulator - Asset Import Pipeline
tags:
  - implementation
  - assets
  - babelcdb
  - cardscripts
  - images
status: implemented
---

# YGO Story Duel Simulator - Asset Import Pipeline

## Purpose

Create one atomic, versioned browser snapshot containing all data required by the offline duel client while keeping generated third-party data out of Git.

The complete, resumable command is implemented in `scripts/download-mvp-assets.ts`. It orchestrates the pinned WebAssembly engine package, catalog/script/string importer, card-image downloader, and all integrity verifiers. Windows and Unix launchers are provided at the project root.

## Sources

| Asset | Source |
|---|---|
| Duel engine and TypeScript adapter | Pinned npm package `ocgcore-wasm@0.1.2`, including `lib/ocgcore.sync.wasm` |
| Standard-format metadata/text | `ProjectIgnis/BabelCDB` → `cards.cdb`, `release-*.cdb`, and non-Rush `prerelease-*.cdb` |
| Official and prerelease effects | `ProjectIgnis/CardScripts` → `official/c<ID>.lua` and `pre-release/c<ID>.lua` |
| Global/procedure scripts | Root Lua files from `ProjectIgnis/CardScripts` |
| English system strings | `ProjectIgnis/Distribution` → `config/strings.conf` |
| Card image locations | YGOPRODeck image URL convention, recorded as a provider manifest |

Each Git source is fetched into `.cache/upstream`, checked out at a concrete commit, and recorded in the generated manifest. Generation happens outside the live output directory, is independently verified, and keeps a recoverable previous directory during publication.

## Import flow

```text
download and integrity-check pinned ocgcore-wasm package
→ safely extract and verify ocgcore.sync.wasm + adapter files
→ sync canonical repositories
→ read and merge standard cards.cdb + release/prerelease CDBs
→ validate unique IDs and datas/texts one-to-one coverage
→ normalize ocgcore card data
→ generate 64 deterministic card shards
→ generate 64 deterministic text shards
→ read every official c<ID>.lua
→ generate 256 deterministic script-content shards
→ package root global/procedure Lua scripts
→ parse Project Ignis strings.conf
→ generate 64 image-manifest shards
→ hash every generated artifact
→ write manifest.json
→ independently verify the staging snapshot
→ recoverably replace generated/assets/current
```

## Card normalization

The importer converts BabelCDB's packed fields into the shape expected by the future `ocgcore-wasm` adapter:

- `id` → `code`;
- packed `setcode` → `setcodes[]`;
- packed level → level and Pendulum scales;
- Link monster `def` → `linkMarker` while preserving the raw defense value;
- 64-bit race and setcode fields are read through SQLite string casts to avoid JavaScript precision loss;
- card text `str1` through `str16` is preserved for effect choices.

## Sharding

Card and image shard:

```text
card ID modulo 64
```

Official script shard:

```text
script card ID modulo 256
```

This gives deterministic lookup without loading the complete catalog or all Lua source into Worker memory. The full generated snapshot remains available locally; only active-duel shards need to be fetched and expanded.

## Image policy and local archive

The catalog importer generates a complete ID-based provider manifest:

```text
https://images.ygoprodeck.com/images/cards/<ID>.jpg
https://images.ygoprodeck.com/images/cards_cropped/<ID>.jpg
```

`npm run assets:images` then downloads full-card JPEGs into the local resumable archive:

```text
generated/card-images/archive/full/<ID>.jpg
```

The downloader respects YGOPRODeck's documented 20-request/second ceiling, validates JPEG signatures, retries transient failures, skips valid existing files, and records unavailable IDs in `download-report.json`.

The initial completed archive contains 14,579 valid full-card images (about 2.37 GB). YGOPRODeck returned HTTP 404 for 215 IDs, mostly simulator-specific, alternate, legacy or prerelease records. Those IDs are explicitly recorded and require a placeholder or a second approved provider.

The future browser loader will:

1. resolve all unique IDs in the active decks;
2. serve locally archived/re-hosted images rather than continually hotlinking YGOPRODeck;
3. preload those images before enabling duel input;
4. use card backs for hidden cards;
5. use a deterministic missing-image placeholder for the 215 unresolved IDs.

The images and generated data remain ignored by Git because committing approximately 2.4 GB of third-party artwork would make the source repository impractical and does not resolve redistribution rights.

## Commands

From the repository root, one command downloads, generates and verifies every external MVP asset in the required order:

```bash
npm run assets:mvp
```

It is resumable: Git caches are reused and valid existing JPEGs are signature-checked and skipped. A failed network run can be continued by running the same command again. Cross-process locks reject overlapping acquisition runs, and `generated/mvp-assets-status.json` is only marked `ready` after both archives pass verification; consumers must not use a snapshot marked `in-progress` or `failed`.

Executable launchers are also included and set their own working directory, so they can be launched from anywhere:

```powershell
# Windows Command Prompt or PowerShell
.\download-mvp-assets.cmd
```

```bash
# macOS/Linux
./download-mvp-assets.sh
```

No npm package installation is required for acquisition itself; the launchers use Node.js 24's native TypeScript execution and Node built-ins. Requirements are Node.js 24+, Git, network access, and roughly 2.5 GB of free disk space.

To regenerate and verify entirely from already-downloaded Git and image caches without network access:

```bash
npm run assets:mvp -- --offline
```

Useful image overrides:

```bash
npm run assets:mvp -- --concurrency 8 --requests-per-second 12
npm run assets:mvp -- --force-images
```

The lower-level commands remain available for diagnosis or partial maintenance:

```bash
npm run assets:engine
npm run assets:engine:verify
npm run assets:sync
npm run assets:verify
npm run assets:images
npm run assets:images:verify
npm test
npm run typecheck
```

Pin alternate refs or commits:

```bash
node scripts/sync-assets.ts \
  --babel-ref <commit-or-ref> \
  --scripts-ref <commit-or-ref> \
  --distribution-ref <commit-or-ref>
```

## Generated layout

```text
generated/
├── mvp-assets-status.json
├── engine/current/
│   ├── engine-manifest.json
│   ├── lib/ocgcore.sync.wasm
│   ├── lib/ocgcore.sync.mjs
│   └── dist/
├── assets/current/
│   ├── manifest.json
│   ├── catalog/
│   │   ├── cards/<00..3f>.json
│   │   └── texts/en/<00..3f>.json
│   ├── scripts/
│   │   ├── globals.json
│   │   ├── index.json
│   │   └── cards/<00..ff>.json
│   ├── strings/en.json
│   └── images/<00..3f>.json
└── card-images/archive/
    ├── download-report.json
    └── full/<CARD_ID>.jpg
```

`generated/` and `.cache/` are intentionally ignored by Git. CI or a release job should publish the verified data snapshot and legally approved/re-hosted image archive as versioned application artifacts.

## Integrity guarantees

`npm run assets:engine:verify` checks the pinned package identity, every extracted file's size and SHA-256, required adapter files, and the WebAssembly magic header. Package acquisition also verifies npm's pinned SHA-512 integrity value before extraction.

`npm run assets:verify` checks:

- every generated file's byte length and SHA-256;
- the external `manifest.sha256` digest and rejection of unmanifested files;
- manifest schema and shard counts;
- declared and actual record counts;
- unique card/text/image IDs;
- exact card-to-text and card-to-image-manifest coverage;
- official script filename validity and uniqueness;
- presence of `constant.lua` and `utility.lua`;
- image URL/card-ID consistency;
- that image redistribution has not been marked approved accidentally.

## First successful snapshot

The initial verified run produced:

- pinned and verified `ocgcore-wasm@0.1.2`, including `ocgcore.sync.wasm` and its JavaScript/TypeScript adapter;
- 14,794 standard-format card records, including current release/prerelease additions;
- 14,794 text records;
- 13,399 official card scripts;
- 125 prerelease card scripts;
- 25 global/procedure scripts;
- 835 system strings;
- 33 victory strings;
- 134 counter strings;
- 756 set-name strings;
- 14,794 image-manifest records;
- 14,579 downloaded and verified full-card JPEGs;
- 215 provider-missing image IDs recorded explicitly;
- approximately 45 MB of generated uncompressed data/script artifacts;
- approximately 2.37 GB of locally archived card images.

These values are observations, not hard-coded expected counts; future upstream snapshots may change them. Rush Duel, Skill, Goat-only and unofficial anime/manga databases/scripts are intentionally excluded from the initial Master Rule duel-client catalog.
