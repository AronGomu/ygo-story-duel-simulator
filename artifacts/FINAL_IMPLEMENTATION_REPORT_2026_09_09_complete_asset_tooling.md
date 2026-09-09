# Complete asset tooling — implementation report

State: **blocked at T2 Git publication boundary**. T1 pushed; T2 implemented, independently reviewed, migrated and merged locally (`f145921`). T3–T6 not implemented. Last verified remote `main`: `6d739d3644b13fe25a20c531d8470497bc32c3b7`. No R2 writes.

## Ticket State List

| ID | State | Evidence |
| --- | --- | --- |
| T1 | Implemented; independently reviewed; merged and pushed | Impl `5d0bda8`; integration `f154a59`; 57 contract tests pass |
| T2 | Implemented; independently reviewed; merged locally; push pending | Impl `28c6a69`, cutover `0765665`, merge `f145921`; merged-main 94 tests pass; all ten findings closed |
| T3 | Ready after T2 publication checkpoint | Deterministic producer not implemented; exact scan/lock/root-map seam added to T3 ticket |
| T4 | Waiting for T3 | Publisher/remote prune not implemented; T1 approval seam recorded below |
| T5 | Waiting for T3 | Anonymous install/local prune not implemented |
| T6 | Waiting for T4/T5 | Cross-platform/PWA handoff acceptance not executed |

## Evidence

| ID | Command / inspection | Observed result |
| --- | --- | --- |
| E1 | `node --version` | `v24.18.0` |
| E2 | `npm view @aws-sdk/client-s3@3.1128.0 version`; equivalent lib-storage query | Both `3.1128.0`; exact pins installed successfully |
| E3 | `npm ci` | Exit 0 in worktree; exit 0 in merged main checkout |
| E4 | `node --test tests/asset-delivery-contracts.test.ts` | Final isolated and merged-main runs: 57 passed, zero failed |
| E5 | `npm test` | Final isolated post-fix run exit 0; legacy/unit/perf/component/integration suites pass |
| E6 | `npm run typecheck` | Final isolated post-fix run exit 0; zero errors, one existing CSS warning |
| E7 | `npm run build` | Final isolated post-fix run exit 0; build verifier confirms 451 runtime files and chunk budgets |
| E8 | `npm run vendor:verify` | Final isolated post-fix run exit 0; all 21 frozen files verified |
| E9 | `npx tsc --noEmit`; `npm run lint`; `npm run format:check`; `git diff --check` | Exit 0 after final repair |
| E10 | `npm run assets:setup -- --help` | Exit 0; documented read-only CLI |
| E11 | Actual-root `assets:setup -- --check` before owner config exists | Expected exit 2: `{"status":"failed","code":"ASSET_REFERENCE_MISSING","path":"asset-delivery.config.json"}`; fixture happy-path CLI passes |
| E12 | ZIP fixture under UTC/Pacific-Honolulu | Identical bytes; STORE, fixed DOS date, streaming options; not large-file/cross-OS proof |
| E13 | Secret-pattern scan of all 44 intentional paths | Zero matches before staging; no credentials staged |
| E14 | Original tracked dirty diff comparison after merge | All original added/removed lines preserved across eight paths; only expected hunk offsets/base hashes changed |
| E15 | `graphify . --update` | Exit 0; 11,753 nodes, 30,421 edges; graph output not staged |

Initial worktree full checks failed because ignored generated prerequisites were absent. Parent copied existing generated inputs into isolated checkout, reran successfully. Missing generated inputs are resolved local-validation history, not remaining blocker. Full-suite evidence comes from isolated committed candidate; merged-main targeted suite separately passed. Existing dirty main docs/config were not included in isolated full-suite validation.

## Review disposition

Three fresh-context reviewers covered Q1–Q12: code, contracts, data integrity, tests, security, concurrency, observability, boundaries, helper reuse, dependencies, browser exclusion, performance. Independent reconciliation plus focused release-fault recheck closed every finding.

| ID | Finding | Disposition |
| --- | --- | --- |
| F1 | Protocol-defined sorted sets accepted permutations | Closed: strict sorted-set guards; permutation regressions |
| F2 | Unicode case aliases bypassed collision guard | Closed: normalized caseless keys; file/parent alias regressions |
| F3 | ENOSPC misclassified during lock acquisition/release | Closed: expected `ASSET_DISK_FULL`, exit 2; fault-injected creation/release tests preserve busy lock and successful owner retry |
| F4 | Missing malformed/oversized remote metadata and origin-limit coverage | Closed: boundary/cancellation/no-later-probe tests |
| F5 | Canonical JSON enforced byte cap after oversized allocation | Closed: cumulative UTF-8/escaping/delimiter/LF budget before large output allocation |

No remaining T1 review blockers. Six existing npm advisories remain unchanged: three moderate, three high, affecting pre-existing Vitest/sharp/Miniflare/Wrangler dependencies. No advisory delta attributable to new SDK packages. No unrelated audit fix performed.

## T2 review checkpoint

