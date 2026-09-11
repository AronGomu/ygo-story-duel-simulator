# T8: Cache core UI and defer service-worker takeover

**Plan context:** Self-contained historical PWA chapter deployment ticket.
**Depends:** T3
**Commit outcome:** Core UI is installable/offline-ready; new shell waits for old clients to close without downloading runtime/art implicitly.

## Asset tooling handoff amendment

H1. `npm run build:pwa -- --asset-snapshot <sha>` first calls `stageCoreAssets` for that exact published BundleSnapshot. It consumes matching CoreCopyPlan, `prod.inventory`, `prod.core` and pinned `prod.index`; missing/mismatched refs fail without rereading current workspace assets.
H2. Build injects `__CONTENT_BASE_URL__` plus `__CONTENT_INDEX_SHA256__`. Startup resolves the immutable index through `contentObjectUrl`; no mutable nightly lookup occurs mid-session. Pages contains core shell only; runtime/chapter objects remain external R2 bytes and never enter SW precache.
H3. Remove PWA-path eager generated-runtime config evaluation and static chapter SVG import during this ticket. Existing private build stays available during migration. Owner amendment remains binding: chapter-01 only.

## Context (self-contained)

C1. Goal: One installable PWA; core UI automatic, runtime/chapter ZIPs manually downloaded inside game; Cloudflare Pages Free static-only. Full-catalog default-AI freeplay follows verified runtime; chapter entry additionally needs installed cumulative content and save-owned progression.
C2. This slice: Independent lifecycle branch after Downloads bootstrap. Automated browser lifecycle proof belongs here; native installation/quota acceptance belongs T10. PWA installation itself is not content installation.
C3. Out of scope: Frozen vendor/engine loader unchanged. No credentials, account creation or public publish without explicit human action. No feedback edits, paid backend, native wrapper, no-AI mode, automatic artwork fetching, or six invented chapters.
C4. Assumptions: owner mapping/permission/host/device evidence is explicit setup input, not guessed. Public availability is not legal clearance. New paths below are planned, not implemented. One writer in this cwd.

## Requirements

R1. Use vite-plugin-pwa injectManifest with project-owned typed SW under src/shell/pwa/service-worker.ts; content root stays non-UI. Core precache is an explicit allowlist of executable UI JS/CSS/HTML/fonts/icons from the verified CoreCopyPlan. Pinned content index and external runtime/chapter bytes remain R2 network objects, not shell precache entries.
R2. Exclude runtime files, chapter manifests/ZIPs, card art, set art, story media, source data and release history from precache. Do not recursively precache entire generated/deploy/current or dist. App code may contain small existing prototype logic; no bulk media.
R3. Add manifest/icons/install control under existing main-menu layout/data-cy contract. Chromium deferred prompt where available; iOS/iPadOS platform instructions through same entry. No universal one-click/install-success claim.
R4. PwaStatus offline-ready only after shell-cache integrity/controller setup succeeds. First uncontrolled visit cannot claim installed/offline-ready just because beforeinstallprompt or registration succeeded; safe initial setup/reload path before game work is permitted, never during duel/save/download.
R5. No skipWaiting or live clients.claim update takeover. Waiting SW stays waiting while old controlled game client exists. Show exact instruction to close all game windows/tabs, then reopen. New app validates pinned current/saved content refs; old shell cache cleanup never touches content caches.
R6. Navigation fallback base-safe for root and subpath; content paths must never receive index.html fallback. Online miss/corrupt content does not trigger network fallback through SW; content delivery remains explicit installer. Existing private test/build path remains unaffected unless PWA profile selected.
R7. Whole build ID must identify actual app build, not only unchanged runtime snapshot hash; use release CI commit identity for PWA shell cache/version. Same-runtime app-code update must be detected.
R8. Keep prefetch/menu warmup from requesting metadata/runtime before explicit manual install. Feature chunks may load as app code; no game data fetch allowed by hover/focus.
R9. Own playwright.pwa.config.ts and two-build fixture server now; reuse T3 production-format content harness, adding build:pwa and SW version switching. T10 consumes this existing harness.

## Inputs

F1. `vite.config.ts; package.json; index.html; src/main.ts`
F2. `src/shell/AppShell.svelte; src/shell/screens/MainMenuScreen.svelte`
F3. `src/shell/routes.ts; src/shell/domain-loaders.ts`
F4. `T3 Downloads bootstrap; published BundleSnapshot with prod.inventory/prod.core/prod.index; T6 stageCoreAssets`
F5. `tests/unit/domain-boundaries.test.ts; scripts/verify-browser-build.ts`

**From Depends:** T3 supplies installed content status/Downloads UI and manual-only acquisition. T2 index SHA pinned before Vite build; T1 supplies exact PWA/Workbox deps. SW must not replace installer/readiness source of truth.

## Interface contract (level 5)

I1. registerGamePwa(onStatus: (status:PwaStatus)=>void): Promise<ServiceWorkerRegistration | null>; caller handles rejection with failed status/log. Service-worker path <base>sw.js, scope <base>, manifest <base>manifest.webmanifest, start_url <base>, display standalone. Injected __WB_MANIFEST contains only allowlisted core assets. Shell cache ygo-shell-v1-<releaseId>. User copy update-waiting: "Update ready. Close all game windows, then reopen." Content HTTP paths excluded from SPA fallback. `build:pwa -- --asset-snapshot <sha>` consumes T6's verified CoreCopyPlan plus that snapshot's published prod index; T9 Pages assembly remains core-only.

**Produces — exact declarations:**

