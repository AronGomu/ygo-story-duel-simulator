# T4 acceptance evidence

State: final independent review APPROVE; no high blockers. Required T4 gates pass; baseline caveats below remain. Parent authorized reviewed source/docs plus sanitized metadata commit/push.

## Candidate

A1. Base `25d761f117a6260890a2465d81c3433c850deb10`; branch `feat/core-install-t4`. Merged T2/T3 sources consumed.
A2. `/ship`: CREATE, production, headless. Supervisor verified route `openai-codex/gpt-6-astra:high`. No subagents launched by worker.
A3. Source inventory: `changed-files.json`; added/removed counts including untracked source: `diff-summary.json`. Required gate exit codes: `final-gates.json`.

## Observed invariants

| ID | Contract | Evidence |
| --- | --- | --- |
| B1 | Complete closure only; private staging cannot grant public reads | `tests/unit/content-installer.test.ts`; Chromium orphan/CAS tests in `e2e-content/installer.spec.ts` |
| B2 | Old/full-new current only across Cache quota, IDB quota, CAS abort, page termination | Real Chromium Cache/IDB tests; `browser.txt`, `playwright-report.json`, `test-results/` |
| B3 | Mid-part abort retains completed parts; reload enumerates paused job | Browser receives 8 bytes from second part, aborts, reloads; one verified part retained; current generation remains zero |
| B4 | Exact tagged runtime receipt; legacy rejected; no missing DB creation | `tests/unit/content-runtime-activation.test.ts`; prepared orphan receipt remains readable but cannot grant readiness |
| B5 | Scoped shared leases; unrelated install lock remains available | Chromium observes sorted `ygo-content-ref:<manifestSha256>` shared locks; exclusive same-ref lock unavailable until idempotent release |

## Real Chapter 1

C1. Input run: `generated/asset-delivery/runs/7660bc2c-520a-41fa-a6fd-dfdecc770807`.
C2. Producer snapshot: `03571be5332cda2bf41de3b09a3c9350a1e82b7325aaeea48f0fafdc309808d0`. Index/catalog: `50a83e1523980debe40f2fc7633dc6faccd06b885519dcaea97fd4229f852cb4`.
C3. UI downloads 468,243,718 bytes; installed files total 467,651,710 bytes. Current generation 1; receipt kind `installed-runtime-v1`; zero Workers. Evidence: `installed-evidence.json`, `real-installed.png`.
C4. Ordinary CORE build passes; private pinned-content build passes. Source-only root/subpath Chromium both pass. No real-duel/playable-domain claim.

## Final checks

| ID | Command | Result / output |
| --- | --- | --- |
| D1 | `npx vitest run tests/unit/content-installer.test.ts tests/unit/content-storage.test.ts tests/unit/content-runtime-activation.test.ts` | 42 passed; `unit.txt` |
| D2 | `npx vitest run tests/component/content-installer.test.ts` | 3 passed; `component.txt` |
| D3 | `CONTENT_RUN=generated/asset-delivery/runs/7660bc2c-520a-41fa-a6fd-dfdecc770807 npx playwright test -c playwright.content.config.ts --project=chromium --grep "installer\|atomic\|quota\|archive"` | 12 passed; `browser.txt` |
| D4 | `npm run typecheck`; `npm run lint` | Exit 0; `typecheck.txt`, `lint.txt` |
| D5 | `npm test` | Legacy 172; unit 2,176 + performance 9; component 1,230; integration 46 passed. `full-tests.txt` |

| ID | Extra gate | Result / output |
| --- | --- | --- |
| E1 | `npm run build`; `npm run build:reproducible` | CORE build passes; 52 reproducible files. `build.txt`, `reproducible.txt` |
| E2 | `CONTENT_RUN=generated/asset-delivery/runs/7660bc2c-520a-41fa-a6fd-dfdecc770807 npm run build` | Pinned private build passes; `build-private.txt` |
| E3 | `npm run content:verify -- --run generated/asset-delivery/runs/7660bc2c-520a-41fa-a6fd-dfdecc770807` | Producer snapshot verified; `producer-verify.txt` |
| E4 | `npx playwright test -c playwright.core.config.ts --project=chromium --grep 'source-only CORE'` | Root/subpath 2 passed; `source-only.txt`, `source-only-evidence/` |
| E5 | Prettier changed-source check; `git diff --check`; staged diff; residue scan | Format clean; whitespace clean; staged empty; zero residue hits. `format.txt`, `diff-summary.json`, `residue-scan.json` |

## TDD / repairs

F1. Initial missing installer export assertion red: `red.txt`; runtime receipt missing source red: `runtime-red.txt`.
F2. Async bootstrap screen regression red → green: `component-red.txt` → `component.txt`.
F3. Mid-body network cancellation exposed raw rejection red → fixed network failure green: `network-red.txt` → `unit.txt`.
F4. Real-pack test exposed repeated manifest reparsing cost. Verification-scoped metadata memo removes repeated parsing; public operations still rehash independently. Real roundtrip green in `browser.txt`.
F5. New paths audited for swallowed failures: `failure-audit.md`; exact sites `failure-audit-sites.txt`.

## Locked decisions / residual scope

