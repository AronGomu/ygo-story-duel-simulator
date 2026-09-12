import {
  parseContentIndex,
  parseContentManifest,
  type ContentIndex,
  type ContentManifest,
} from "../../../src/content/index.ts";
import { parseBundleSnapshot, type BundleSnapshot } from "./bundle-snapshot.ts";
import { parseObjectRef, type ObjectRef } from "./object-ref.ts";
import { parseFrozenInventory } from "./frozen-inventory.ts";
import { parseDevManifest } from "./dev-manifest.ts";
import { parseCoreManifest } from "./core-manifest.ts";
import { canonicalBytes, parseJsonBytes } from "./canonical-json.ts";
import {
  digestSource,
  readSource,
  readSourceJson,
  sameDigest,
} from "./source-files.ts";
import { contentValue, walkContentClosure } from "./content-closure.ts";
import { objectRef } from "./bundle-objects.ts";
import { playerPayload } from "./player-payload.ts";
import { verifyArchive } from "./verify-archive.ts";
import { object, version } from "./schema.ts";
import { assertSafePath } from "./path-guards.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import { verifyChapterGameplay } from "./verify-chapter-gameplay.ts";

function same(a: unknown, b: unknown): void {
  if (!Buffer.from(canonicalBytes(a)).equals(Buffer.from(canonicalBytes(b))))
    fail("ASSET_INTEGRITY_FAILED");
}
/** Exact object closure + file/archive verification. Read-only; no installation/network. */
export async function verifyBundle(
  root: string,
  run: string,
): Promise<BundleSnapshot> {
  assertSafePath(run);
  if (!/^generated\/asset-delivery\/runs\/[a-f0-9-]{36}$/.test(run))
    fail("ASSET_PATH_UNSAFE");
  const pointer = object(await readSourceJson(root, `${run}/candidate.json`), {
    schemaVersion: version,
    snapshot: parseObjectRef,
  });
  if (!pointer.snapshot.key.startsWith("snapshots/"))
    fail("ASSET_INTEGRITY_FAILED");
  const reachable = new Map<string, ObjectRef>();
  const checked = new Map<string, unknown>();
  const load = async (ref: ObjectRef, json = true): Promise<unknown> => {
    parseObjectRef(ref);
    const prior = reachable.get(ref.key);
    if (prior && !sameDigest(prior, ref)) fail("ASSET_INTEGRITY_FAILED");
    if (checked.has(ref.key)) return checked.get(ref.key);
    reachable.set(ref.key, ref);
    const file = `${run}/objects/${ref.key}`;
    if (!json) {
      if (!sameDigest(await digestSource(root, file), ref))
        fail("ASSET_INTEGRITY_FAILED", ref.key);
      checked.set(ref.key, null);
      return null;
    }
    const content = await readSource(root, file, true);
    if (!sameDigest(content.digest, ref))
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    const value = parseJsonBytes(content.bytes!);
    if (!Buffer.from(canonicalBytes(value)).equals(Buffer.from(content.bytes!)))
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    checked.set(ref.key, value);
    return value;
  };
  const snapshot = parseBundleSnapshot(await load(pointer.snapshot));
  reachable.delete(pointer.snapshot.key);
  const inventory = parseFrozenInventory(await load(snapshot.inventory));
  if (inventory.appVersion !== snapshot.appVersion)
    fail("ASSET_INTEGRITY_FAILED");
  if (snapshot.dev) {
    const dev = parseDevManifest(await load(snapshot.dev));
    const input = parseFrozenInventory(await load(dev.inventory));
    if (
      dev.appVersion !== snapshot.appVersion ||
      input.appVersion !== snapshot.appVersion
    )
      fail("ASSET_INTEGRITY_FAILED");
    same(
      dev.files,
      input.files.map((f) => ({
        path: f.path,
        bytes: f.bytes,
        sha256: f.sha256,
      })),
    );
    await load(dev.archive, false);
    await verifyArchive(
      root,
      `${run}/objects/${dev.archive.key}`,
      dev.archive,
      dev.files,
    );
  }
  if (snapshot.prod) {
    const prod = snapshot.prod;
    const input = parseFrozenInventory(await load(prod.inventory));
    const core = parseCoreManifest(await load(prod.core));
    same(core.inventory, prod.inventory);
    if (
      core.appVersion !== snapshot.appVersion ||
      input.appVersion !== snapshot.appVersion ||
      prod.runtimeSnapshotId !== input.runtimeSnapshotId ||
      !input.playerMetadata ||
      input.playerMetadata.chapters.length !== 1
    )
      fail("ASSET_INTEGRITY_FAILED");
    same(
      core.files,
      input.files
        .filter((f) => f.profile === "core")
        .map((f) => ({
          path: f.path,
          logicalPath: f.logicalPath,
          bytes: f.bytes,
          sha256: f.sha256,
        })),
    );
    await load(core.archive, false);
    await verifyArchive(
      root,
      `${run}/objects/${core.archive.key}`,
      core.archive,
      core.files,
    );
    const index = contentValue(parseContentIndex(await load(prod.index)));
    if (
      index.runtimeSnapshotId !== prod.runtimeSnapshotId ||
      index.releaseId !== `${snapshot.appVersion}+${prod.inventory.sha256}`
    )
      fail("ASSET_INTEGRITY_FAILED");
    same(index.retainedCatalogs, input.retainedMetadata.catalogs);
    same(index.retainedManifests, input.retainedMetadata.manifests);
    const manifests = new Map<string, ContentManifest>();
    const indexes: ContentIndex[] = [];
    await walkContentClosure([prod.index], async (ref, json) => {
      const value = await load(ref, json);
      if (ref.key.startsWith("content/manifests/"))
        manifests.set(ref.sha256, contentValue(parseContentManifest(value)));
      else if (json) indexes.push(contentValue(parseContentIndex(value)));
      return value;
    });
    const prepared = input.playerMetadata;
    const chapter = prepared.chapters[0]!;
    if (
      index.chapters[0]!.title !== chapter.title ||
      index.chapters[0]!.description !== chapter.description ||
      (index.chapters[0]!.status === "published") !==
        input.selection.profiles.includes("chapter-01")
    )
      fail("ASSET_INTEGRITY_FAILED");
    for (const ref of [
      index.runtime,
      ...index.chapters.flatMap((c) =>
        c.status === "published" ? [c.manifest] : [],
      ),
    ]) {
      const manifest = manifests.get(ref.sha256);
      if (!manifest) fail("ASSET_INTEGRITY_FAILED");
      same(
        manifest.cardCodes,
        ref.packId === "runtime"
          ? prepared.runtimeCardCodes
          : chapter.cardCodes,
      );
      same(
        manifest.opponentIds,
        ref.packId === "runtime" ? [] : chapter.opponentIds,
      );
      same(
        manifest.storyContentId,
        ref.packId === "runtime" ? null : chapter.storyContentId,
      );
      same(
        manifest.gameplayPath,
        ref.packId === "runtime"
          ? null
          : `chapters/${ref.packId}/gameplay.json`,
      );
      const digest = (f: { path: string; bytes: number; sha256: string }) => ({
        path: f.path,
        bytes: f.bytes,
        sha256: f.sha256,
      });
      same(
        manifest.files.map(digest),
        playerPayload(input, ref.packId).map(digest),
      );
    }
    for (const index of indexes) {
      for (const ref of index.retainedManifests) {
        if (manifests.get(ref.sha256)?.packId !== ref.packId)
          fail("ASSET_INTEGRITY_FAILED");
      }
      for (const ref of [
        index.runtime,
        ...index.chapters.flatMap((c) =>
          c.status === "published" ? [c.manifest] : [],
        ),
      ]) {
        const manifest = manifests.get(ref.sha256);
        if (
          !manifest ||
          manifest.packId !== ref.packId ||
          manifest.runtimeSnapshotId !== index.runtimeSnapshotId
        )
          fail("ASSET_INTEGRITY_FAILED");
        if (ref.packId === "chapter-01")
          same(manifest.dependencies, [index.runtime]);
      }
    }
    const capturedFiles = new Map<string, Uint8Array>();
    for (const manifest of manifests.values()) {
      for (const dependency of manifest.dependencies) {
        const required = manifests.get(dependency.sha256);
        if (
          !required ||
          required.packId !== dependency.packId ||
          required.runtimeSnapshotId !== manifest.runtimeSnapshotId
        )
          fail("ASSET_INTEGRITY_FAILED");
      }
      const embeddedFile =
        manifest.packId === "runtime"
          ? manifest.files.find(
              (file) => file.path === "runtime/current/manifest.json",
            )
          : undefined;
      if (manifest.packId === "runtime" && !embeddedFile)
        fail("ASSET_INTEGRITY_FAILED");
      for (const part of manifest.parts) {
        const ref = objectRef("content/parts", part);
        const partFiles = manifest.files.filter(
          (file) => file.partSha256 === ref.sha256,
        );
        const captures = partFiles.filter(
          (file) =>
            file === embeddedFile ||
            /^runtime\/assets\/current\/catalog\/(?:cards|texts\/en)\/[a-f0-9]{2}\.json$/.test(
              file.path,
            ) ||
            /^chapters\/chapter-(?:0[1-9]|[1-9][0-9])\/(?:gameplay|story)\.json$/.test(
              file.path,
            ),
        );
        const captured = await verifyArchive(
          root,
          `${run}/objects/${ref.key}`,
          ref,
          partFiles.map((file) => ({
            path: file.entry,
            bytes: file.bytes,
            sha256: file.sha256,
          })),
          true,
          captures.map((file) => file.entry),
        );
        for (const file of captures) {
          const bytes = captured.get(file.entry);
          if (!bytes) fail("ASSET_INTEGRITY_FAILED");
          capturedFiles.set(file.path, bytes);
        }
        if (embeddedFile?.partSha256 === part.sha256) {
          const embeddedBytes = captured.get(embeddedFile.entry);
          if (!embeddedBytes) fail("ASSET_INTEGRITY_FAILED");
          let embedded: unknown;
          try {
            embedded = parseJsonBytes(embeddedBytes);
          } catch (error) {
            if (
              error instanceof AssetDeliveryError &&
              error.code === "ASSET_CONFIG_INVALID"
            )
              fail("ASSET_INTEGRITY_FAILED");
            throw error;
          }
          if (
            !embedded ||
            typeof embedded !== "object" ||
            !("schemaVersion" in embedded) ||
            embedded.schemaVersion !== 1 ||
            !("snapshotId" in embedded) ||
            embedded.snapshotId !== manifest.runtimeSnapshotId
          )
            fail("ASSET_INTEGRITY_FAILED");
        }
      }
    }
    verifyChapterGameplay({
      index,
      manifests,
      captured: capturedFiles,
      prepared,
    });
  }
  same(
    snapshot.objects,
    [...reachable.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
  );
  return snapshot;
}
