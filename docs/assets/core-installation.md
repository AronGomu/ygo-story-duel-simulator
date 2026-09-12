# CORE installation setup

T1 establishes Chapter 1 source-policy readiness. It does not install or publish Chapter 1.

## Private loopback prerequisites

1. **P1.** Use Node.js 24 or newer with npm.
2. **P2.** Keep project dependencies installed from the pinned lockfile.
3. **P3.** Provide Chromium through the existing Playwright installation.
4. **P4.** Keep `content/authoring/card-set-source.json` byte-identical at SHA-256 `b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d`.

Private loopback installation does **not** require a Cloudflare account, Cloudflare keys, a rights-to-publish declaration, or Android/iPhone/iPad testers. Public publishing and native-device acceptance are outside this release scope. Existing `publishReady` diagnostics remain public-release checks and do not block private `codeReady` acceptance.

## Source ownership

- **O1.** `content/authoring/card-set-source.json` is frozen raw audit evidence. Never edit it to make runtime IDs or source gaps pass.
- **O2.** `content/authoring/chapter-one-corrections.json` owns the exact approved Chapter 1 alias and exclusions.
- **O3.** `content/chapter-selections.json` owns the shipped Chapter 1 set selection. Collector-edition PCY metadata is absent; the separate PCY promotional set remains selected.
- **O4.** `scripts/lib/chapter-source-policy.ts` is the sole normalization path for setup, deck compatibility, prepared metadata, and future chapter payload/acquisition consumers.

Normalization maps source code `81480461` to runtime code `81480460`, excludes unsupported prize-card codes `501000000` and `501000001`, and excludes only `Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition`. It performs no name-based or general alias inference.

Normalized pinned-source baseline:

| Measure                    | Value |
| -------------------------- | ----: |
| Selected sets              |    75 |
| Unique playable-source IDs | 1,627 |
| Per-set card records       | 2,747 |
| Retained printing tuples   | 4,514 |

Counts derive from the pinned source through `normalizeChapterSource`; they are not readiness overrides.

## Current media gaps for T3

Bounded setup inspection validates runtime manifests, JPEG signatures/sizes, and set-image manifest hashes. File presence alone is not verification.

| Included requirement | Missing |
| -------------------- | ------: |
| Runtime card records |       0 |
| Full card images     |       0 |
| Cropped card images  |   1,591 |
| Set images           |      61 |

These counts describe current local acquired roots after normalization. T3 owns acquisition and must rerun verification; no missing item may be substituted or silently excluded.

## Acceptance

Run from repository root:

```sh
node --version
npm --version
npx playwright install --dry-run chromium
npx vitest run tests/unit/chapter-source-policy.test.ts tests/unit/content-setup*.test.ts tests/unit/chapter-one-decks.test.ts
npx tsc --noEmit
npm run vendor:verify
```

Expected policy evidence: focused tests report 75 sets and 1,627 normalized codes; raw-source SHA remains unchanged; malformed or extra corrections throw `CONTENT_SOURCE_POLICY_INVALID`; an unrelated included runtime gap still blocks setup.

`npm run content:setup:verify` remains expected to report `codeReady: false` until T3 supplies all required included media. Exit status 2 means known prerequisites remain; it does not mean source-policy normalization failed.
