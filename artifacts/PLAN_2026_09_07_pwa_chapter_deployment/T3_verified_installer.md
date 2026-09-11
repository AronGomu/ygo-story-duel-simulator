# T3: Download, verify, activate and resume through game GUI

**Plan context:** Self-contained historical PWA chapter deployment ticket.
**Depends:** T2, T4
**Commit outcome:** Downloads screen installs published content with bounded persisted checkpoints, enabling default-AI freeplay as soon as runtime is verified.

## Asset tooling handoff amendment

H1. Installer receives immutable R2 bytes through `contentObjectUrl(__CONTENT_BASE_URL__, kind, sha256)`. Network GETs use custom-domain `content/indexes|catalogs|manifests|parts/<sha>` URLs, reject redirects, omit credentials and require exact CORS/hash/length/schema validation.
H2. Cache Storage synthetic `content/files/<file-sha256>` keys remain same-origin. Existing IDB, save, lease, activation and ContentFailureCode contracts remain unchanged; 404/410 maps to `CONTENT_REVISION_UNAVAILABLE`, transport/CORS to `CONTENT_NETWORK_FAILED`, wrong SHA/length to `CONTENT_INTEGRITY_FAILED`.
H3. Owner amendment remains binding: chapter-01 only. Fixture transport evidence from new asset tooling T6 is not native installer acceptance; this ticket still owns actual browser installation.

## Context (self-contained)

C1. Goal: One installable PWA; core UI automatic, runtime/chapter ZIPs manually downloaded inside game; Cloudflare Pages Free static-only. Full-catalog default-AI freeplay follows verified runtime; chapter entry additionally needs installed cumulative content and save-owned progression.
C2. This slice: First complete download vertical slice. Consumes working battle activation adapter from T4, not a no-op port. Shell owns execution; Worker owns ZIP decoding; content readiness follows real verified bytes and committed pointers.
C3. Out of scope: Frozen vendor/engine loader unchanged. No credentials, account creation or public publish without explicit human action. No feedback edits, paid backend, native wrapper, no-AI mode, automatic artwork fetching, or six invented chapters.
C4. Assumptions: owner mapping/permission/host/device evidence is explicit setup input, not guessed. Public availability is not legal clearance. New paths below are planned, not implemented. One writer in this cwd.

## Requirements

R1. Add #/downloads route/Main Menu entry and one data-cy-identified chapter-01 row. Explicit action includes required runtime; Download all plans the current published chapter-01 closure once. Unreleased chapter-01 has no download action.
R2. Use createContentManager(options) with T4 runtime adapter, returning InitialContentManager only. Update/remove controls and full ContentManager widening arrive T7; no fake methods or production no-op activator.
R3. One installer per origin via ygo-content-installer-v1 Web Lock; one ZIP in flight. AbortSignal pauses; route navigation does not silently discard job. On reopen all incomplete jobs paused until Resume click. Completed checkpoints require revalidated file presence/length.
R4. Archive Worker validates part hash/length, metadata, container restrictions, output caps and every file hash before Cache Storage commit. Transfer archive ArrayBuffer; bounded Worker streaming write; no unbounded arrayBuffer of decompressed ZIP. Reject Content-Type HTML fallback and overflow mid-stream.
R5. Persist manifests/jobs/installed/pointers records with exact schemas. Cross-cache/IDB crash is explicit: files may exist without checkpoint, never checkpoint without rechecked files. Duplicate part hashes coalesce; progress counts verified bytes, not request attempts.
R6. Runtime package activation calls T4 prepare before readiness publication. Runtime completion enables default-AI freeplay immediately even while chapter art remains queued. Chapter Ready requires full cumulative closure; partial bytes cannot unlock story.
R7. Commit content pointer with expected generation CAS, preserve previous. Establish shared per-content session locks/read port now, even before T7 removal UI, so later consumers can hold exact immutable refs.
R8. Install-time all-file verification; inspect checks exact receipts + cached presence/length; readFile rehashes before returning Blob; verify performs full hash pass. Missing/corrupt read returns typed error, no implicit network repair.
R9. Quota preflight uses storage.estimate with staging/headroom; persist() best-effort request is not a guarantee. Storage failures produce visible recoverable outcomes, preserve existing current content. Downloads never write story/deck DB.
R10. readCatalog/readManifest are cache-only staged metadata ports. Validate stored raw bytes against requested SHA, parser caps and known pinned-index or retained-index length; manifest length against ManifestRef.bytes. Return independent byte copy plus parsed value and digest only after hash/length/shape validation. Missing => CONTENT_MISSING, corruption => CONTENT_INTEGRITY_FAILED/CONTENT_INVALID_MANIFEST. No active-pointer prerequisite: battle activation must inspect staged catalog before current exists. T4 rehashes returned bytes independently.
R11. Fresh empty current: after runtime prepare, commit exact runtime-only ContentSetRef with chapters:[], then completed chapter prefixes oldest-first. Each CAS atomically advances job.expectedGeneration alongside pointer in own IDB transaction. planned remains final requested closure. Crash after runtime commit leaves freeplay ready, chapter missing, job paused; Resume uses persisted advanced generation. Existing compatible current is never downgraded to runtime-only during replacement/update.
R12. Own production-format ZIP/static fixture server and playwright.content.config.ts now, before SW exists. Serve real compiled app plus synthetic lawful R2 custom-domain package endpoints with exact-origin CORS, request logging and fault controls. No future build:pwa dependency. T8 owns separate two-build SW extension; default private playwright.config.ts is not acceptance harness.
R13. Build startup fetches the pinned `__CONTENT_INDEX_SHA256__` through `contentObjectUrl(__CONTENT_BASE_URL__, "indexes", sha256)`. No mutable nightly lookup, same-origin network assumption, browser S3 SDK or presigned URL.