G1. Supervisor-approved merged T3 amendment: null set art means evidence-backed unavailable art; no substitute images. Only chapter-owned payloads accepted.
G2. Supervisor-approved pure deck-rule imports frozen per file in lint/tests. Pure Battle activation sub-entry exports only `createRuntimeActivationPort`; frozen vendor digest checked against untouched source.
G3. Gameplay stays locked through T4. Resume/update/remove/cancel UI/API implementation belongs to T8; no fake lifecycle stubs. Scoped session leases implemented now per supervisor direction.
G4. Existing `ShopSellScreen.svelte:240` line-clamp warning remains. Two full-suite `StoryMenuEntry.test.ts` timeouts occurred; isolated retries plus subsequent complete suites passed without story/test changes. Cause unresolved. Failures retained in `full-tests-flake.txt`, `full-tests-flake-rereview.txt`; retries in `story-menu-retry.txt`, `story-menu-rereview-retry.txt`.
G5. Approved T3 acquired roots copied into ignored local validation paths only. Vendor/raw/protected sources untouched. Graph updated without LLM calls; graphify reports existing Svelte AST extraction limitations. No system-wide apply, publication, or user interaction.

## Review repairs

J1. Reviewer repro confirmed: chapter has 14 cards, runtime declares empty support, indexed `c1.lua`/images omitted → old code completed/persisted receipt. New chapter-demand subset guard rejects before preparation. Every indexed script must resolve through declared, verified runtime files; existing global/card/alias/image checks apply. Normal monsters need no invented script. Evidence: `review-r1-red.txt`, `review-r1-green.txt`, final `unit.txt`.
J2. Persisted failures now require exact keys, known code, safe/null path. Unknown codes/extra keys/unsafe paths/falsy invalid markers normalize to fixed integrity failure; invalidation rejects malformed reasons before mutation; UI always has fixed copy. Evidence: `review-r2-red.txt`, `review-r2-green.txt`.
J3. Battle v3 open: blocked event fails immediately; other pending opens bounded at five seconds; abandoned late upgrade aborts, late success closes. Receipt write uses same bounded connection. Receipt reads queued behind abandoned upgrade also fail within five seconds, close late connection. Page abort settles pending preparation; orphan cannot CAS. Real two-tab v2 preferences survive; retry succeeds. Evidence: `review-r3-unit-red.txt`, `review-r3-browser-red.txt`, `review-r3-reader-red.txt`, `review-r3-browser-green.txt`.
J4. Component assertions now cover exact sizes/deps/progress/network retry. Format glob includes `e2e-content/**/*.{ts,svelte}`; frozen test verifies existing format/lint/typecheck/CI source coverage. Evidence: `component.txt`, `review-gates-red.txt`, `review-gates-green.txt`.
J5. Final source candidate: 50 files, +5,084 / −56 lines. Source digests: `source-sha256.json`. All nine final ticket/supporting commands exit zero in `final-gates.json`; four extra validation commands exit zero in `extra-gates.json`. CORE shell 113,013 bytes; Worker 147,164; Battle 311,873; Deck Editor 148,306; Story 143,868.

## Final re-review repairs

K1. Second review approved concurrency/data integrity; blocked absent/empty/null mandatory globals plus present-undefined invalid marker.
K2. `constant.lua`, `utility.lua`, every indexed global now require own non-empty string source; success fixture includes both required globals. Missing names omitted from index still reject. Eight malformed required-global cases fail before receipt/current.
K3. All three invalid lookup sites now read key/value/transaction completion together. Absent key differs from present `undefined`; every present value passes strict failure parser. Real Chromium proves stored count 1, value type undefined, unchanged generation 1, failed public file/current/inspect reads.
K4. Red: nine unit failures in `rereview-globals-undefined-red.txt`; browser failure in `rereview-undefined-browser-red.txt`. Green: matching `*-green.txt`, final unit42 + tooling1/component3/Chromium12/full npm test.
K5. Final source digests refreshed in `source-sha256.json`; required/extra gate manifests refreshed after repairs. No source edits since final gate run.

## Baseline gate caveats

I1. Full `npm run format:check` fails solely on unchanged `e2e/asset-root-urls.spec.ts`: `[warn] e2e/asset-root-urls.spec.ts`. Base/working blob both `b58c453d02101ee38e719e0bedf976c1b798a762`. Supervisor directed preserve per D2, report pre-existing residual. Evidence: `baseline-format.json`, `format-baseline-failure.txt`.
I2. Changed-path check passes via `node artifacts/CORE_ACCEPTANCE/T4/check-changed-format.mjs`; exact path set in `format-paths.json`. No unrelated formatting repair.
I3. Supervisor assigned actual CI `CONTENT_RUN` provisioning/browser execution to T9/T10. New source-coverage gate does not claim CI content-browser execution; no fixture-only substitute or silent skip.

## Review gate

H1. Parent-arranged final independent review APPROVE; no high blockers. Initial closure/failure/DB-liveness findings plus mandatory-global/undefined-marker follow-ups resolved with red/green evidence. Parent explicitly authorized `feat(content): activate only verified complete installs` on `feat/core-install-t4`, then feature-branch push.
H2. Source-only test runner originally emitted baseline evidence under `artifacts/CORE_ACCEPTANCE/T2/`; moved unchanged into `source-only-evidence/`. Its embedded attachment paths retain original output prefix.
H3. Committed evidence allowlist: this README plus `final-gates.json`, `extra-gates.json`, `baseline-format.json`, `source-sha256.json`, `changed-files.json`, `diff-summary.json`, `installed-evidence.json`. Scan found no secret/PII/private payload; installed evidence contains only refs, digests, lengths, job/progress/receipt metadata.
H4. Logs, Playwright reports, traces, screenshots/videos, graph output, other diagnostics remain local/untracked. Download/cache/generated payload bytes excluded. Local evidence links intentionally need this acceptance workspace; no acquired payload publication.