```ts
export type PwaStatus =
  | { readonly kind: "unsupported" }
  | { readonly kind: "setting-up" }
  | { readonly kind: "offline-ready"; readonly install: "prompt" | "instructions" | "installed" }
  | { readonly kind: "update-waiting" }
  | { readonly kind: "failed"; readonly message: string };

// T9: retained content history and immutable release verification.
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

export interface RuntimeSnapshotRef {
  readonly activationId: Sha256;
  readonly runtimeSnapshotId: Sha256;
  readonly runtimeManifestSha256: Sha256;
  readonly releaseCatalogSha256: Sha256;
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

export interface ContentSetRef {
  readonly catalogSha256: Sha256;
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ManifestRef[];
}

export type ContentFailureCode =
  | "CONTENT_INVALID_MANIFEST"
  | "CONTENT_INCOMPATIBLE"
  | "CONTENT_NOT_PUBLISHED"
  | "CONTENT_NETWORK_FAILED"
  | "CONTENT_REVISION_UNAVAILABLE"
  | "CONTENT_INTEGRITY_FAILED"
  | "CONTENT_ARCHIVE_REJECTED"
  | "CONTENT_QUOTA_EXCEEDED"
  | "CONTENT_STORAGE_UNAVAILABLE"
  | "CONTENT_BUSY"
  | "CONTENT_ACTIVATION_CONFLICT"
  | "CONTENT_DEPENDANTS_INSTALLED"
  | "CONTENT_IN_USE"
  | "CONTENT_MISSING";

export interface ContentFailure {
  readonly kind: "failed";
  readonly code: ContentFailureCode;
  readonly packId: PackId | null;
  readonly path: string | null;
}

export type ChapterReadiness =
  | { readonly kind: "unreleased"; readonly chapterId: ChapterId }
  | {
      readonly kind: "missing";
      readonly chapterId: ChapterId;
      readonly missingPacks: readonly PackId[];
    }
  | {
      readonly kind: "ready";
      readonly chapterId: ChapterId;
      readonly content: ContentSetRef;
    }
  | ContentFailure;

/** Domain owns save progression; content availability cannot grant completion. */
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

AppShell boot → registerGamePwa → serviceWorker.register(<base>sw.js,{scope:<base>}) → install precache verified allowlist → controller/cache readiness → PwaStatus. New SW install → waiting while old clients exist → owner closes clients → next navigation activates. Observe controller script/version, Cache Storage names, absence of chapter requests, uninterrupted old duel.

## Files owned by this slice

P1. `src/shell/pwa/service-worker.ts`
P2. `src/shell/pwa/register-pwa.ts`
P3. `src/shell/pwa/pwa-status.ts`
P4. `src/shell/screens/MainMenuScreen.svelte`
P5. `src/shell/AppShell.svelte`
P6. `vite.config.ts`
P7. `index.html`
P8. `scripts/lib/pwa-precache.ts`
P9. `tests/unit/pwa-precache.test.ts`
P10. `tests/component/PwaInstall.test.ts`
P11. `e2e/pwa-lifecycle.spec.ts`
P12. `playwright.pwa.config.ts`
P13. `scripts/serve-pwa-fixtures.ts`

## TDD

D1. **Red** — add named tests below first; run focused command, capture expected assertion failures. No implementation before red evidence.
D2. **Green** — minimum implementation for those failures; re-run same command, capture success.
D3. **Refactor** — only if needed, only this slice; keep focused and boundary tests green.

## Test plan

| ID | Test | Input | Expect |
| --- | --- | --- | --- |
Q1 | core only precache | build output includes huge fixture chapter parts | precache excludes runtime/media/parts/source/history |
Q2 | same-runtime shell update | JS changes while runtime digest unchanged | new SW waits; update-ready shown |
Q3 | old window preserved | two tabs, one active duel, new build | no skipWaiting/reload/takeover |
Q4 | cold activation | close old clients, reopen | new shell active; compatible installed content retained |
Q5 | base-safe offline navigation | / and /game/ after shell setup | menu navigation works offline; content miss never HTML |
Q6 | install UX honest | missing prompt/iOS/registration failure | instructions or failed state; no false offline-ready |

## Impl steps

- [ ] A1. Write failing precache, install-status and two-build lifecycle browser tests; verify red.
- [ ] A2. Add project-owned SW/manifest and explicit allowlist; verify no gigabyte data enters shell cache.
- [ ] A3. Wire install/offline/update states and safe initial setup; verify native prompt absence has in-app instructions.
- [ ] A4. Prove old-client waiting and root/subpath cold activation with two builds; verify content cache never pruned by shell update.

## Validation

- [ ] V1. Run `npx vitest run tests/unit/pwa-precache.test.ts tests/unit/domain-boundaries.test.ts tests/unit/data-cy-coverage.test.ts`; capture actual output, not predicted success.
- [ ] V2. Run `npx vitest run tests/component/PwaInstall.test.ts`; capture actual output, not predicted success.
- [ ] V3. Run `npx playwright test -c playwright.pwa.config.ts e2e/pwa-lifecycle.spec.ts`; capture actual output, not predicted success.
- [ ] V4. Run `npm run build:pwa`; capture actual output, not predicted success.
- [ ] V5. Manual: Browser install control or platform guide visible. With old window open, new shell says close all windows; no forced reload. Native proof deferred explicitly to T10.
- [ ] V6. No silent failure on added paths: inventory `|| true`, empty catches, suppressed stderr, fire-and-forget; expected retained sites `none`, or document exact justified site.
- [ ] V7. App functional: focused behavior above plus existing relevant regressions green. Any absent external gate remains blocked, never checked off.
- [ ] V8. Confirm no unrelated/feedback/vendor edits, no secrets/staging/publish; `git diff --stat` and intentional-path diff reviewed.
- [ ] V9. Commit message draft reviewed: `feat(pwa): keep offline shell updates out of active games`. No commit implied or requested by this plan.