## Inputs

F1. `src/shell/routes.ts; src/shell/screens/MainMenuScreen.svelte:31–84`
F2. `src/shell/AppShell.svelte; src/shell/domain-loaders.ts`
F3. `T2 generated/content/current/content/**`
F4. `src/battle/index.ts:createInstalledRuntimeActivationPort (from T4)`
F5. `tests/unit/data-cy-coverage.test.ts; tests/unit/domain-boundaries.test.ts`

**From Depends:** T2 supplies exact parsers/index/manifests/ZIPs and shared types. T4 supplies createInstalledRuntimeActivationPort(applicationBaseUrl): RuntimeActivationPort plus exact-ref installed runtime/catalog startup. prepare validates staged read-port bytes and really commits battle runtime receipts before success.

## Interface contract (level 5)

I1. IDB ygo-story-content v1: manifests key sha256; jobs key value.id; installed key manifest.sha256; pointers key name="content". Cache ygo-content-files-v1 synthetic <base>content/files/<sha>. All stores strictly validate records. ArchiveWorkerRequest/Response exact discriminants; Worker reply is not activation permission until main validates jobId/part hash/receipts/CAS. acquireSession holds shared locks named ygo-content-ref-v1-<manifestSha> for full exact closure; locks acquired in sorted digest order, held until release/tab termination. Short pointer writes use ygo-content-state-v1, never held while waiting for a conflicting session lease. Downloader lock cannot block game reads. Verify/Remove/Update errors use exact message table in CONTRACTS.md, copied into code. Full current+previous equality and generation checked on activation; no stale manifest combination. From first release jobs store StoredDownloadJob {kind:"download",value:DownloadJobRecord}, keyPath value.id, not bare jobs. IDB version remains 1. current() reads persisted pointer; initial value {generation:0,current:null,previous:null}. subscribeCurrent immediately re-reads current(), repeats after local CAS and validated BroadcastChannel ygo-content-state-v1 notifications; notifications contain generation only and are never authoritative. Unsubscribe releases listener; errors surface as ContentResult failure.

**Produces — exact declarations:**

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

export interface ZipPart {
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly unpackedBytes: number;
}

export type ContentMediaType =
  | "application/json"
  | "application/wasm"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/svg+xml"
  | "audio/ogg"
  | "audio/mpeg"
  | "video/mp4"
  | "video/webm";

export interface PackedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
  readonly mediaType: ContentMediaType;
  readonly partSha256: Sha256;
  readonly entry: string;
}

export interface ContentManifest {
  readonly schemaVersion: 1;
  readonly packId: PackId;
  readonly runtimeSnapshotId: Sha256;
  readonly storyContentId: "prototype-prologue-v1" | null;
  readonly dependencies: readonly ManifestRef[];
  readonly cardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly parts: readonly ZipPart[];
  readonly files: readonly PackedFile[];
}

/** Exact compatible manifest closure, never a mutable "latest" alias. */

export interface ContentSetRef {
  readonly catalogSha256: Sha256;
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ManifestRef[];
}

