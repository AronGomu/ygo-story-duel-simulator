# Content setup preflight — Chapter 1 only

State: superseded pre-normalization T1 snapshot. Current private prerequisites, approved corrections, normalized 75-set/1,627-code baseline, and remaining media gaps live in [`docs/assets/core-installation.md`](../docs/assets/core-installation.md). Historical observations below remain evidence only; they do not override current source policy. No packaging, downloads, activation, or deployment occurs in this command.

## Inputs

I1. `authoring/chapter-policy.json` records owner-approved Chapter 1 scope: original source TCG set dates from `2001-01-01` inclusive to `2005-05-28` exclusive; include promotional sets and every printing in selected sets. Policy is sole interval authority; no mirrored dates in selections. Source SHA-256 and snapshot cutoff bind policy to source. Scope approval does not claim globally verified historical chronology.
I2. `chapter-selections.json` contains exactly one `chapter-01` row, publishing `prototype-prologue-v1`. Parser rejects later chapter rows, duplicate selections and additional card grants. Set names sort by unchanged source date, then exact Unicode code-point name order. Replay: `tests/unit/content-setup-authoring.test.ts`.
I3. `authoring/card-set-source.json` remains byte-identical, SHA-256 `b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d`. Full authoring input retains 1,036 sets, five undated sets, five empty sets, 509 cards without set membership. Unknown unselected dates/memberships are unresolved provenance, not proof of later/non-TCG status, not automatic global release blockers, not grants. No exhaustive historical coverage claim.
I4. `authoring/release-date-evidence.json` retains previous scout observations: 34 official product/date rows, five locale list URLs reported HTTP 200, exact source-card/printing matches. Previous six-era authoring use is explicitly superseded. `authoring/superseded-six-era-mapping.json` preserves previous policy and 1,033-set candidate selections as history, never consumed by verifier. No observation refetch or raw-source override in this pass. Earlier response hash attests only `priorEnglishListObservation`, not subsequent locale observations.
I5. `distribution-evidence.json` remains pending. `sourceRevision` binds evidence to copied source SHA-256. Approval needs explicit engine/script source-obligation, DB-terms, artwork-permission, story-media-permission references. References are attestations, not automated legal proof.
I6. `setup-evidence.json` records nonsecret Cloudflare Free/static-only project, protected GitHub `production` environment, native Android/iPhone/iPad access. Null means missing evidence. Presence does not prove credentials work, remote protection exists, or native install/quota/reopen acceptance passed.

## Assumptions

A1. Owner retained existing candidate interval, not newly invented boundaries. DM floor `2001-01-01` is earliest source date; keep `Summoned Skull Sample promotional card`, no blanket pre-2002 exclusion. Provider dates remain secondary evidence.
A2. Exclusive end `2005-05-28` follows previous The Lost Millennium Sneak Peek observation. Main product observations are `2005-06-01`. This bounded release-scope choice is not an official era decree or exhaustive earliest-worldwide chronology proof. No later chapter boundary verification required.
A3. Reprints in selected sets remain included. Same card in earlier and later sets enters through earlier set only; later printing references do not enter selected content. Null-date candidate overrides from superseded authoring are not consumed.
A4. Existing roster metadata stays referenced, not approved compatible. `practice-bot` → `mvp-opponent`; `blaze-circuit` → `burning-abyss`; `vault-warden` → `shaddoll`. Story/default opponent also uses `shaddoll`. Production decks/story/UI are unchanged; no unknown ID corrections or silent card removal.

## Selected coverage and actual prerequisites

P1. Exactly one selected set is empty: `Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition`, `2003-11-18`, source-reported count 2. This remains explicit selected source gap; no name/cardinality exception.
P2. Separate nonempty `Yu-Gi-Oh! Power of Chaos: Yugi the Destiny promotional cards` source row contains five IDs, ten printing references (`PCY-001`–`PCY-005`, `PCY-E001`–`PCY-E005`). Parent scout reports official bundle `pid1141402004` lists same five cards; `cid5001`/`PCY-001` and `cid5008`/`PCY-002` show `2003-11-18`. Bundle evidence does not prove exact collector-edition subset. Gap may concern grouping rather than missing playable identities; do not fabricate membership. No new network verification here.
P3. Current consumer exposes all six `DECK_CATALOG` presets (`src/shell/screens/free-play-deck-listing.ts`, `src/shell/screens/FreePlayMatchSetup.svelte`); defaults and roster reference catalog IDs. `scripts/lib/content-setup-decks.ts` checks those exposed presets plus `src/decks/starter-deck.ydk`: bounded reads, fatal UTF-8, existing `parseYdk`, nonempty main, membership across main/extra/side. Missing/invalid/incompatible required decks fail closed. Unused legacy files are not scanned. Membership preflight does not replace engine legality, deck-rule validation or downstream duel tests.

| Deck / source                       | Copies outside selected union | Distinct outside IDs |
| ----------------------------------- | ----------------------------: | -------------------: |
| `mvp-player` / `player.ydk`         |                        5 / 40 |                    2 |
| `mvp-opponent` / `opponent.ydk`     |                        3 / 40 |                    1 |
| `burning-abyss`                     |                       47 / 55 |                   27 |
| `nekroz`                            |                       45 / 55 |                   29 |
| `shaddoll`                          |                       48 / 55 |                   24 |
| `spellbook`                         |                       49 / 55 |                   25 |
| shared `src/decks/starter-deck.ydk` |                        5 / 40 |                    2 |

