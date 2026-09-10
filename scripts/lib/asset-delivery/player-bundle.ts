import { frozenSourcePath } from "./frozen-source-path.ts";
import {
  parseContentIndex,
  parseContentManifest,
  type ContentIndex,
  type ContentManifest,
  type ContentMediaType,
  type ManifestRef,
  type PackedFile,
  type PackId,
  type ZipPart,
} from "../../../src/content/index.ts";
import type { FrozenInventory } from "./frozen-inventory.ts";
import type { ObjectRef } from "./object-ref.ts";
import type { PlayerBundleRef } from "./bundle-snapshot.ts";
import type { BundleObjects } from "./bundle-objects.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { chapterPolicyBytes, playerPayload } from "./player-payload.ts";
import { readSourceJson } from "./source-files.ts";
import {
  writeArchive,
  playerArchiveBytes,
  type ArchiveFile,
} from "./write-archive.ts";
import { assertNoPathCollisions } from "./path-guards.ts";
import { parseCoreManifest } from "./core-manifest.ts";
import { contentValue } from "./content-closure.ts";
import { fail } from "./failure.ts";

interface PlayerFile extends ArchiveFile {
  readonly mediaType: ContentMediaType;
}
function mediaType(file: string): ContentMediaType {
  const types: Readonly<Record<string, ContentMediaType>> = {
    json: "application/json",
    wasm: "application/wasm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    svg: "image/svg+xml",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  const type = types[file.split(".").at(-1)!];
  if (!type) fail("ASSET_ARCHIVE_REJECTED", file);
  return type;
}
async function pack(
  store: BundleObjects,
  inventory: FrozenInventory,
  packId: PackId,
  files: readonly PlayerFile[],
  dependencies: readonly ManifestRef[],
): Promise<ManifestRef> {
  const ordered = [...files].sort((a, b) => compareCodePoints(a.path, b.path));
  assertNoPathCollisions(ordered.map((f) => f.path));
  if (ordered.length > 50000) fail("ASSET_LIMIT_EXCEEDED");
  const groups: PlayerFile[][] = [];
  let group: PlayerFile[] = [];
  let bytes = 22;
  for (const file of ordered) {
    if (file.bytes > 16777216) fail("ASSET_LIMIT_EXCEEDED", file.path);
    const entryBytes = playerArchiveBytes([file]) - 22;
    if (
      group.length &&
      (group.length === 2048 || bytes + entryBytes > 20971520)
    ) {
      groups.push(group);
      group = [];
      bytes = 22;
    }
    group.push(file);
    bytes += entryBytes;
  }
  if (group.length) groups.push(group);
  const parts: ZipPart[] = [];
  const packed: PackedFile[] = [];
  for (const [index, group] of groups.entries()) {
    const archive = await store.archive(
      "content/parts",
      await writeArchive(
        store.root,
        `${store.run}/archives/${packId}-${index}.zip`,
        group,
        true,
      ),
    );
    parts.push({
      sha256: archive.sha256,
      bytes: archive.bytes,
      unpackedBytes: group.reduce((n, f) => n + f.bytes, 0),
    });
    packed.push(
      ...group.map((f) => ({
        path: f.path,
        bytes: f.bytes,
        sha256: f.sha256,
        mediaType: f.mediaType,
        partSha256: archive.sha256,
        entry: f.path,
      })),
    );
  }
  const metadata = inventory.playerMetadata!;
  const chapter = metadata.chapters[0]!;
  const manifest: ContentManifest = contentValue(
    parseContentManifest({
      schemaVersion: 1,
      packId,
      runtimeSnapshotId: metadata.runtimeSnapshotId,
      storyContentId: packId === "runtime" ? null : chapter.storyContentId,
      dependencies,
      cardCodes:
        packId === "runtime" ? metadata.runtimeCardCodes : chapter.cardCodes,
      opponentIds: packId === "runtime" ? [] : chapter.opponentIds,
      parts,
      files: packed,
    }),
  );
  const ref = await store.json("content/manifests", manifest, 4194304);
  return { packId, bytes: ref.bytes, sha256: ref.sha256 };
}

export async function buildPlayerBundle(
  store: BundleObjects,
  inventory: FrozenInventory,
  inventoryRef: ObjectRef,
): Promise<PlayerBundleRef> {
  const metadata = inventory.playerMetadata;
  if (
    !metadata ||
    metadata.chapters.length !== 1 ||
    !inventory.selection.profiles.includes("runtime") ||
    !inventory.selection.profiles.includes("core") ||
    inventory.selection.profiles.some(
      (id) => !["core", "runtime", "chapter-01"].includes(id),
    )
  )
    fail("ASSET_TARGET_UNAVAILABLE");
  const stagedPolicy = `${store.run}/derived/chapter-01.json`;
  const selected = (id: PackId): PlayerFile[] =>
    playerPayload(inventory, id).map((f) => ({
      path: f.path,
      bytes: f.bytes,
      sha256: f.sha256,
      stagedPath:
        f.sourcePath === null
          ? stagedPolicy
          : frozenSourcePath(store.run, f.sourcePath),
      mediaType: mediaType(f.path),
    }));
  const runtime = selected("runtime");
  const manifestFile = runtime.find(
    (f) => f.path === "runtime/current/manifest.json",
  );
  if (!manifestFile) fail("ASSET_TARGET_UNAVAILABLE");
  const manifest = await readSourceJson(store.root, manifestFile.stagedPath);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("schemaVersion" in manifest) ||
    manifest.schemaVersion !== 1 ||
    !("snapshotId" in manifest) ||
    manifest.snapshotId !== metadata.runtimeSnapshotId
  )
    fail("ASSET_TARGET_UNAVAILABLE", "runtime/current/manifest.json");
  const chapter = selected("chapter-01");
  await store.bytes(stagedPolicy, chapterPolicyBytes(inventory));
  assertNoPathCollisions(
    [
      ...runtime,
      ...chapter,
      ...inventory.files
        .filter((f) => f.profile === "core")
        .map((f) => ({ path: f.logicalPath! })),
    ].map((f) => f.path),
  );
  const runtimeRef = await pack(store, inventory, "runtime", runtime, []);
  const chapterRef = inventory.selection.profiles.includes("chapter-01")
    ? await pack(store, inventory, "chapter-01", chapter, [runtimeRef])
    : null;
  const index: ContentIndex = contentValue(
    parseContentIndex({
      schemaVersion: 1,
      releaseId: `${inventory.appVersion}+${inventoryRef.sha256}`,
      runtimeSnapshotId: metadata.runtimeSnapshotId,
      runtime: runtimeRef,
      chapters: [
        chapterRef
          ? {
              id: "chapter-01",
              title: metadata.chapters[0]!.title,
              status: "published",
              manifest: chapterRef,
            }
          : {
              id: "chapter-01",
              title: metadata.chapters[0]!.title,
              status: "unreleased",
            },
      ],
      retainedCatalogs: inventory.retainedMetadata.catalogs,
      retainedManifests: inventory.retainedMetadata.manifests,
    }),
  );
  const indexRef = await store.json("content/indexes", index, 1048576);
  await store.json("content/catalogs", index, 1048576);
  const coreFiles = inventory.files
    .filter((f) => f.profile === "core")
    .map((f) => ({
      path: f.path,
      logicalPath: f.logicalPath!,
      bytes: f.bytes,
      sha256: f.sha256,
    }));
  const archive = await store.archive(
    "core/archives",
    await writeArchive(
      store.root,
      `${store.run}/archives/core.zip`,
      coreFiles.map((f) => ({
        ...f,
        stagedPath: frozenSourcePath(store.run, f.path),
      })),
    ),
  );
  const core = await store.json(
    "core/manifests",
    parseCoreManifest({
      schemaVersion: 1,
      appVersion: inventory.appVersion,
      inventory: inventoryRef,
      archive,
      files: coreFiles,
    }),
  );
  return {
    inventory: inventoryRef,
    core,
    index: indexRef,
    runtimeSnapshotId: metadata.runtimeSnapshotId,
  };
}
