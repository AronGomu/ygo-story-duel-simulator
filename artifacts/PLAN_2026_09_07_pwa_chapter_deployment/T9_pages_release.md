# T9: Assemble retained Pages candidate and manual publish workflow

**Plan context:** Self-contained historical PWA chapter deployment ticket.
**Depends:** T7, T8
**Commit outcome:** Verified reproducible public candidate preserves immutable history and stops before gated human-triggered Pages publication.

## Asset tooling handoff amendment

H1. Pages serves core shell only. New asset tooling T4 publishes immutable content/core objects plus release closures to R2 before protected Pages deployment; this ticket must not copy content ZIPs, catalogs, manifests or retained closures into Pages.
H2. `build:pwa -- --asset-snapshot <sha>` consumes T6 CoreCopyPlan plus the exact snapshot `prod.index`, injecting `__CONTENT_BASE_URL__` and `__CONTENT_INDEX_SHA256__`. Pages verification checks these pins without regenerating or uploading R2 objects.
H3. R2 release retention, channel inventory and rollback are owned by new asset tooling T4. This ticket retains human authorization, Pages protection, core limits and shell verification. Owner amendment remains binding: chapter-01 only.

## Context (self-contained)

C1. Goal: One installable PWA; core UI automatic, runtime/chapter ZIPs manually downloaded inside game; Cloudflare Pages Free static-only. Full-catalog default-AI freeplay follows verified runtime; chapter entry additionally needs installed cumulative content and save-owned progression.
C2. This slice: Packaging/distribution is part of deployment pipeline, not an external ZIP website. This ticket assembles/verifies workflow and candidate; it does not authorize public upload. Existing private workflow edits remain untouched except intentional integration lines.
C3. Out of scope: Frozen vendor/engine loader unchanged. No credentials, account creation or public publish without explicit human action. No feedback edits, paid backend, native wrapper, no-AI mode, automatic artwork fetching, or six invented chapters.
C4. Assumptions: owner mapping/permission/host/device evidence is explicit setup input, not guessed. Public availability is not legal clearance. New paths below are planned, not implemented. One writer in this cwd.

## Requirements

R1. Assemble `generated/deploy/current` from verified PWA core only. Do not copy R2 content indexes/catalogs/manifests/ZIPs, raw archives, author source JSON, credentials, test harness or private-only markers into Pages.
R2. Emit a core-shell ReleaseInventory for Pages files only. R2 `PublicationInventory` and immutable release closures remain T4 outputs and are verified by their published object refs, not duplicated in Pages.
R3. Resolve the exact published R2 BundleSnapshot selected for this app release and verify its `prod.inventory`, `prod.core` and `prod.index`. Missing history/object/network evidence fails closed; Pages never reconstructs or merges retained content bytes.
R4. Derive production origin from validated CLOUDFLARE_PAGES_PROJECT under pages.dev, no arbitrary remote URL or credentials. CI cache/artifact alone is not lifetime retention; if history cannot be reconstructed safely, fail before publish.
R5. Enforce <=20,000 final Pages files and <=25 MiB each across core shell/icons/manifests. External R2 objects are excluded from Pages counts and verified separately. No automatic pruning, fallback, Functions or paid Workers.
R6. Public eligibility requires owner-reviewed DistributionEvidence/source obligations and automated candidate checks plus recorded device-access attestation; copying assets to ZIP never bypasses legacy redistribution policy. Do not replace false literal by true as a shortcut. Synthetic fixtures only verify pipeline behavior.
R7. Create manual workflow_dispatch deploy-pages.yml, protected production environment, concurrency group pages-production cancel-in-progress:false. Inputs are immutable committed revision; no PR/fork secrets. Human approval/dispatch remains explicit; plan/agent never invokes it unasked.
R8. Workflow runs npm ci, source/setup checks, verifies the already-published immutable R2 snapshot/index, stages its exact core plan, runs build:pwa, core-only assembly, release:verify and existing gates. R2 publication is a prior protected action, not repeated by Pages. Credential values never echo. Retain required license/source-provenance artifacts.
R9. Verify deployment reversibility constraints without rewriting history: a subsequent corrective release retains content; no git reset/force push/tag deletion or automatic Pages rollback. Failed upload/network retry bounded; protected/auth rejection stops for owner.
R10. Exact predeploy predicate: approved source/rights evidence AND valid host setup AND device-access attestation AND automated candidate checks AND explicit human authorization. Current-release T10 native results are excluded; those gate final acceptance after deployment, not bootstrap eligibility.
R11. Build order is binding: new T4 publishes/verifies R2 snapshot first; `stageCoreAssets` fetches exact `prod.inventory`/`prod.core`; `npm run build:pwa -- --asset-snapshot <sha>` consumes its CoreCopyPlan and pins `prod.index` plus content base URL; `release:assemble` copies core shell only; `release:verify` compares snapshot/index/base pins, SW core precache and Pages inventory. Any mismatch blocks Pages publish.

