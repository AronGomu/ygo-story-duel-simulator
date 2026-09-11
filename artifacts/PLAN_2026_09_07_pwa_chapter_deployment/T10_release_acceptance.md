# T10: Prove native hosted behavior and document operations

**Plan context:** Self-contained historical PWA chapter deployment ticket.
**Depends:** T9
**Commit outcome:** Release acceptance records real cross-platform install/offline/resume evidence, public gates and recovery guidance without overstating emulation.

## Asset tooling handoff amendment

H1. Add hosted cross-origin R2 assertions: exact custom-domain CORS, immutable index/catalog/manifest/part URLs, rejected redirects, wrong SHA/length, and expired nightly 404/410 mapped to existing ContentFailureCode values.
H2. Verify Pages serves core shell only while the built app pins `__CONTENT_BASE_URL__`, `__CONTENT_INDEX_SHA256__` and the matching CoreCopyPlan snapshot. Release-A save reinstall under release-B shell must resolve retained immutable R2 refs without rewriting save refs.
H3. New asset tooling T6 fixture evidence covers transport contract only. Native installer/device acceptance remains mandatory here after old T3–T8 and owner-authorized deployment exist. Owner amendment remains binding: chapter-01 only.

## Context (self-contained)

C1. Goal: One installable PWA; core UI automatic, runtime/chapter ZIPs manually downloaded inside game; Cloudflare Pages Free static-only. Full-catalog default-AI freeplay follows verified runtime; chapter entry additionally needs installed cumulative content and save-owned progression.
C2. This slice: Final evidence slice. Local automated tests can run before deployment; native hosted acceptance requires owner-authorized HTTPS deployment plus real devices. No public-ready claim if prerequisites remain absent. Existing playwright.pwa.config.ts/fixture server are T8 outputs; this slice consumes them, never creates an earlier prerequisite retroactively.
C3. Out of scope: Frozen vendor/engine loader unchanged. No credentials, account creation or public publish without explicit human action. No feedback edits, paid backend, native wrapper, no-AI mode, automatic artwork fetching, or six invented chapters.
C4. Assumptions: owner mapping/permission/host/device evidence is explicit setup input, not guessed. Public availability is not legal clearance. New paths below are planned, not implemented. One writer in this cwd.

## Requirements

R1. Run automated root/subpath Chromium and desktop WebKit coverage against production-format lawful Pages-core plus cross-origin R2 fixtures; do not label desktop WebKit as native iOS installed-PWA proof.
R2. After separate human-authorized gated deploy, record installed desktop Chromium, Android Chrome, iPhone Safari and iPad Safari evidence with OS/browser versions/date/releaseId. User-supplied device access was frontloaded T1; absent device is blocked acceptance, not skipped pass.
R3. Prove fresh core-only install, manual chapter-01 runtime/readiness, supported-card missing-art placeholders, runtime-then-chapter-01 queue ordering, pause/kill/reopen/manual Resume, chapter entry presence checks, hash-on-use corruption handling, quota refusal and no hidden-card reads.
R4. Prove save exact-ref behavior: old compatible version retained, explicit media removal leaves envelope/deck bytes unchanged, exact reinstall resumes; failed/mixed update and cross-tab removal cannot damage active sessions.
R5. Prove SW update waits for all old clients, core-only cache, offline root/subpath navigation, cross-origin R2 content miss never returns Pages HTML, and shell install does not cache bulk content. Report actual download/extracted/staging/memory measurements; no claims based on initial disk du.
R6. Update durable docs/deployment/pwa-content.md, applicable architecture pages and artifacts/manual_test_checklist.md with real operating/recovery steps. Keep durable docs free of ephemeral links; cite implementation commits once known, never invent SHA.
R7. Preserve publication/source gate. Tests against local placeholders/fixtures do not clear real asset rights. Never auto-dispatch deploy, purchase plans, remove old content, delete saves or rewrite git history during acceptance.

## Inputs