P4. Counts reproduced with `parseYdk` against selected source union. Presets live under `src/battle/duel/presets/decks/`. IDs `83764718` (two player/starter copies) and `84257639` (three player/opponent/starter copies) are absent from entire frozen source, including orphans. Their identity/era is unknown; no inferred correction from similar IDs or synthetic fixtures. None of current bundled presets is fully compatible.
P5. Downstream T4 must explicitly supply tested compatible active presets or restrict exposure/defaults/roster. This is not a requirement to port every modern preset; unused modern files may remain. Restricting access must also cover local decks, story starter grants, saved selections and runtime catalog visibility. T1 changes no production path, grants or UI.
P6. Full frozen runtime technical validation remains mandatory for current consumer integrity: complete catalogs/texts/image metadata/scripts/globals/strings, dependency closure, browser caps, fixed engine ABI, canonical shards and immutable engine pins. Later-only artwork or source membership is not a chapter prerequisite; malformed/missing technical runtime dependencies still block. T2/T4 must separate shared technical runtime from Chapter 1 player-accessible content, without weakening runtime checks or exposing later cards.

## Commands and output

```sh
npx --no-install vitest run tests/unit/content-setup*.test.ts tests/unit/domain-boundaries.test.ts
npm run content:setup:verify
npm run content:setup:verify -- --public
npm run vendor:verify
npx --no-install tsc --noEmit
npm run lint
npm run format:check
```

C1. Both verifier modes atomically write `generated/content/setup-report.json`. Exit 0 means requested readiness; exit 2 means unmet prerequisites; exit 1 means unexpected execution/usage failure. Report diagnostics never interpolate source/env/exception values.
C2. Mapping, interval, selected completeness/assets, current exposed-deck compatibility and frozen-runtime gaps block `codeReady`. Rights/host/device evidence independently block `publishReady`. Lawful fixtures can exercise both readiness branches without approving real content.
C3. Source SHA hashes raw bytes; fatal UTF-8 rejects malformed input. Source reads cap at 16 MiB, source counts at 2,048 sets / 100,000 memberships. Setup/selection/evidence/deck reads cap at 1 MiB. Runtime/vendor manifests cap at 1 MiB; asset manifest at 2 MiB. Browser-aligned runtime inventory: 2,048 files, 16 MiB per file, 256 MiB aggregate. Selected art checks remain sequential, JPEG-signature/size checked; set art uses shop-ID hashes. Prototype media checks existing prologue/SVG/provenance. No network in verifier.
C4. Recorded acquisition/remediation commands, never run automatically:

```sh
npm run assets:mvp
npm run assets:images:cropped
npm run assets:sets
npm run snapshot:verify
```

C5. Existing acquisition scope may not cover all 76 selected sets/1,629 cards. Rerun verification after acquisition; never infer replacement art/cards or blanket-exclude source gaps. Later-only missing art is not a release blocker.

## Current verification and remaining gates

R1. Scope regressions: red 40 failed / 132 passed; green 172 passed. Roster prerequisite regressions: red 15 failed / 173 passed; green 188 passed, including domain boundaries. Original runtime consumer/ABI/browser/extra-shard regression file unchanged. Fresh parent review remains required.
R2. Both real CLI modes exit 2: `codeReady: false`, `publishReady: false`. Observed isolated-worktree blockers: one selected empty set; unverified runtime; 1,629 unsupported/unverified selected runtime codes, 1,629 missing full images, 1,629 missing cropped images, 76 missing set images; incompatible exposed/default/starter decks; pending rights, host and device evidence. These asset/runtime absences describe this isolated root, not availability elsewhere or proof redownload is needed. No acquisition occurs in this pass. Runtime unavailable means reported support absence is not proof those 1,629 cards cannot be supported. Selected membership also does not prove engine legality or compatible playable decks. No missing later-era evidence or global orphan count blocks this release.
R3. Prior dependency evidence retained, not rerun: requested local deps pinned exactly; peer compatibility checked against Node 24/Vite 8. Prior `npm audit` reported three moderate pre-existing Vitest-family advisories; production-only audit reported zero. npm 11.16.0 `ignore-scripts` was false, `allowScripts` absent; policy advisory, scripts could run by default. Prior `npm approve-scripts --allow-scripts-pending` listed esbuild/workerd postinstall scripts as unreviewed, not blocked. Retained evidence does not prove whether either executed during original install. No install/script rerun, approval, config change or policy bypass in scope amendment. Wrangler native execution remains unverified. Earlier blanket zero-audit/blocked-install-script claims remain withdrawn. New Babel deps require parser/types 7.29.8; package/lock bytes unchanged in this pass. Optional dev-only Sharp/libvips LGPL distribution obligations remain review inputs.
R4. Scope change is not final T1 readiness. Selected collector-edition source mapping, assets/runtime, compatible active deck exposure and independent review remain unresolved. No commit, staging, push, publish, feedback edit, frozen-vendor edit or production refactor.

## Human gates

The release owner must review source obligations and permission evidence before changing distribution status to `approved`. Record evidence identifiers, not credentials. Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only through the appropriate secret store; set the nonsecret `CLOUDFLARE_PAGES_PROJECT` variable. Record the actual project and protected production-environment evidence. Obtain native Android, iPhone, and iPad tester access. This verifier performs no account creation, credential validation, protection changes, or deployment.