## Inputs

F1. `.github/workflows/ci.yml (dirty existing file; preserve unrelated changes)`
F2. `content/distribution-evidence.json; content/chapter-selections.json`
F3. `generated/content/current/content/**; PWA core from T8`
F4. `scripts/verify-browser-build.ts; scripts/lib/vite-runtime-assets.ts`
F5. `https://developers.cloudflare.com/pages/platform/limits/`
F6. `https://developers.cloudflare.com/pages/functions/pricing/`

**From Depends:** T7 completes actual ContentManager lifecycle and old-ref reinstall semantics. T8 supplies core-only PWA build/lifecycle. T2 supplies deterministic immutable content artifacts; T1 supplies recorded public/host prerequisites. Real native acceptance after human deployment is T10, not fabricated here.

## Interface contract (level 5)

I1. npm run release:assemble; npm run release:verify. Output generated/deploy/current and generated/content/release-verification.json. ReleaseSourceLock JSON {schemaVersion:1,bootstrap:boolean,previousInventorySha256:string|null}; bootstrap iff null, explicit first-release owner verdict. Required env CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID; variable CLOUDFLARE_PAGES_PROJECT. Proposed verified human command: npx wrangler pages deploy generated/deploy/current --project-name "$CLOUDFLARE_PAGES_PROJECT" --branch main. No command run by this ticket without separate user authorization. CLI/release failure codes (not ContentFailureCode): CONTENT_HISTORY_UNAVAILABLE, CONTENT_HISTORY_MISMATCH, CONTENT_SITE_LIMIT, CONTENT_PUBLICATION_BLOCKED; exit 2 precondition/verification fail, 1 unexpected, 0 verified. Inventory never self-hashes and never trusts mutable prior index without pinned inventory digest.

**Produces — exact declarations:**