Four independent reviewers inspected initial 97-path candidate; two independent repair reviewers and focused native-error closure verified final 103-path candidate (Git reports 98 paths after recognizing five renames). All ten findings closed: observed-root disappearance, file disappearance classification, cycle-test masking, crash-temp inclusion, empty-directory aliases, temp path limits, nullish CLI throws, oversized promotion comparison, quadratic rule diff, native-copy partial-temp deletion. Reviewer probes used fixtures; no user-source mutation.

Final isolated round2: focused 94/94, headless/full tests/build/profile check pass, Dev Vite 1/1, Chromium URL/Worker smoke 2/2, acceptance 41/41. Independent native Linux EFBIG repro confirms 1,024 partial bytes retained, original 16,384 bytes unchanged, pending marker blocks scan/writers/retry. Bounded 1 MiB handle copy replaces native copyFile, handles short writes/zero progress, retains identity/hash guards. Partial recovery intentionally takes precedence over underlying disk/write error. No cross-OS/power-loss proof inferred.

Merged-main parent checks: contracts/profiles 94/94; `assets:profiles:sync -- --check`, `typecheck`, `build` exit 0. Parent acceptance also passed 41/41 before final repairs; final worker acceptance rerun passed. Full-browser six failures have paired baseline evidence under A10, not green claims. Round1 full-test first attempt hit unchanged `FreePlayMatchSetup.test.ts` remembered-deck assertion; unchanged retry passed. Final round2 gates pass; no first-attempt uniform-green claim.

## Files / integration

I1. Impl `5d0bda8`: 44 intentional paths. Node-only setup CLI, focused delivery schemas/path/canonical/lock/scope helpers, 57 contract tests/fixtures, SDK pins/lockfile, browser import guards, setup/root-inventory docs, README/glossary links. No app-domain source, frozen vendor, feedback or asset-byte changes.

I2. Main `38c3fa0` stages only four added documentation lines, preserving pre-existing owner drafts. Main merge `f154a59` integrates T1 without staging those drafts. Branch `feat/asset-tooling-t1` retained; no history rewrite.

I3. Plan index and T1 state updated locally; T4 receives explicit approval-hashing handoff. Existing untracked planning inputs remain untracked, preserved rather than swept into implementation commits. This report is committed separately as current checkpoint, not a claim that all tickets shipped.

I4. T2 main migration plan/apply: 15,239 files, 2,441,078,977 bytes; plan SHA `56f57fc9e100a2c8e16450635788099908d6da0e434e85d9a5354fff33e5169c`. Parent independently rehashed every destination and retained original after integration: 15,239 destinations verified, 15,234 legacy originals preserved, five tracked font/SVG/provenance relocations verified. No upstream acquisition or old generated-source deletion.

I5. First main migration command exceeded 600-second tool deadline at file index 13,551. Process confirmed exited; pending temp full size/SHA/inode/birthtime matched. Parent removed only that run's exact verified stale lock, retried same plan, completed successfully. No partial/unknown temp deleted. No consumer cutover until completed receipt. This real interruption supplements fixture recovery evidence.

I6. Main `0765665` stages only T2 ignore/doc deltas and five hash-verified VCS moves; merge `f145921` brings remaining tooling. Original eight dirty owner paths retain all original added/removed lines. T2 changes no dependency lockfile, frozen vendor, browser engine loader or user feedback. Main graph update exits 0; generated graph not staged.

## Assumptions

### A1. Preserve existing work

Initial checkout contained eight modified tracked paths plus untracked plans/ADRs/feedback/artifacts. Worktree started at `7a2538f`; original dirty added/removed lines survived integration. No stash, reset, broad staging or unrelated cleanup.

### A2. Offline fixture implementation

Code work does not require owner accounts, credentials, rights attestations or real R2 writes. Missing owner setup remains pending, never invented. Real upload, paid provisioning and destructive pruning remain unauthorized.

### A3. Review ownership

Worker ran installed ship production/headless workflow; parent owned independent reviewers. Initial plan challenge was inline fallback, not independent. Code review/reconciliation was independently isolated. All five findings received real red/green evidence and independent closure.

### A4. Git publication boundary

Developer rule G3 requires stop before outward-facing publication. User confirmed T1 push; normal `git push origin main` succeeded, remote SHA verified. T2 resumed after that checkpoint. T2 now merged locally; its new checkpoint push awaits confirmation. No PR requested or created; no authorization for R2 writes inferred.

### A5. Approval evidence seam

T1 `checkPublicationScope(approval, target, sources)` is pure source-scope validation. T4 must verify actual evidence-file bytes/SHA before first upload; separately cover new/retained inventories and frozen vendor; integrate binding `verifyPublicationApproval` contract. Pure scope success does not verify disk evidence or grant legal permission.

### A6. Least-privilege CORS probes

Approved repeatable `--origin <exact-origin>` for `--remote`, requiring at least one origin. Bucket-scoped credentials use bounded HeadBucket/ListObjectsV2 plus anonymous CORS probes; no admin GetBucketCors. Frozen JSON config shape unchanged. Supplied origin list is not proof of completeness.

