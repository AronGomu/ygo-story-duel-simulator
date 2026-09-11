# T2: Produce deterministic bounded chapter packages

**Plan context:** Self-contained historical PWA chapter deployment ticket.
**Depends:** T1
**Commit outcome:** Owner chapter selections produce verified, reproducible content index/manifests/ZIPs with explicit static-host limits.

## Asset tooling handoff amendment

H1. New asset tooling T3 owns deterministic packaging, `content:catalog`, `content:pack`, `content:verify`, R2 object layout, retained metadata, CoreManifest and prod index production. This ticket keeps parser/port vocabulary plus source-support/card-pool verification; it must not implement a second producer.
H2. Generated player objects use immutable `content/indexes|catalogs|manifests|parts/<sha>` R2 keys. Runtime/chapter manifest and Cache Storage/save shapes remain unchanged.
H3. Owner amendment remains binding: chapter-01 only. Seven-chapter declarations below are historical schema text and do not authorize later rows, archives or gameplay content.

## Context (self-contained)

C1. Goal: One installable PWA; core UI automatic, runtime/chapter ZIPs manually downloaded inside game; Cloudflare Pages Free static-only. Full-catalog default-AI freeplay follows verified runtime; chapter entry additionally needs installed cumulative content and save-owned progression.
C2. This slice: Producer slice defines shared vocabulary before battle/installer consumers. Runtime is one complete dependency; chapter packs contain declared media/card-art deltas. This ticket does not install assets into a browser or claim public deployment.
C3. Out of scope: Frozen vendor/engine loader unchanged. No credentials, account creation or public publish without explicit human action. No feedback edits, paid backend, native wrapper, no-AI mode, automatic artwork fetching, or six invented chapters.
C4. Assumptions: owner mapping/permission/host/device evidence is explicit setup input, not guessed. Public availability is not legal clearance. New paths below are planned, not implemented. One writer in this cwd.

## Requirements

R1. Consume the classified `src/content/index.ts` vocabulary/parsers delivered by new asset tooling T3. Preserve its focused files, boundary tests and Node-free public runtime exports; do not create a parallel content contract or producer.
R2. Implement every accepted CONTRACTS.ts shape; publish ContentReadPort, ContentSessionLease and RuntimeActivationPort type-only seams before T4/T3. Shell-private DB/worker records remain shell-private when implemented.
R3. Read exactly the owner-approved chapter-01 row. Published storyContentId must match the implemented adapter. Its direct dependency is runtime; runtime manifest has no chapter dependency. Later chapters require intentional schema/profile extension.
R4. Runtime package preserves existing complete frozen runtime closure, vendor metadata/WASM and verified shared non-art data needed by all-card freeplay. Card/set art and chapter-specific media do not become runtime prerequisites.
R5. Produce runtime first, then chapters oldest-first. Assign identical art/media bytes to earliest required chapter; later chapters consume prior refs. Conflicting logical path/digest within one closure fails, never last-write-wins. Include full/cropped art, set art, and existing prototype map media from explicit allowed source mappings.
R6. No six future stories, no automatic card-pool widening. Existing shop data/release flags remain game policy; filter chapter availability separately. Source set/card membership is not engine support; validate selected codes and actual files against pinned runtime/source inputs.
R7. Canonical JSON = recursively code-point-sorted keys, ordered arrays, compact UTF-8 + LF. Store manifests outside ZIPs. Deterministic ZIP metadata: fixed timestamp 1980-01-01T00:00:00Z, stable order, no extras/comments/permissions variability, methods 0/8 only; lock compression implementation/options.
R8. Enforce ZIP <=20971520 bytes, inflated <=33554432, each file <=16777216, <=2048 entries, paths <=512 chars, no links/dirs/traversal/encryption/ZIP64/undeclared entries. Actual compressed size checked after packing; split before limit, do not promise source bytes equal ZIP size.
R9. Emit index/catalog snapshots, manifests and parts at content-addressed paths. Verify every file/part/ref/body digest, exact byte counts, no ambiguous duplicate outputs. Retained old inventory is T9 responsibility; first-release index has empty retained arrays.
R10. Metadata limits are binding: index <=1048576 bytes, manifest <=4194304 bytes, <=50000 files/pack. SHA regex /^[a-f0-9]{64}$/; integer lengths safe/nonnegative (archive/manifest positive); extra/missing keys rejected. Paths are POSIX-relative <=512 chars: reject leading slash, dot/dot-dot/empty segments, backslash, colon, NUL, percent, question mark and hash.
R11. Pack one ChapterContentPolicy at story/policy/<chapterId>.json in that chapter ZIP. setIds are exact IDs from existing shop-set generator mapping of owner setNames, unique and sorted; ambiguous/unmapped names fail CONTENT_SOURCE_GAP. cardCodes/opponentIds equal manifest declarations. Overlapping/reprinted card membership must not infer selected set IDs. Owner source export stays build-only.
R12. content:pack accepts --retained-metadata <path>, schema {schemaVersion:1,catalogs:ContentIndex["retainedCatalogs"],manifests:ContentIndex["retainedManifests"]}. Canonicalize verified history lists before final index hash. Empty-history default is local fixture/bootstrap candidate only; T9 requires explicit verified bootstrap lock or history argument before real eligibility.