```ts
export type Sha256 = string;

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

export type ChapterRelease =
  | {
      readonly id: ChapterId;
      readonly title: string;
      readonly status: "unreleased";
    }
  | {
      readonly id: ChapterId;
      readonly title: string;
      readonly status: "published";
      readonly manifest: ManifestRef;
    };

export interface ContentIndex {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly runtimeSnapshotId: Sha256;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ChapterRelease[];
  readonly retainedCatalogs: readonly {
    readonly sha256: Sha256;
    readonly bytes: number;
  }[];
  readonly retainedManifests: readonly ManifestRef[];
}

export interface SetupReport {
  readonly schemaVersion: 1;
  readonly codeReady: boolean;
  readonly publishReady: boolean;
  readonly blockers: readonly {
    readonly code:
      | "OWNER_MAPPING_REQUIRED"
      | "SOURCE_COVERAGE_REQUIRED"
      | "LICENSE_EVIDENCE_REQUIRED"
      | "HOST_SETUP_REQUIRED"
      | "DEVICE_ACCESS_REQUIRED";
    readonly detail: string;
  }[];
}

export interface DistributionEvidence {
  readonly schemaVersion: 1;
  readonly status: "pending" | "approved";
  readonly sourceRevision: string;
  readonly engineSource: string | null;
  readonly scriptSource: string | null;
  readonly databaseTerms: string | null;
  readonly artPermission: string | null;
  readonly storyMediaPermission: string | null;
}

// T2: pure packaging kernel, reused by Node CLI and reproducibility tests.
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

Manual workflow_dispatch (MISSING until workflow added) → protected production approval → owner input/asset gates → package/build/history merge → release:verify JSON → explicit wrangler Pages deploy only after human authorization → HTTPS installed artifact. Observe inventory hashes, final file counts, gated workflow logs and owner-recorded deployment ID; no logged secrets. T10 needs resulting accessible HTTPS origin.

## Files owned by this slice

P1. `scripts/assemble-pages-release.ts`
P2. `scripts/verify-pages-release.ts`
P3. `scripts/lib/release-inventory.ts`
P4. `content/release-source-lock.json`
P5. `.github/workflows/deploy-pages.yml`
P6. `scripts/lib/vite-runtime-assets.ts`
P7. `scripts/verify-browser-build.ts`
P8. `package.json`
P9. `tests/unit/pages-release.test.ts`
P10. `tests/unit/deploy-workflow.test.ts`
P11. `scripts/restore-release-history.ts`

## TDD

D1. **Red** — add named tests below first; run focused command, capture expected assertion failures. No implementation before red evidence.
D2. **Green** — minimum implementation for those failures; re-run same command, capture success.
D3. **Refactor** — only if needed, only this slice; keep focused and boundary tests green.

## Test plan

| ID | Test | Input | Expect |
| --- | --- | --- | --- |
Q1 | missing history fails closed | non-bootstrap inventory 404/network failure | CONTENT_HISTORY_UNAVAILABLE; no empty-history publish |
Q2 | history tamper | wrong prior inventory digest or object SHA | CONTENT_HISTORY_MISMATCH |
Q3 | retained save bytes survive | two prior content versions, new release | all old immutable objects retained byte-identically |
Q4 | host bounds after merge | large retained inventory/file over cap | CONTENT_SITE_LIMIT before publish |
Q5 | no licensing bypass | pending DistributionEvidence, ZIP contains real art | CONTENT_PUBLICATION_BLOCKED |
Q6 | workflow scope safe | fork/PR invocation or absent approved env | no deploy/secrets step |
Q7 | no raw huge archive | complete candidate | only ZIP content paths, core and required provenance; no raw art subtree |
Q8 | bootstrap avoids circular native gate | approved rights/host/access/automated checks + human authorization; native current-release pending | deploy eligible; final acceptance pending |
Q9 | second release pin coherence | old retained catalogs plus new chapter release | served/index filename/injected pin/precache/inventory all identical SHA; old refs discoverable |

## Impl steps

- [ ] A1. Write failing retained-history, public gate, final-cap and workflow tests; verify red.
- [ ] A2. Implement pinned history inventory/merge and candidate assembly; verify immutable bytes retained and missing history blocks.
- [ ] A3. Add public eligibility/final site verifier and manual protected workflow; verify no automatic dispatch/publish path.
- [ ] A4. Run local lawful-fixture candidate and full checks; leave real publish marked blocked until owner evidence/authorization, not done by implication.

## Validation

- [ ] V1. Run `npx vitest run tests/unit/pages-release.test.ts tests/unit/deploy-workflow.test.ts`; capture actual output, not predicted success.
- [ ] V2. Run `npm run release:history`; capture actual output, not predicted success.
- [ ] V3. Run `npm run content:catalog`; capture actual output, not predicted success.
- [ ] V4. Run `npm run content:pack -- --retained-metadata generated/content/history/retained-metadata.json`; capture actual output, not predicted success.
- [ ] V5. Run `npm run content:verify`; capture actual output, not predicted success.
- [ ] V6. Run `npm run build:pwa`; capture actual output, not predicted success.
- [ ] V7. Run `npm run release:assemble`; capture actual output, not predicted success.
- [ ] V8. Run `npm run release:verify`; capture actual output, not predicted success.
- [ ] V9. Run `npm run check:headless`; capture actual output, not predicted success.
- [ ] V10. Run `npm run check:browser`; capture actual output, not predicted success.
- [ ] V11. Manual: Owner reviews candidate inventory/rights/setup. Separate non-ticket gate: owner explicitly dispatches protected workflow or runs printed publish command. Do not mark deployed on local build evidence.
- [ ] V12. No silent failure on added paths: inventory `|| true`, empty catches, suppressed stderr, fire-and-forget; expected retained sites `none`, or document exact justified site.
- [ ] V13. App functional: focused behavior above plus existing relevant regressions green. Any absent external gate remains blocked, never checked off.
- [ ] V14. Confirm no unrelated/feedback/vendor edits, no secrets/staging/publish; `git diff --stat` and intentional-path diff reviewed.
- [ ] V15. Commit message draft reviewed: `feat(deploy): verify retained static releases before public upload`. No commit implied or requested by this plan.
