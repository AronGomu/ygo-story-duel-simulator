# T3: Build deterministic dev and player archives

**Plan:** `./artifacts/PLAN_2026_09_09_complete_asset_tooling.md`  
**Depends:** T2  
**State:** MERGED AND PUSHED — `902fbef` implementation; `aef9b00` integration; checkpoint `c705d66` verified on `origin/main`. Paused by user after push; T4/T5 not started. Eight independent review findings closed. User approved paired `FreePlayUniqueOwner.test.ts:40` baseline exception; full suite remains failed. Main focused148/typecheck/build passed. Actual >4GiB/10GiB and hosted/native acceptance remain unproved.  
**Commit outcome:** One pure producer emits complete dev ZIPs and bounded player ZIPs from frozen profile inventory.

## Context (self-contained)

C1. Goal: scriptable complete dev asset delivery plus player-compatible producer. Every asset file in four roots enters dev archive; profile selection drives core/runtime/chapter outputs.
C2. This slice freezes inventory and archives, without hosting or local asset installation. It owns packaging seam formerly old PWA T2, not whole PWA implementation.
C3. Out of scope: gameplay/card legality/image decoding checks, upstream acquisition, runtime installer UI, engine changes, account/remote writes, source moves during release.
C4. Assumptions: byte/profile determinism, not latest-provider reproducibility. Dev ZIP64 supports large originals; player limits remain distinct. Missing media can remain absent, not silently fabricated. Prod needs structurally parseable prepared metadata, not valid gameplay.

## Requirements

- [x] R1. Implement bundleAssets and assets:bundle target dev/prod/all; require target, default nightly. Release --version equals package.json version, inventory/profile bytes frozen in staging. No wall-clock/channel/absolute-path fields inside hashed outputs.
- [x] R2. Dev ZIP streams every extant regular asset file, including originals/unused/unreleased and operational report bytes already present as sources. Do not regenerate reports during bundle. ZIP64 permitted, STORE with fixed metadata; file mode not serialized. Manifest exactly covers archive; arbitrarily large source originals streamed within declared 16 GiB bound.
- [x] R3. Prod emits existing runtime/chapter manifests, bounded ZIP parts and content index, reusing old PWA ContentManifest/ContentIndex contracts. Core profile generates shell-copy inventory only; excluded external prod archives. Initial chapter-01 only, preserve explicit game metadata and existing logical paths. Never infer selected set IDs from art duplication.
- [x] R4. Pure producer does structural checks only: readable metadata, safe paths/types, limits, collisions, frozen vendor integrity. Missing explicitly referenced media listed in operational omission report outside hashes; extant profile-tree files always included. Does NOT invoke assets:verify, check:headless, npm run build, source-support verifier, image decoder, source grep or profile --check gate.
- [x] R5. New src/content public vocabulary/parser seam explicitly classified in ESLint and domain-boundaries tests, following old T2 narrow public-export contract. Browser code cannot import scripts or AWS SDK. Existing old content schema values preserved; ChapterId parser limited chapter-01 by current amendment, no seven chapter scaffolding.
- [x] R6. Object graph closure exact and hash-addressed. Dev manifest includes inventory ref, archive ref and exact file list. Build target all creates one input snapshot for both; no source re-read after staged freeze. Source change detects ASSET_SOURCE_CHANGED, previous output remains readable. Local candidates may be rebuilt; published version immutability checked by publisher before any conflicting commit.
- [ ] R7. Test adversarial archives and file mutation while streaming. Instrument memory/read sizes to prove bounded streaming; >4 GiB ZIP64 real disk test separately, no claim from small fake Buffer. Keep archive outputs outside roots, so rerun never bundles prior ZIP.
- [x] R8. Old PWA content:pack/content:catalog/content:verify remain compatibility entry points delegating producer/verification; no second implementation. Metadata verification validates bytes/schema, separate existing semantic development checks remain explicit.

- [x] R9. Implement CoreManifest/core archive/PlayerBundleRef.inventory and explicit frozen RetainedMetadata+PreparedPlayerMetadata inputs. Keep history in ContentIndex retained arrays; no self-current hash in retained list. Core bytes live in private per-run immutable artifacts. Offline prod history is explicit file or --empty-history.

## Assumptions — T2 integration handoff

A1. T2 impl `28c6a69`, merged locally `f145921`. `scripts/lib/asset-delivery/scan-assets.ts` exports exact four-argument `scanAssets(...): Promise<FrozenInventory>` and `scanAssetProfiles` with omission/dependency diagnostics. Both read-only; T3 acquires one-argument `acquireAssetDeliveryLock(root)` once across scan/freeze, no nested acquisition. Pending migration ownership fails ASSET_RECOVERY_REQUIRED. Optional lock recovery SHA is migration-only, not producer bypass.