export interface InstalledContentSet {
  readonly generation: number;
  readonly current: ContentSetRef | null;
  readonly previous: ContentSetRef | null;
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

export type ContentResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | ContentFailure;

export type DownloadTarget =
  | { readonly kind: "chapter"; readonly chapterId: ChapterId }
  | { readonly kind: "all-published" };

export type DownloadPhase =
  | "queued"
  | "downloading"
  | "verifying"
  | "extracting"
  | "activating"
  | "paused"
  | "failed"
  | "complete";

export interface DownloadProgress {
  readonly jobId: string;
  readonly packId: PackId;
  readonly phase: DownloadPhase;
  readonly verifiedDownloadBytes: number;
  readonly totalDownloadBytes: number;
  readonly currentPartReceivedBytes: number;
  readonly currentPartTotalBytes: number;
}

export type DownloadResult =
  | { readonly kind: "complete"; readonly content: ContentSetRef }
  | { readonly kind: "paused"; readonly jobId: string }
  | ContentFailure;

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

export interface ContentManager {
  inspect(chapterId: ChapterId): Promise<ChapterReadiness>;
  download(
    target: DownloadTarget,
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  resume(
    jobId: string,
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  updateInstalled(
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  verify(chapterId: ChapterId): Promise<ContentResult<ContentSetRef>>;
  remove(chapterId: ChapterId): Promise<ContentResult<InstalledContentSet>>;
  readFile(
    manifest: ManifestRef,
    path: string,
  ): Promise<ContentResult<Blob>>;
}

export interface StoredManifestRecord {
  readonly sha256: Sha256; // manifests key
  readonly kind: "catalog" | "pack";
  readonly bytes: Uint8Array;
  readonly verifiedAt: number; // epoch milliseconds
}

export interface DownloadJobRecord {
  readonly id: string; // jobs key, crypto.randomUUID()
  readonly catalogSha256: Sha256;
  readonly intent: "download" | "update" | "repair";
  readonly target: DownloadTarget;
  readonly planned: ContentSetRef;
  readonly phase: DownloadPhase;
  readonly expectedGeneration: number;
  readonly completedParts: readonly Sha256[];
  readonly failure: ContentFailure | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface InstalledPackRecord {
  readonly manifest: ManifestRef; // installed key = manifest.sha256
  readonly verifiedParts: readonly Sha256[];
  readonly verifiedAt: number;
}

export interface ContentPointerRecord {
  readonly name: "content"; // pointers key
  readonly value: InstalledContentSet;
}

export interface VerifiedFileReceipt {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}

export type ArchiveWorkerRequest =
  | {
      readonly type: "extract";
      readonly jobId: string;
      readonly packId: ManifestRef["packId"];
      readonly part: ZipPart;
      readonly files: readonly PackedFile[];
      readonly archive: ArrayBuffer;
    }
  | { readonly type: "cancel"; readonly jobId: string };

export type ArchiveWorkerResponse =
  | {
      readonly type: "extracted";
      readonly jobId: string;
      readonly partSha256: Sha256;
      readonly files: readonly VerifiedFileReceipt[];
    }
  | { readonly type: "failed"; readonly jobId: string; readonly error: ContentFailure };

export interface ContentReadPort {
  readCatalog(sha256: Sha256): Promise<ContentResult<VerifiedMetadata<ContentIndex>>>;
  readManifest(ref: ManifestRef): Promise<ContentResult<VerifiedMetadata<ContentManifest>>>;
  current(): Promise<ContentResult<InstalledContentSet>>;
  subscribeCurrent(listener: (state: ContentResult<InstalledContentSet>) => void): () => void;
  readFile(manifest: ManifestRef, path: string): Promise<ContentResult<Blob>>;
  inspectContent(ref: ContentSetRef): Promise<ContentResult<ContentSetRef>>;
  acquireSession(ref: ContentSetRef): Promise<ContentResult<ContentSessionLease>>;
}

export interface ContentSessionLease {
  readonly content: ContentSetRef;
  release(): void;
}

export interface RuntimeActivationPort {
  prepare(
    ref: RuntimeSnapshotRef,
    runtime: ManifestRef,
    reader: ContentReadPort,
  ): Promise<ContentResult<RuntimeSnapshotRef>>;
}

export interface ContentManagerOptions {
  readonly index: ContentIndex;
  readonly indexSha256: Sha256;
  readonly applicationBaseUrl: string;
  readonly runtime: RuntimeActivationPort;
}

export type InitialContentManager = Pick<
  ContentManager,
  "inspect" | "download" | "resume" | "verify" | "readFile"
> & ContentReadPort;

export declare function createContentManager(
  options: ContentManagerOptions,
): Promise<InitialContentManager>; // widened to ContentManager & ContentReadPort by T7

// T4: extends existing initialize command; legacy initialize stays valid privately.

export interface VerifiedMetadata<T> {
  readonly bytes: Uint8Array;
  readonly value: T;
  readonly sha256: Sha256;
}

// T2 produces policy bytes; T6 consumes installed chapter policy, never author JSON.

export interface StoredDownloadJob {
  readonly kind: "download";
  readonly value: DownloadJobRecord;
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

export interface ZipPart {
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly unpackedBytes: number;
}

export type ContentMediaType =
  | "application/json"
  | "application/wasm"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/svg+xml"
  | "audio/ogg"
  | "audio/mpeg"
  | "video/mp4"
  | "video/webm";

export interface PackedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
  readonly mediaType: ContentMediaType;
  readonly partSha256: Sha256;
  readonly entry: string;
}

export interface ContentManifest {
  readonly schemaVersion: 1;
  readonly packId: PackId;
  readonly runtimeSnapshotId: Sha256;
  readonly storyContentId: "prototype-prologue-v1" | null;
  readonly dependencies: readonly ManifestRef[];
  readonly cardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly parts: readonly ZipPart[];
  readonly files: readonly PackedFile[];
}

/** Exact compatible manifest closure, never a mutable "latest" alias. */

export interface ContentSetRef {
  readonly catalogSha256: Sha256;
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ManifestRef[];
}

export interface InstalledContentSet {
  readonly generation: number;
  readonly current: ContentSetRef | null;
  readonly previous: ContentSetRef | null;
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

export type ContentResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | ContentFailure;

export type DownloadPhase =
  | "queued"
  | "downloading"
  | "verifying"
  | "extracting"
  | "activating"
  | "paused"
  | "failed"
  | "complete";

export interface DownloadProgress {
  readonly jobId: string;
  readonly packId: PackId;
  readonly phase: DownloadPhase;
  readonly verifiedDownloadBytes: number;
  readonly totalDownloadBytes: number;
  readonly currentPartReceivedBytes: number;
  readonly currentPartTotalBytes: number;
}

export type DownloadResult =
  | { readonly kind: "complete"; readonly content: ContentSetRef }
  | { readonly kind: "paused"; readonly jobId: string }
  | ContentFailure;

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

export interface ContentReadPort {
  readCatalog(sha256: Sha256): Promise<ContentResult<VerifiedMetadata<ContentIndex>>>;
  readManifest(ref: ManifestRef): Promise<ContentResult<VerifiedMetadata<ContentManifest>>>;
  current(): Promise<ContentResult<InstalledContentSet>>;
  subscribeCurrent(listener: (state: ContentResult<InstalledContentSet>) => void): () => void;
  readFile(manifest: ManifestRef, path: string): Promise<ContentResult<Blob>>;
  inspectContent(ref: ContentSetRef): Promise<ContentResult<ContentSetRef>>;
  acquireSession(ref: ContentSetRef): Promise<ContentResult<ContentSessionLease>>;
}

export interface ContentSessionLease {
  readonly content: ContentSetRef;
  release(): void;
}

export interface RuntimeActivationPort {
  prepare(
    ref: RuntimeSnapshotRef,
    runtime: ManifestRef,
    reader: ContentReadPort,
  ): Promise<ContentResult<RuntimeSnapshotRef>>;
}

export interface VerifiedMetadata<T> {
  readonly bytes: Uint8Array;
  readonly value: T;
  readonly sha256: Sha256;
}

// T2 produces policy bytes; T6 consumes installed chapter policy, never author JSON.
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

MainMenuScreen Downloads (NEW) → AppRoute downloads → DownloadsScreen click → `contentObjectUrl(__CONTENT_BASE_URL__, ...)` → cross-origin anonymous GET of immutable R2 index/manifest/part keys → archive.worker.ts validates/writes same-origin synthetic cache → IDB part receipt → RuntimeActivationPort.prepare → content pointer CAS → row ready/default-AI enabled. Observables: request log, typed progress, job/part records, pointer generation. New trigger/handler lines MISSING until implementation.

## Files owned by this slice

P1. `src/shell/content/content-manager.ts`
P2. `src/shell/content/content-database.ts`
P3. `src/shell/content/archive.worker.ts`
P4. `src/shell/content/installed-content-reader.ts`
P5. `src/shell/content/content-session-locks.ts`
P6. `src/shell/content/content-error-copy.ts`
P7. `src/shell/screens/DownloadsScreen.svelte`
P8. `src/shell/screens/MainMenuScreen.svelte`
P9. `src/shell/routes.ts`
P10. `src/shell/AppShell.svelte`
P11. `tests/unit/content-installer.test.ts`
P12. `tests/component/DownloadsScreen.test.ts`
P13. `e2e/content-downloads.spec.ts`
P14. `playwright.content.config.ts`
P15. `scripts/serve-content-fixture.ts`
P16. `tests/fixtures/content/`

## TDD

D1. **Red** — add named tests below first; run focused command, capture expected assertion failures. No implementation before red evidence.
D2. **Green** — minimum implementation for those failures; re-run same command, capture success.
D3. **Refactor** — only if needed, only this slice; keep focused and boundary tests green.

## Test plan

| ID | Test | Input | Expect |
| --- | --- | --- | --- |
Q1 | only manual download | load/menu hover/no click | no runtime/chapter/part request |
Q2 | published queue oldest first | chapter-01/02 published, rest unreleased | runtime then 01 then 02; nothing for future |
Q3 | resume after crash | interrupt second part after first checkpoint | reopen paused; Resume reuses first, restarts second |
Q4 | atomic runtime handshake | T4 prepare fails after extraction | no content Ready; old current intact |
Q5 | ZIP attacks bounded | traversal, symlink, encrypted, extra entry, wrong lengths, inflate overflow | CONTENT_ARCHIVE_REJECTED/integrity; no receipt |
Q6 | cache/IDB crash boundary | files written, receipt missing; receipt present, file missing | recover/revalidate; never false Ready |
Q7 | quota keeps working copy | put fails during replacement | CONTENT_QUOTA_EXCEEDED; current unchanged |
Q8 | concurrent windows | second install; stale expected generation | CONTENT_BUSY/conflict; no mixed pointer |
Q9 | default AI before chapter art | runtime complete, art queue paused | all-card default-AI freeplay available; chapter not Ready |
Q10 | runtime checkpoint survives reopen | crash after runtime pointer CAS before chapter receipt | freeplay ready; chapter missing; Resume no self-conflict |
Q11 | metadata staged and bounded | catalog cached before activation; tampered/missing bytes | correct verified bytes or typed failure; no network |
Q12 | tagged download round trip | stored kind download / malformed tag | validate value.id; reject malformed record |

## Impl steps

- [ ] A1. Write failing unit/Worker/component/browser tests covering real fixture install and interruption; verify red failures are expected.
- [ ] A2. Implement bounded Worker decode and durable content records/read port; verify archive and crash fixtures cannot forge readiness.
- [ ] A3. Wire battle prepare port and generation CAS; verify runtime enables default AI before art, chapter requires full closure.
- [ ] A4. Add Downloads route/UI, explicit Resume and progress/error copy; verify no background data fetch from mere menu entry.
- [ ] A5. Exercise two contexts/quota/file eviction with installed session lease; verify current content and saved DB bytes untouched.

## Validation

- [ ] V1. Run `npx vitest run tests/unit/content-installer.test.ts tests/unit/domain-boundaries.test.ts tests/unit/data-cy-coverage.test.ts`; capture actual output, not predicted success.
- [ ] V2. Run `npx vitest run tests/component/DownloadsScreen.test.ts`; capture actual output, not predicted success.
- [ ] V3. Run `npx playwright test -c playwright.content.config.ts e2e/content-downloads.spec.ts`; capture actual output, not predicted success.
- [ ] V4. Run `npm run typecheck`; capture actual output, not predicted success.
- [ ] V5. Manual: Click one chapter, pause/close/reopen, confirm no network until Resume. After runtime completes start default-AI freeplay while chapter art remains pending. Verify unreleased rows stay unavailable.
- [ ] V6. No silent failure on added paths: inventory `|| true`, empty catches, suppressed stderr, fire-and-forget; expected retained sites `none`, or document exact justified site.
- [ ] V7. App functional: focused behavior above plus existing relevant regressions green. Any absent external gate remains blocked, never checked off.
- [ ] V8. Confirm no unrelated/feedback/vendor edits, no secrets/staging/publish; `git diff --stat` and intentional-path diff reviewed.
- [ ] V9. Commit message draft reviewed: `feat(content): make manual chapter installs resumable and verifiable`. No commit implied or requested by this plan.