F1. `generated/content/release-verification.json; generated/deploy/current/content/release-inventory.json`
F2. `T9 owner-recorded HTTPS deployment and public eligibility evidence`
F3. `e2e/content-downloads.spec.ts; e2e/content-lifecycle.spec.ts; e2e/pwa-lifecycle.spec.ts; e2e/installed-art.spec.ts`
F4. `artifacts/manual_test_checklist.md; docs/architecture/02-runtime/browser-platform.md; docs/architecture/04-data/`
F5. `docs/ADR/075_ADR_static_pwa_chapter_zip_delivery.md through 080_ADR_retained_public_release_inventory.md (planned decisions)`

**From Depends:** T9 produces verified candidate, ReleaseVerification and ReleaseInventory plus manual protected workflow. Additional external gates: real permission/source verdict, owner-authorized successful deploy, native device access. Candidate generation alone never satisfies these gates.

## Interface contract (level 5)

I1. Acceptance report JSON schemaVersion:1, releaseId:string, automated:{command:string,result:"passed"|"failed"|"blocked"}[], devices:{platform:"desktop-chromium"|"android-chrome"|"iphone-safari"|"ipad-safari",osVersion:string,browserVersion:string,result:"passed"|"failed"|"blocked",evidence:string[]}[], blockers:string[]. Output artifacts/pwa-release-acceptance/<releaseId>/report.json and evidence files. Unknown version/device/result cannot become passed. Local/native stages separately labeled; blocked external gate prevents final acceptance.

**Produces — exact declarations:**

I2. Acceptance JSON shape is specified in I1; evidence-only slice, no new app API.

**Consumes — binding predecessor declarations:**

```ts
export type ChapterId =
  | "chapter-01"
  | "chapter-02"
  | "chapter-03"
  | "chapter-04"
  | "chapter-05"
  | "chapter-06"
  | "chapter-07";

/** Runtime parser requires lowercase 64-character SHA-256 hex. */

export type Sha256 = string;

export type PackId = "runtime" | ChapterId;

export interface ManifestRef {
  readonly packId: PackId;
  readonly sha256: Sha256;
  readonly bytes: number;
}

export interface RuntimeSnapshotRef {
  readonly activationId: Sha256;
  readonly runtimeSnapshotId: Sha256;
  readonly runtimeManifestSha256: Sha256;
  readonly releaseCatalogSha256: Sha256;
}

export interface ContentSetRef {
  readonly catalogSha256: Sha256;
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ManifestRef[];
}

export type PwaStatus =
  | { readonly kind: "unsupported" }
  | { readonly kind: "setting-up" }
  | { readonly kind: "offline-ready"; readonly install: "prompt" | "instructions" | "installed" }
  | { readonly kind: "update-waiting" }
  | { readonly kind: "failed"; readonly message: string };

// T9: retained content history and immutable release verification.

export interface ReleaseInventory {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly currentCatalogSha256: Sha256;
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: Sha256;
  }[];
}

export interface ReleaseVerification {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly publishReady: boolean;
  readonly siteFiles: number;
  readonly largestFileBytes: number;
  readonly retainedFiles: number;
  readonly failures: readonly string[];
}
```

**Invariants / errors:**

I4. No network side effect from content reads; no image readiness determining legality; no save/progress mutation from download. All normal failure paths surface typed result/code and exact error copy. Frozen vendor verification stays required.
I5. Exact runtime UI copy follows. CLI-only setup/packaging/release failures remain separately specified, never silently added to ContentFailureCode. Missing integration/source facts are MISSING, not claimed implemented.

| Code | Exact UI message |
| --- | --- |
| `CONTENT_INVALID_MANIFEST` | `Content manifest is invalid.` |
| `CONTENT_INCOMPATIBLE` | `This content is incompatible with this game version.` |
| `CONTENT_NOT_PUBLISHED` | `This chapter has not been released.` |
| `CONTENT_NETWORK_FAILED` | `Content download failed. Choose Resume to retry.` |
| `CONTENT_REVISION_UNAVAILABLE` | `This content revision is unavailable.` |
| `CONTENT_INTEGRITY_FAILED` | `Content verification failed.` |
| `CONTENT_ARCHIVE_REJECTED` | `Content archive is invalid.` |
| `CONTENT_QUOTA_EXCEEDED` | `Not enough storage.` |
| `CONTENT_STORAGE_UNAVAILABLE` | `Offline content storage is unavailable.` |
| `CONTENT_BUSY` | `Another game window is downloading content.` |
| `CONTENT_ACTIVATION_CONFLICT` | `Installed content changed in another window. Refresh the download list.` |
| `CONTENT_DEPENDANTS_INSTALLED` | `Remove newer chapters first.` |
| `CONTENT_IN_USE` | `This content is in use. Return all game windows to the main menu first.` |
| `CONTENT_MISSING` | `Required content is missing.` |