A2. Pure canonical map is `scripts/lib/asset-roots.ts:ASSET_SOURCES`; migration/logical mapping helpers remain `asset-delivery/source-mapping.ts`. Null prepared metadata means dev inventory runtimeSnapshotId null/vendorFiles empty; prod must supply prepared metadata for verified frozen vendor inventory. Actual roots already migrated; legacy generated copies are ignored source fallbacks, never enumerated by producer.

A3. Initial chapter profile selects extant chosen media only; no invented mandatory art from gameplay IDs. Future unclassified art remains dev-only until promotion. Missing declared optional media diagnosed outside hashes; producer never invokes profile --check/semantic acquisition gates. Migration temp/pending ownership gates must remain enforced, never suffix-filter unknown originals.

## Inputs

F1. scripts/lib/asset-delivery root map/profile parsers from T2; @zip.js/zip.js 2.13.1 actual installed source/API from T1.
F2. Existing PWA accepted ContentManifest/ContentIndex/ManifestRef/ZipPart declaration file in prior plan; current chapter-one owner amendment. PWA_HANDOFF.md in this plan is binding amendment.
F3. scripts/lib/vite-runtime-assets.ts and generated-runtime manifest schema; assets/shared/{data,current,runtime} mapping; frozen vendor manifest/WASM read-only.
F4. From Depends: T2 produces assets/{battle,deck-editor,story,shared}, asset-profiles/*.json including nightly PlayerSelection, scanAssets(root, selection, retainedMetadata, playerMetadata): Promise<FrozenInventory>, canonicalBytes, stable source→logical path map, profile check/promote tests. Paths may have missing optional media; no blanket gameplay readiness assumption.

## Interface contract (level 5)

I1. Produces/consumes exact declarations below. Each ticket implements only owned subset named in Requirements; remaining declarations are binding consumed schemas, not permission to implement sibling work. Functions outside owned slice consumed unchanged. Shared protocol sections below repeat exact canonical contract; no predecessor-ticket read required.
I2. Errors: exact AssetFailureCode discriminant/message; AssetFailure.path separate. Parser helpers throw code-bearing errors converted at CLI boundary; expected failures exit 2, unexpected internal faults exit 1, success exit 0. No silent fallback to upstream/old schema.
I3. Structural/integrity checks are not gameplay validation. Frozen vendor and domain boundaries remain invariants. Inputs marked planned stay planned until predecessor artifacts exist.

```ts
/** Specification only. T1 splits these declarations into focused scripts/lib/asset-delivery/ files. */
export type Sha256 = string;
export type AssetRoot = "battle" | "deck-editor" | "story" | "shared";
export type ProfileId = "core" | "runtime" | `chapter-${string}`;
export type BundleTarget = "dev" | "prod";
export type TargetOption = BundleTarget | "all";
export type Channel = { readonly kind: "nightly" } | { readonly kind: "release"; readonly version: string };
export interface AssetRule {
  readonly root: AssetRoot;
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly logicalPath: string;
}
export interface AssetProfile {
  readonly schemaVersion: 1;
  readonly id: ProfileId;
  readonly dependsOn: readonly ProfileId[];
  readonly rules: readonly AssetRule[];
}
export interface PlayerSelection {
  readonly schemaVersion: 1;
  readonly profiles: readonly ProfileId[];
}
export interface AssetDeliveryConfig {
  readonly schemaVersion: 1;
  readonly publicBaseUrl: string;
  readonly bucket: string;
  readonly keyPrefix: "ascencio-assets/v1/";
}
export interface FileDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
export interface SelectedAsset extends FileDigest {
  readonly root: AssetRoot;
  readonly sourcePath: string;
  readonly profile: ProfileId | "dev-only";
  readonly logicalPath: string | null;
}
export interface RetainedMetadata {
  readonly schemaVersion: 1;
  readonly catalogs: readonly { readonly sha256: Sha256; readonly bytes: number }[];
  readonly manifests: readonly { readonly packId: "runtime" | "chapter-01"; readonly sha256: Sha256; readonly bytes: number }[];
}
export interface PreparedPlayerMetadata {
  readonly schemaVersion: 1;
  readonly sourceInputs: readonly FileDigest[];
  readonly runtimeSnapshotId: Sha256;
  readonly runtimeCardCodes: readonly number[];
  readonly chapters: readonly {
    readonly id: "chapter-01";
    readonly title: string;
    readonly storyContentId: "prototype-prologue-v1" | null;
    readonly setIds: readonly string[];
    readonly cardCodes: readonly number[];
    readonly opponentIds: readonly string[];
  }[];
}
export interface FrozenInventory {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly runtimeSnapshotId: Sha256 | null;
  readonly profiles: readonly AssetProfile[];
  readonly selection: PlayerSelection;
  readonly files: readonly SelectedAsset[];
  readonly vendorFiles: readonly FileDigest[];
  readonly retainedMetadata: RetainedMetadata;
  readonly playerMetadata: PreparedPlayerMetadata | null;
}
/** Key is relative to config.publicBaseUrl and the fixed R2 keyPrefix. */
export interface ObjectRef {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
export interface DevManifest {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly layoutVersion: 1;
  readonly inventory: ObjectRef;
  readonly archive: ObjectRef;
  readonly files: readonly FileDigest[];
}
export interface CoreFile extends FileDigest {
  readonly logicalPath: string;
}
export interface CoreManifest {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly inventory: ObjectRef;
  readonly archive: ObjectRef;
  readonly files: readonly CoreFile[];
}
export interface CoreCopyPlan {
  readonly schemaVersion: 1;
  readonly snapshot: ObjectRef;
  readonly prodInventory: ObjectRef;
  readonly coreManifest: ObjectRef;
  readonly files: readonly { readonly stagedPath: string; readonly logicalPath: string; readonly bytes: number; readonly sha256: Sha256 }[];
}
export interface PlayerBundleRef {
  readonly inventory: ObjectRef;
  readonly core: ObjectRef;
  readonly index: ObjectRef;
  readonly runtimeSnapshotId: Sha256;
}
export interface BundleSnapshot {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly inventory: ObjectRef;
  readonly dev: ObjectRef | null;
  readonly prod: PlayerBundleRef | null;
  readonly objects: readonly ObjectRef[];
}
export interface ReleasePointer {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly snapshot: ObjectRef;
}
export interface InstallReceipt {
  readonly schemaVersion: 1;
  readonly layoutVersion: 1;
  readonly snapshotSha256: Sha256;
  readonly files: readonly FileDigest[];
  readonly retired: readonly FileDigest[];
}
export interface InstallChange {
  readonly path: string;
  readonly before: FileDigest | null;
  readonly after: FileDigest;
}
export interface InstallJournal {
  readonly schemaVersion: 1;
  readonly snapshotSha256: Sha256;
  readonly phase: "prepared" | "applying" | "committed";
  readonly previousReceipt: InstallReceipt | null;
  readonly nextReceipt: InstallReceipt;
  readonly changes: readonly InstallChange[];
}
export interface PruneCandidate {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
export interface PrunePlan {
  readonly schemaVersion: 1;
  readonly scope: "local" | "remote";
  readonly basisSha256: Sha256;
  readonly candidates: readonly PruneCandidate[];
}
export interface PublicationInventory {
  readonly schemaVersion: 1;
  readonly nightly: ObjectRef | null;
  readonly releases: readonly { readonly version: string; readonly pointer: ObjectRef }[];
  readonly retiredNightlies: readonly { readonly snapshot: ObjectRef; readonly retiredAt: string }[];
}
export interface PruneJournal {
  readonly schemaVersion: 1;
  readonly plan: PrunePlan;
  readonly phase: "prepared" | "deleting" | "committed";
  readonly intentPaths: readonly string[];
  readonly completedPaths: readonly string[];
  readonly nextState: PublicationInventory | null;
  readonly nextReceipt: InstallReceipt | null;
}
export interface MigrationPlan {
  readonly schemaVersion: 1;
  readonly files: readonly { readonly from: string; readonly to: string; readonly bytes: number; readonly sha256: Sha256 }[];
}
export interface MigrationReceipt {
  readonly schemaVersion: 1;
  readonly planSha256: Sha256;
  readonly completed: readonly FileDigest[];
}
export type ApprovalRule =
  | { readonly root: AssetRoot | "vendor"; readonly kind: "file"; readonly path: string; readonly sha256: Sha256; readonly evidence: FileDigest }
  | { readonly root: AssetRoot; readonly kind: "tree"; readonly path: string; readonly includesFutureFiles: true; readonly evidence: FileDigest };
export interface PublicationApproval {
  readonly schemaVersion: 1;
  readonly status: "approved";
  readonly targets: readonly BundleTarget[];
  readonly rules: readonly ApprovalRule[];
}
export type AssetFailureCode =
  | "ASSET_ARGUMENT_INVALID" | "ASSET_CONFIG_INVALID" | "ASSET_PATH_UNSAFE"
  | "ASSET_PROFILE_CONFLICT" | "ASSET_REFERENCE_MISSING" | "ASSET_SOURCE_CHANGED"
  | "ASSET_LIMIT_EXCEEDED" | "ASSET_NETWORK_FAILED" | "ASSET_REVISION_UNAVAILABLE"
  | "ASSET_INTEGRITY_FAILED" | "ASSET_ARCHIVE_REJECTED" | "ASSET_LOCAL_CONFLICT"
  | "ASSET_LAYOUT_INCOMPATIBLE" | "ASSET_BUSY" | "ASSET_DISK_FULL"
  | "ASSET_PUBLICATION_CONFLICT" | "ASSET_RELEASE_EXISTS" | "ASSET_PUBLICATION_DENIED"
  | "ASSET_TARGET_UNAVAILABLE" | "ASSET_PRUNE_STALE" | "ASSET_RECOVERY_REQUIRED";
export interface AssetFailure {
  readonly status: "failed";
  readonly code: AssetFailureCode;
  readonly path: string | null;
}
export interface AssetSuccess {
  readonly status: "ok";
  readonly operation: "setup" | "scan" | "check" | "promote" | "migrate" | "bundle" | "publish" | "download" | "prune";
  readonly snapshotSha256: Sha256 | null;
}
export type AssetResult = AssetSuccess | AssetFailure;
export declare function parseAssetProfile(value: unknown): AssetProfile;
export declare function parseBundleSnapshot(value: unknown): BundleSnapshot;
export declare function parseDevManifest(value: unknown): DevManifest;
export declare function parseInstallReceipt(value: unknown): InstallReceipt;
export declare function canonicalBytes(value: unknown): Uint8Array;
export declare function scanAssets(root: string, selection: PlayerSelection, retainedMetadata: RetainedMetadata, playerMetadata: PreparedPlayerMetadata | null): Promise<FrozenInventory>;
export declare function bundleAssets(root: string, target: TargetOption, channel: Channel, retainedMetadata: RetainedMetadata, playerMetadata: PreparedPlayerMetadata | null): Promise<BundleSnapshot>;
export declare function stageCoreAssets(root: string, snapshot: ObjectRef): Promise<CoreCopyPlan>;
export declare function verifyPublicationApproval(approval: PublicationApproval, snapshot: BundleSnapshot, inventories: readonly FrozenInventory[]): AssetResult;
export declare function publishAssets(root: string, target: TargetOption, channel: Channel): Promise<AssetResult>;
export declare function downloadAssets(root: string, channel: Channel): Promise<AssetResult>;
export declare function previewPrune(root: string, scope: "local" | "remote"): Promise<PrunePlan>;
export declare function applyPrune(root: string, plan: PrunePlan): Promise<AssetResult>;
/** Planned public player transport function; belongs to src/content/, not scripts/. */
export declare function contentObjectUrl(baseUrl: string, kind: "indexes" | "catalogs" | "manifests" | "parts", sha256: Sha256): string;
```

## Binding protocol slices

## CLI

| ID | Command | Contract |
| --- | --- | --- |
| C1 | `npm run assets:setup -- --check` | Validate local delivery config/env names, Node >=24, domain/CORS setup instructions. No network writes. Public read probes only with `--remote`. |
| C2 | `npm run assets:profiles:sync -- --check` | Recompute inventory from four roots; structural/reference/profile checks. Writes no profile. Exit 2 on conflicts/missing explicit references; unclassified files listed dev-only, not failure. Without `--check`, write canonical report to `generated/asset-delivery/inventory.json`. |
| C3 | `npm run assets:promote -- --profile chapter-01 --files-from release-assets.txt` | Preview exact-file rules; list UTF-8, one root-relative repository path per line, blank lines ignored, no comments/globs. `--apply` writes profile atomically after rescan. |
| C4 | `npm run assets:promote -- --profile chapter-01 --from assets/story/chapter-01 --all` | Preview one recursive tree rule; future matching files included. `--apply` writes rule, not asset bytes. Exactly one of `--files-from` or `--from ... --all`. `--logical-prefix story/media/chapter-01` optionally overrides proposed path mapping. Default logical prefix comes from canonical longest-prefix source→browser map (M1–M9), never by stripping `assets/`. Unmapped tree requires `--logical-prefix`; exact-file lists resolve each file through same map, unmapped entries fail `ASSET_CONFIG_INVALID` and require explicit profile authoring/tree promotion. `--logical-prefix` applies only to --from, not multi-root --files-from. Existing conflicting assignments fail; never silently reassign. |
| C5 | `npm run assets:bundle -- --target dev\|prod\|all [--version 0.1.0] [--retained-metadata <path>\|--empty-history] [--player-metadata <path>]` | Target mandatory. Default nightly; `--version` makes immutable release candidate, must equal package version. Output immutable per-run `generated/asset-delivery/runs/<uuid>/`; canonical object graph does not include uuid. `generated/asset-delivery/current.json` records latest completed local snapshot/run (operational only). Prod/all require explicit history via `--retained-metadata <path>` or `--empty-history`, plus readable prepared player metadata; default player metadata path `generated/asset-delivery/prepared-player.json`. `--empty-history` permits explicit offline first-release/fixture candidate instead of history file. Dev-only uses empty history/null player metadata. No upload, no gameplay validation. |
| C6 | `npm run assets:publish -- --target dev\|prod\|all [--version 0.1.0]` | Explicit outbound write. Rebuild fresh candidate using C5, upload immutable objects, atomically commit channel inventory last. Omitted target in partial publish is preserved from latest snapshot only when appVersion matches; versioned release starts empty and freezes requested target set. No later augmentation of same release version. |
| C7 | `npm run assets:download -- [--version 0.1.0]` | Anonymous HTTPS, default latest nightly, dev target only. Verify/extract/install all four roots. No upstream fallback, profile generation or publish credentials. Versioned downloads use exact published version. |
| C8 | `npm run assets:prune -- --local` / `--remote` | Preview only; canonical plan at `generated/asset-delivery/prune-local.json` or `prune-remote.json`. `npm run assets:prune -- --apply <path>` revalidates basis/candidate hashes under lock before removing listed safe files. Unknown or edited local files never candidates. |
| C9 | `npm run assets:migrate -- --plan` / `npm run assets:migrate -- --apply <path>` | One-time old-root copy migration; plan at `generated/asset-delivery/migration-plan.json`, receipt at `generated/asset-delivery/migration-receipt.json`. No deletions. Applies exact recorded hashes only; idempotent same-byte destination adoption. |
| C10 | `npm run assets:prune -- --resume --local` / `--remote` | Recover stored write-ahead prune journal under appropriate locks before any new mutation; no arbitrary replacement plan allowed. |
| C11 | Every command | `--help` exit 0, unknown/mutually exclusive flags exit 2. UTF-8 JSON final stdout object `AssetResult`; stderr JSON progress `{"operation":string,"phase":string,"path":string|null,"bytes":number}`. No credential values, signed URLs or raw provider error bodies. Exit 0 success, 2 expected validation/conflict/resource failures, 1 unexpected internal failure. Error message equals stable `AssetFailureCode`; offending safe path separate. |

C12. Exact npm→script mapping: `assets:setup` → `scripts/asset-delivery-setup.ts`; `assets:profiles:sync` → `scripts/sync-asset-profiles.ts`; `assets:promote` → `scripts/promote-assets.ts`; `assets:migrate` → `scripts/migrate-assets.ts`; `assets:bundle` → `scripts/bundle-assets.ts`; `assets:publish` → `scripts/publish-assets.ts`; `assets:download` → `scripts/download-assets.ts`; `assets:prune` → `scripts/prune-assets.ts`. Each script calls owned exported function from focused `scripts/lib/asset-delivery/` modules. These names are proposed, not existing.
## Object protocol, archive safety, determinism

D1. `asset-delivery.config.json`: `AssetDeliveryConfig`. `publicBaseUrl` is HTTPS custom-domain prefix ending `/`, no credentials/query/fragment; matches R2 `keyPrefix` deployment prefix. Publisher env only: `ASSET_R2_ACCOUNT_ID`, `ASSET_R2_ACCESS_KEY_ID`, `ASSET_R2_SECRET_ACCESS_KEY`; bucket-scoped credentials, never public config. S3 endpoint computed `https://<account>.r2.cloudflarestorage.com`, region `auto`. Existing zip dependency `@zip.js/zip.js` pinned 2.13.1 in inspected package; pin build-only devDependencies `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` to `3.1128.0` (both versions returned by `npm view <package> version` on 2026-09-09), commit lockfile. ZIP source file mode does not affect membership or encoded permissions. No extra CLI needed by developers.

D2. Object keys relative to base: `inventories/<sha>.json`, `dev/manifests/<sha>.json`, `dev/archives/<sha>.zip`, `snapshots/<sha>.json`, `core/manifests/<sha>.json`, `core/archives/<sha>.zip`, `content/indexes/<sha>.json`, `content/catalogs/<sha>.json`, `content/manifests/<sha>.json`, `content/parts/<sha>.zip`. JSON SHA hashes canonical recursively code-point-sorted keys, compact UTF-8 + LF; arrays use schema-defined sorted order. `BundleSnapshot.objects` is unique sorted transitive object closure, excluding own snapshot to avoid self-hash; it includes each target inventory, dev manifest/archive, core manifest/archive, player index/manifests/catalogs/parts including retained history as applicable. Object path embedded digest must match ref.sha256. Inventory ObjectRef appears once in closure.

D3. `channels/index.json` (`PublicationInventory`) is the sole mutable publication commit point. Empty state created explicitly during owner setup, not inferred from arbitrary 404. Its nightly field points to current BundleSnapshot; release entries point to immutable `releases/<version>.json` (`ReleasePointer`). All mutable GETs `Cache-Control: no-store`, browser/cache bypass; immutable objects `public,max-age=31536000,immutable`. Retired timestamps only here, never content hashes. Latest dev nightly does not promise old-checkout reproducibility; schema/layout compatibility checked, appVersion mismatch warns but same layout allowed. Release version match exact. Player builds pin immutable index hash and content base URL; never follow dev nightly automatically mid-session.

D4. Dev ZIP: single streaming archive, ZIP64 permitted, STORE method 0, path order fixed, DOS timestamp 1980-01-01 00:00:00 encoded identically regardless local TZ, UTF-8 names, no comments/optional extras/permissions variability; only required ZIP64 extras allowed. Entry paths exactly `DevManifest.files[].path`; no symlinks/dirs/undeclared/duplicate files. Max archive 16 GiB, max inflated total 16 GiB, max entries 100000, max metadata body 32 MiB, max entry path 512 UTF-8 bytes. Supports originals >4 GiB through ZIP64, streamed I/O; no whole-archive Buffer/Blob. ZIP determinism requires pinned zip implementation/options, test cross OS/TZ. Limits cover current <=10 GB source estimate, not a storage pricing cap.

D5. Player ZIP contract unchanged: parts <=20971520 bytes compressed, <=33554432 inflated, entry <=16777216, <=2048 entries, no ZIP64/split files/encryption/JS/HTML. MIME/structure safety unchanged; bytes need not be valid decoded images. Runtime/Chapter ContentManifest/ContentIndex schemas remain old PWA plan shapes except only chapter-01 accepted by current owner selection. Existing immutable logical URLs remain. `core` files excluded from PLAYER-download archives. Prod producer additionally emits CoreManifest + frozen Node-only core ZIP for build tooling; its ObjectRef is PlayerBundleRef.core, with PlayerBundleRef.inventory pinning that target's original input. Core ZIP follows dev structural streaming format, never fetched by player installer. This build handoff artifact is uploaded so a different build machine can recover exact core bytes, not reread newer workspace files.

D6. Reject absolute/traversal/backslash/colon/NUL/%/?/# paths, empty/dot segments, Windows reserved device names (including extensions), trailing dot/space, case-insensitive collisions and Unicode normalization collisions; validate parents with realpath/lstat immediately before extraction/write, never follow symlink parents. File paths cannot escape four managed roots. JSON parsers reject extra keys, unsafe integers, invalid hashes, wrong schema, duplicate paths, nonfinite values. Dev manifest file set exactly equals archive entries; also equal inventory dev file set. Prod metadata caps inherited from PWA contract. Hash mismatch never installs partial bytes.

D7. Snapshot deterministic inputs = file bytes + profile rules/selection + package appVersion + frozen vendor bytes + frozen RetainedMetadata + PreparedPlayerMetadata + locked tooling. Same inputs → identical inventory, archives, manifests and snapshot regardless invocation time, directory insertion order, machine absolute paths, channel or destination host. Atomic source change guard: file identity/size/mtime checked before/after streaming plus digest; any detected mutation fails `ASSET_SOURCE_CHANGED`, candidate never activated. Freeze staged copies for release publication; no rereading mutable source between hash and upload.

D8. Pure producer retained input is exact RetainedMetadata (old --retained-metadata schema); embedded inside FrozenInventory so its bytes affect inventory/index hashes. Prod/all rejects absent history unless explicit --empty-history local candidate. For a NEW version or nightly, T4 under remote lock reads verified current/release/unexpired-retired indexes and their referenced metadata, deduplicates/sorts SHA/packId refs, materializes immutable per-run history input BEFORE calling private bundle implementation. For an EXISTING version (advertised or orphan create-only releases/<version>.json), verify its snapshot/inventory first and reuse THAT inventory.retainedMetadata exactly; never add the retrying version or later releases to its frozen history. Rebuild using current local asset/profile/prepared-metadata inputs plus original history; any changed candidate then correctly fails ASSET_RELEASE_EXISTS, identical input retry stays identical. Existing-version retry also uses its originally requested immutable target set; changed --target is a conflicting candidate, not augmentation. Releases preserved indefinitely; unexpired-nightly history retained as needed. Current snapshot protects every history object it still advertises, even after 24h; pruning may wait for next prod index build that drops expired-nightly-only refs. Mutable clock is used to choose history externally, never inside pure bundler. Public first-release empty history requires verified explicitly empty state, not arbitrary missing file.

D9. Developer preparation `npm run content:catalog` emits `generated/asset-delivery/prepared-player.json` (PreparedPlayerMetadata). Inputs: `content/chapter-selections.json`, `content/authoring/card-set-source.json`, `content/authoring/chapter-policy.json`, `public/story/shop-sets.v1.json`, mapped runtime catalog/manifest. sourceInputs pins exact input paths/bytes/hashes; runtimeCardCodes and chapter set/card/opponent IDs sorted unique; ChapterContentPolicy emitted as `{schemaVersion:1,chapterId:"chapter-01",setIds,cardCodes,opponentIds}` at `story/policy/chapter-01.json`. This explicit development preparation owns source mapping/support diagnostics; producer/publisher consume prepared schema without invoking preparation or rechecking gameplay/source readiness. Embedded prepared bytes and source digest records are frozen in inventory. Structural missing/unparseable prepared metadata fails prod target only. Existing old content:catalog behavior adapters share implementation, not duplicated commands.

D10. All local writers (setup state output, migration, profile sync/promote, bundle, publish staging, download, local prune/core stage) acquire `generated/.locks/asset-delivery`. Order always local then remote; remote-only writers never acquire local afterward. Public exported entry takes lock once; nested publish→bundle uses private already-locked helper, not reentrant acquisition. Bundle private per-run files owned exclusively until upload ends. Downloads/profile edits cannot mutate roots through tooling while publisher freezes/uploads. External author edits still detected by D7; no source bytes read during upload after freeze.
## PWA integration boundary

B1. Existing `ContentManifest`, `ContentIndex`, `ManifestRef`, `ContentSetRef`, installer/cache/session/save APIs remain planned elsewhere. New producer T3 owns old T2 packaging seam; do not implement another installer here. `contentObjectUrl(baseUrl, kind, sha256)` accepts indexes/catalogs/manifests/parts and returns `<baseUrl>content/<kind>/<sha>.(json|zip)`; validates exact kind/hash/HTTPS prefix; app compiles `__CONTENT_BASE_URL__` plus existing `__CONTENT_INDEX_SHA256__`. Source is new focused `src/content/content-object-url.ts`, exported through classified `src/content/index.ts` public entry, frozen boundary tests adjusted explicitly.

B2. Cloudflare Pages keeps core PWA; R2 custom domain serves immutable external bytes. Anonymous GET/HEAD CORS allowed for exact app dev/prod origins configured at setup; no credentials, no client write permission. Expose Content-Length, ETag, Content-Range, Accept-Ranges as needed; CORS does not grant write access. Browser receiver uses existing hash/size/archive parsers, not trust URL alone. No code uses Node S3 client in browser bundle.

B3. `stageCoreAssets(root,snapshot)` fetches/verifies exact snapshot→prod.inventory/prod.core→CoreManifest→core archive, stages only matching frozen core bytes at `generated/asset-delivery/core/<coreManifestSha>/files/<asset-path>`, emits `generated/asset-delivery/core/<coreManifestSha>/copy-plan.json` (CoreCopyPlan, stagedPath repository-relative). Missing core is ASSET_TARGET_UNAVAILABLE; mismatched manifest/inventory/hash is ASSET_INTEGRITY_FAILED. Never fallback to current workspace bytes. Planned old T8 command `npm run build:pwa -- --asset-snapshot <sha>` invokes staging and consumes matching core copy plan plus pinned prod.index. New T6 implements build-independent staging/adapter tests; old T8 still owns whole PWA build. Prod-only publication carries core build artifact without shipping originals or adding player precache ZIPs. Private build path remains; old T8 removes PWA-path eager generated-runtime config read and static chapter-SVG import before actual app acceptance.

B4. New plan is executable dev/producer/delivery slice. Full native player installation acceptance remains dependent on old PWA T3–T8. Fixture transport tests are not shipped-player proof. Integration handoff amends old producer T2, installer T3 transport URL construction, T8 build pin, T9 Pages-only inventory hosting, T10 hosted assertions; chapter-one amendment remains authoritative.


## Integration links

J1. CLI trigger `package.json` future scripts → `scripts/*asset*.ts` command dispatcher (exact names created in owned slice) → functions above validate payload/config → observable files/JSON result per binding protocol. Tests spawn public npm/Node entry, not only private mocked functions.
J2. Remote boundary for T4/T5/T6: `asset-delivery.config.json.publicBaseUrl` + fixed keys → anonymous HTTPS GET/HEAD for readers / scoped S3 API for publisher → strict schema/hash/archive receiver → immutable object SHA, installed receipt, or existing ContentResult. No secret in observable evidence.
J3. Browser installer receive link currently MISSING if old PWA T3 unlanded. This plan supplies producer + public URL adapter + fixture evidence; native installer activation not claimed complete. Explicit dependency tracked in PWA_HANDOFF.md.

## Implementation evidence — 2026-09-10

E1. Checked implementation items trace to reviewed commit `902fbef`, integrated by `aef9b00`; checkpoint `c705d66` pushed. Independent rechecks closed all eight repair findings. Merged-main focused148/typecheck/build passed; isolated headless/vendor verification, Chromium3, acceptance41 and reproducibility583 passed. Full evidence: `../FINAL_IMPLEMENTATION_REPORT_2026_09_09_complete_asset_tooling.md`.
E2. R7/I5/V7 remain incomplete: actual >4GiB/10GiB disk/RSS/platform proof not run. R2 is implemented, not a claim of executed maximum-size acceptance. Real catalog mapping and hosted/native prerequisites remain missing. Full-suite baseline exception explicitly approved, failing assertion retained in report.
E3. User requested pause after push. No T4/T5 work started.

## TDD

- [x] D1. Red: create listed fixture tests first; capture expected failure identifying missing owned behavior.
- [x] D2. Green: minimum owned impl passes same tests, no blanket mocks of public boundary.
- [x] D3. Refactor only if needed; rerun same tests plus affected existing suites.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| V1. Determinism | Same files, reordered creation, TZ changes, mtimes, different cwd | Identical ZIP/manifests/snapshot SHA |
| V2. All dev bytes | Unused PSD + unreleased image + crop archive | All appear in DevManifest; no core filtering for dev |
| V3. No semantic gate | Malformed JPEG / absent optional art | Existing file bundled opaque; missing art reported, not invented |
| V4. Structural failure | Traversal, duplicate path, oversized player file | ASSET_PATH_UNSAFE/ASSET_ARCHIVE_REJECTED/ASSET_LIMIT_EXCEEDED |
| V5. Core isolation | Core font selected plus chapter image | Font only in shell inventory; art in content ZIP |
| V6. Release freeze | Mutate file after inventory before ZIP completion | ASSET_SOURCE_CHANGED; no active candidate |
| V7. ZIP64 streaming | >4 GiB original, 16 GiB total limit | Valid streamed ZIP64 dev, bounded memory; player rejects large file |
| V8. Player compatibility | Producer outputs fed existing schema parser fixtures | Exact shape/hashes/limits, only chapter-01 |
| V9. Core/history freeze | Retained prod inventory A beside new dev inventory B; release-A history in B | Core/index uses A; old released catalog/manifests reachable; no workspace fallback |

## Impl steps

- [x] I1. Write archive/determinism red fixtures. verify: `node --test tests/asset-delivery-bundle.test.ts`.
- [x] I2. Implement frozen inventory plus streaming dev ZIP. verify: `node --test tests/asset-delivery-bundle.test.ts`.
- [x] I3. Implement old PWA producer seam using bounded parts. verify: `node --test tests/asset-delivery-bundle.test.ts`.
- [x] I4. Prove no implicit semantic validation in CLI dependency graph. verify: `node --test tests/asset-delivery-bundle.test.ts`.
- [ ] I5. Measure real large-file stream and repeatability on approved disk. verify: `Owner-run large-file fixture; capture peak RSS/disk/ZIP64 result separately`.

## Validation

- [x] C1. `node --test tests/asset-delivery-contracts.test.ts tests/asset-delivery-profiles.test.ts tests/asset-delivery-bundle.test.ts` exits 0; capture real output, distinguish baseline failures.
- [x] C2. `npm run vendor:verify` exits 0; capture real output, distinguish baseline failures.
- [x] C3. `npm run typecheck` exits 0; capture real output, distinguish baseline failures.
- [x] C4. CLI help/manual smoke matches contract; real remote writes require owner authorization, otherwise label hosted evidence pending.
- [x] C5. No silent failure swallow introduced: inventory all catches/background promises; `|| true`, empty catch, suppressed stderr, unobserved promises = none unless explicit site + reason reviewed.
- [x] C6. App functional: affected existing dev/build path retained; missing external PWA/source prerequisites documented rather than false green.
- [x] C7. Diff contains only owned intentional paths; user originals, feedback, frozen vendor byte-identical; no staged secrets.
- [x] C8. Implementation commit `902fbef`: `feat(assets): produce reproducible verified delivery bundles`; normal merge `aef9b00`. verify: `git show --stat 902fbef`; remote checkpoint `c705d66` verified.