## Inputs

F1. `content/chapter-selections.json; content/authoring/card-set-source.json; content/distribution-evidence.json`
F2. `scripts/lib/vite-runtime-assets.ts:copySnapshotAssets; scripts/lib/active-image-manifest.ts`
F3. `generated/runtime/current/manifest.json; generated/assets/current/; generated/card-images/archive/{full,cropped}/; generated/set-images/`
F4. `src/story/assets/city-map-placeholder.svg; public/story/shop-sets.v1.json`
F5. `tests/unit/domain-boundaries.test.ts; eslint.config.js; scripts/verify-browser-build.ts`

**From Depends:** T1 leaves setup-report.json, owner ChapterSelections, pinned source export, distribution verdict, lockfile dependencies. codeReady/source inputs required for real packaging; pending publication evidence remains a release gate.

## Interface contract (level 5)

I1. npm run content:catalog; npm run content:pack; npm run content:verify. Outputs generated/content/current/content/index.json, content/catalogs/<sha>.json, content/manifests/<sha>.json, content/parts/<sha>.zip. CLI exit 0 verified, 2 invalid input/limits/coverage, 1 unexpected failure. Build-only error strings: CONTENT_FILE_TOO_LARGE, CONTENT_PART_TOO_LARGE, CONTENT_SOURCE_GAP, CONTENT_PATH_CONFLICT. Append offending safe path in diagnostics, never silently skip it. Runtime pack logical paths retain runtime/current/manifest.json, runtime/assets/current/**, runtime/engine/**; chapter art paths runtime/images/<code>.jpg, runtime/images-cropped/<code>.jpg, runtime/sets/<set-id>.jpg; prototype map logical path story/media/city-map-placeholder.svg.

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

export interface ChapterSelection {
  readonly id: ChapterId;
  readonly title: string;
  readonly published: boolean;
  readonly setNames: readonly string[];
  readonly additionalCardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly storyContentId: "prototype-prologue-v1" | null;
}

export interface ChapterSelections {
  readonly schemaVersion: 1;
  readonly sourceSha256: Sha256;
  readonly chapters: readonly ChapterSelection[];
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

export interface StoryContentBinding {
  readonly chapterId: ChapterId;
  readonly content: ContentSetRef;
  readonly completedChapters: readonly ChapterId[];
}

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

export declare function parseChapterSelections(
  value: unknown,
): ContentResult<ChapterSelections>;

export declare function parseContentIndex(
  value: unknown,
): ContentResult<ContentIndex>;

export declare function parseContentManifest(
  value: unknown,
): ContentResult<ContentManifest>;

export declare const ZIP_PART_MAX_BYTES: 20971520;

export declare const ZIP_PART_MAX_UNPACKED_BYTES: 33554432;

export declare const CONTENT_FILE_MAX_BYTES: 16777216;

export declare const CONTENT_DATABASE_NAME: "ygo-story-content";

export declare const CONTENT_DATABASE_VERSION: 1;

export declare const CONTENT_CACHE_NAME: "ygo-content-files-v1";

export declare const CONTENT_INSTALLER_LOCK: "ygo-content-installer-v1";

export interface PackageInputFile {
  readonly path: string;
  readonly sourcePath: string;
  readonly bytes: Uint8Array;
  readonly mediaType: PackedFile["mediaType"];
}

export interface PackedContent {
  readonly index: ContentIndex;
  readonly indexBytes: Uint8Array;
  readonly indexSha256: Sha256;
  readonly manifests: readonly {
    readonly ref: ManifestRef;
    readonly bytes: Uint8Array;
  }[];
  readonly parts: readonly { readonly part: ZipPart; readonly bytes: Uint8Array }[];
}

// T3: stores and Worker boundary. Store key is named beside each value.

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

export interface ChapterContentPolicy {
  readonly schemaVersion: 1;
  readonly chapterId: ChapterId;
  readonly setIds: readonly string[];
  readonly cardCodes: readonly number[];
  readonly opponentIds: readonly string[];
}

// T3 stores tagged downloads from first release; T7 widens value union.
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

export interface ChapterSelection {
  readonly id: ChapterId;
  readonly title: string;
  readonly published: boolean;
  readonly setNames: readonly string[];
  readonly additionalCardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly storyContentId: "prototype-prologue-v1" | null;
}

export interface ChapterSelections {
  readonly schemaVersion: 1;
  readonly sourceSha256: Sha256;
  readonly chapters: readonly ChapterSelection[];
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

Owner mapping → `npm run content:catalog` prepares frozen player metadata → new asset tooling `assets:bundle -- --target prod|all` / `content:pack` adapters produce immutable R2 object keys → `content:verify` audits manifest/ref/ZIP closure. Existing copySnapshotAssets remains historical evidence, not a second archive implementation.

## Files owned by this slice

P1. `src/content/index.ts`
P2. `src/content/contracts/`
P3. `src/content/parsers/`
P4. `scripts/generate-content-catalog.ts`
P5. `scripts/package-content.ts`
P6. `scripts/verify-content.ts`
P7. `scripts/lib/content-packaging.ts`
P8. `scripts/lib/chapter-asset-sources.ts`
P9. `eslint.config.js`
P10. `tests/unit/domain-boundaries.test.ts`
P11. `tests/unit/content-packaging.test.ts`

## TDD

D1. **Red** — add named tests below first; run focused command, capture expected assertion failures. No implementation before red evidence.
D2. **Green** — minimum implementation for those failures; re-run same command, capture success.
D3. **Refactor** — only if needed, only this slice; keep focused and boundary tests green.

## Test plan

| ID | Test | Input | Expect |
| --- | --- | --- | --- |
Q1 | canonical output reproducible | same input, reordered object keys/files, two clean temp roots | identical index/manifests/ZIP hashes |
Q2 | published prefix validated | chapter-03 published while chapter-02 unreleased | CONTENT_INVALID_MANIFEST |
Q3 | bounded ZIPs | files at limits, one over-limit file, compressible JSON bomb fixture | legal parts fit; oversized source rejected |
Q4 | membership exact | reprint in multiple selected sets; unknown source ID | dedup card IDs; unknown reported |
Q5 | full runtime closure | omit script/vendor file, alter frozen WASM | verification fails; no manifest fabricated |
Q6 | no future content | seven slots, only chapter-01 published | future rows have no ref/bytes; no archives for them |
Q7 | policy preserves selected sets | two overlapping sets with equal card IDs, owner selects only one | installed policy exposes exactly selected set ID |
Q8 | metadata caps and grammar | oversized index/manifest, 50001 files, forbidden path chars | CONTENT_INVALID_MANIFEST before allocation/extraction |

## Impl steps

- [ ] A1. Write failing parser, deterministic ZIP, source-coverage and boundary tests; verify failures isolate missing producer behavior.
- [ ] A2. Publish accepted pure shared contracts and parser invariants; verify content root import/export rules and no engine imports.
- [ ] A3. Implement source collection and deterministic packing with exact caps; verify byte-equal two-root outputs and ZIP exploit fixtures.
- [ ] A4. Implement offline verifier and npm commands; verify complete runtime and chapter artifacts against owner inputs without public upload.

## Validation

- [ ] V1. Run `npx vitest run tests/unit/content-packaging.test.ts tests/unit/domain-boundaries.test.ts`; capture actual output, not predicted success.
- [ ] V2. Run `npm run content:catalog`; capture actual output, not predicted success.
- [ ] V3. Run `npm run content:pack`; capture actual output, not predicted success.
- [ ] V4. Run `npm run content:verify`; capture actual output, not predicted success.
- [ ] V5. Run `npm run vendor:verify`; capture actual output, not predicted success.
- [ ] V6. Manual: Inspect generated seven-row index, declared sizes and coverage report. No future playable chapter or raw art outside ZIP output.
- [ ] V7. No silent failure on added paths: inventory `|| true`, empty catches, suppressed stderr, fire-and-forget; expected retained sites `none`, or document exact justified site.
- [ ] V8. App functional: focused behavior above plus existing relevant regressions green. Any absent external gate remains blocked, never checked off.
- [ ] V9. Confirm no unrelated/feedback/vendor edits, no secrets/staging/publish; `git diff --stat` and intentional-path diff reviewed.
- [ ] V10. Commit message draft reviewed: `feat(content): package chapters as reproducible bounded downloads`. No commit implied or requested by this plan.