**Integration links:**

Owner-authorized deployed HTTPS origin → actual device browser install UI → installed app → explicit Download/Resume/Remove/Update flows → offline/reopen/save checks → versioned acceptance report. NEW native observation links MISSING until evidence captured; Playwright emulation is not substitute.

## Files owned by this slice

P1. `e2e/pwa-release-acceptance.spec.ts`
P2. `playwright.pwa.config.ts`
P3. `tests/fixtures/content/`
P4. `docs/deployment/pwa-content.md`
P5. `docs/architecture/02-runtime/browser-platform.md`
P6. `docs/architecture/04-data/card-images.md`
P7. `docs/architecture/04-data/browser-storage.md`
P8. `docs/architecture/04-data/asset-snapshots.md`
P9. `artifacts/manual_test_checklist.md`

## TDD

D1. **Red** — add named tests below first; run focused command, capture expected assertion failures. No implementation before red evidence.
D2. **Green** — minimum implementation for those failures; re-run same command, capture success.
D3. **Refactor** — only if needed, only this slice; keep focused and boundary tests green.

## Test plan

| ID | Test | Input | Expect |
| --- | --- | --- | --- |
Q1 | core install no bulk transfer | fresh installed app, no download click | only core cache; no runtime/art/ZIP request |
Q2 | native interrupted install | background/kill mobile app mid-part | reopen paused; valid checkpoints retained; Resume explicit |
Q3 | freeplay before art | runtime ready, chapter part pending | default AI/all supported cards; placeholder art |
Q4 | save restore exact version | remove media for old compatible save then reinstall | unchanged save resumes |
Q5 | old window blocks update | two old clients, new shell available | no takeover; closes/reopen activates |
Q6 | acceptance honest | missing native iPad evidence or rights | blocked report, not passed |
Q7 | persistence denied with capacity | persist() false; enough storage | durability warning; installation allowed |
Q8 | quota genuinely exhausted | estimate insufficient or cache write quota failure | CONTENT_QUOTA_EXCEEDED; existing playable content preserved |

## Impl steps

- [ ] A1. Write failing end-to-end acceptance assertions for missing network/receipt/save/update guarantees using fixture builds; record red.
- [ ] A2. Run complete automated production-format gates and repair only in-scope regressions; verify final green command outputs.
- [ ] A3. After human-authorized deploy, execute native device matrix and record actual versions/screens/requests; mark missing external evidence blocked immediately.
- [ ] A4. Update operator docs and durable manual checklist from real evidence; verify no ephemeral links in docs and no unproven checkboxes.

## Validation

- [ ] V1. Run `npm run check:headless`; capture actual output, not predicted success.
- [ ] V2. Run `npm run check:browser`; capture actual output, not predicted success.
- [ ] V3. Run `npx playwright test -c playwright.pwa.config.ts`; capture actual output, not predicted success.
- [ ] V4. Run `npm run content:verify`; capture actual output, not predicted success.
- [ ] V5. Run `npm run release:verify`; capture actual output, not predicted success.
- [ ] V6. Manual: Native device matrix is mandatory. Publication/device inputs missing → report blocked with exact owner action; never infer success from desktop emulation.
- [ ] V7. No silent failure on added paths: inventory `|| true`, empty catches, suppressed stderr, fire-and-forget; expected retained sites `none`, or document exact justified site.
- [ ] V8. App functional: focused behavior above plus existing relevant regressions green. Any absent external gate remains blocked, never checked off.
- [ ] V9. Confirm no unrelated/feedback/vendor edits, no secrets/staging/publish; `git diff --stat` and intentional-path diff reviewed.
- [ ] V10. Commit message draft reviewed: `test(pwa): prove offline recovery on supported installed clients`. No commit implied or requested by this plan.