### A7. Isolated generated inputs

Parent copied existing generated assets/runtime/engine/card-images/set-images using no-clobber reflink-capable copy solely for worktree validation. Original asset bytes unchanged. These ignored copies are disposable; impl lives in Git.

### A8. Migration no-clobber publication

T2 migration uses independent same-directory temp copy, source/destination recheck, exclusive `link(temp,destination)`, then unlink of its own temp. Node rename lacks portable no-replace semantics; exclusive link prevents overwriting a destination created concurrently. Never hardlink original source. EEXIST permits identical-byte adoption only; differing originals fail. Filesystems lacking hardlink support fail closed, no unsafe rename fallback. Promotion still atomically replaces only its reviewed profile. Cross-platform filesystem acceptance remains explicit.

### A9. Optional media stays optional

T2 initially expanded chapter gameplay IDs into exact art rules, inventing 1,596 missing mandatory references. Corrected initial profile to extant selected media only, without changing gameplay metadata or acquiring artwork. Future unclassified art remains dev-only until explicit promotion. Declared existing file deletion still fails profile check. Actual corrected profile check exits 0.

### A10. Paired browser baseline

T2 full browser run reports six failures: deck grid width (`Expected: 617`, `Received: 420`) plus five viewport variants waiting for `[data-cy="story-shop-sell-plus-89631139"]` (`Error: locator.click: Test timeout of 180000ms exceeded.`). Parent reran those exact six tests at original main `6d739d3`; all six fail identically. Command: `PLAYWRIGHT_PORT=4398 npx playwright test --grep 'free-play deck grid adds columns|T13 all story surfaces fit' --workers=6 --fully-parallel`, exit 1. Initial full baseline exceeded 600-second command deadline; parent terminated only its orphan preview processes, then completed focused baseline. Unrelated roster/layout defects not fixed; full browser suite not claimed green.

## User TODO

- [x] U1. Confirm T1 `git push origin main`; user confirmed, push succeeded, `git ls-remote origin refs/heads/main` returned `6d739d3644b13fe25a20c531d8470497bc32c3b7`. T2 resumed. Later publication boundaries remain explicit.
- [ ] U2. Complete owner-only Node/Git/npm, R2 activation/payment if required, Standard bucket, custom domain, exact dev/prod CORS origins and scoped credential setup. Validation: owner runs read-only setup with actual origins; no credential values recorded.
- [ ] U3. Supply explicit publication eligibility/evidence and budget acknowledgment covering public originals/unreleased assets, dev/prod copies, immutable releases and nightly overlap. Validation: future publisher verifies scope and evidence hashes before upload; approval not inferred from gameplay readiness.
- [ ] U4. Bootstrap initial empty PublicationInventory only for confirmed new namespace, using create-only owner-run instructions in `docs/assets/asset-delivery-setup.md`. Validation: anonymous verified empty state; existing history never overwritten.
- [ ] U5. Provide authorized hosted, native-device, cross-OS and >4GiB/10GB acceptance when respective later tickets are ready. Validation: actual evidence; small fixtures never substituted for large/native proof.

- [ ] U6. Confirm T2 checkpoint `git push origin main` before continuing T3–T6. Validation: normal push reaches reviewed checkpoint; no force push.
- [ ] U7. Review retained legacy generated assets only if disk cleanup is desired. Validation: approved exact old-source cleanup after hash verification; agents have deleted none.

## Cleanup

C1. Final plan retirement not due: T3–T6 incomplete. Plan index, matching ticket directory and original plan HTML retained.

C2. Removed clean worktree `.tmp/asset-tooling-t1` (including agent ledgers/logs and copied validation inputs). Removed parent-owned `.tmp/t1-doc-integration.patch`, `.tmp/asset-tooling-original-dirty.patch`, `.tmp/t1-review-correctness.md`, `.tmp/t1-review-security.md`, `.tmp/t1-review-maintenance.md`, `.tmp/t1-review-final.md`, `.tmp/t1-main-npm-ci.log`, `.tmp/t1-main-contracts.log`, `.tmp/t1-graph-update.log`. Evidence consolidated above; implementation retained in commits/branch. No user-authored or unrelated files deleted. Harness-managed external session logs remain outside project cleanup.

C3. Removed clean T2 worktree `.tmp/asset-tooling-t2`, including owned ledgers, logs and copied inputs. Removed `.tmp/` files: `t2-draft-integration.patch`, `t2-graph-update.log`, `t2-main-build.log`, `t2-main-profile-check.log`, `t2-main-targeted.log`, `t2-main-typecheck.log`, `t2-original-browser-baseline.log`, `t2-original-browser-focused.log`, `t2-original-dirty.patch`, `t2-recheck-contracts.md`, `t2-recheck-security.md`, `t2-review-contracts.md`, `t2-review-integration.md`, `t2-review-maintenance.md`, `t2-review-security.md`. Main operational migration plan/receipt retained under `generated/asset-delivery/`; Git feature branch retained. No user/unrelated scratch selected.
