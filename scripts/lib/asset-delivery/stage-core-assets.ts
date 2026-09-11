import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { parseBundleSnapshot } from "./bundle-snapshot.ts";
import {
  canonicalBytes,
  compareCodePoints,
  parseJsonBytes,
} from "./canonical-json.ts";
import { parseCoreCopyPlan, type CoreCopyPlan } from "./core-copy-plan.ts";
import { parseCoreManifest } from "./core-manifest.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import {
  defaultDownloadDependencies,
  downloadArchive,
  fetchObjectBytes,
  type DownloadDependencies as TransportDependencies,
} from "./download-transport.ts";
import { extractArchive } from "./extract-dev-archive.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import { parseFrozenInventory } from "./frozen-inventory.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { objectRefIn, type ObjectRef } from "./object-ref.ts";
import { assertSafeParents } from "./path-guards.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import {
  digestSource,
  readSourceJson,
  sameDigest,
  sourceFiles,
  sourceStat,
} from "./source-files.ts";

export interface StageCoreDependencies extends TransportDependencies {
  readonly progress?: (
    phase: string,
    path?: string | null,
    bytes?: number,
  ) => void;
}

const sameRef = (left: ObjectRef, right: ObjectRef) =>
  left.key === right.key && sameDigest(left, right);

function parseVerifiedJson<T>(
  bytes: Uint8Array,
  parse: (value: unknown) => T,
  safePath: string,
): T {
  const value = parseJsonBytes(bytes);
  if (!Buffer.from(canonicalBytes(value)).equals(Buffer.from(bytes)))
    fail("ASSET_INTEGRITY_FAILED", safePath);
  return parse(value);
}

async function loadObject<T>(
  baseUrl: string,
  ref: ObjectRef,
  dependencies: StageCoreDependencies,
  parse: (value: unknown) => T,
  missingCore = false,
): Promise<T> {
  dependencies.progress?.("fetch", ref.key, ref.bytes);
  try {
    return parseVerifiedJson(
      await fetchObjectBytes(baseUrl, ref, dependencies),
      parse,
      ref.key,
    );
  } catch (error) {
    if (
      missingCore &&
      error instanceof AssetDeliveryError &&
      error.code === "ASSET_REVISION_UNAVAILABLE"
    )
      fail("ASSET_TARGET_UNAVAILABLE", ref.key);
    throw error;
  }
}

async function assertStageSpace(root: string, bytes: number): Promise<void> {
  const stats = await statfs(root, { bigint: true });
  if (stats.bavail * stats.bsize < BigInt(bytes)) fail("ASSET_DISK_FULL");
}

async function installStagedFiles(
  root: string,
  temporary: string,
  destination: string,
  files: CoreCopyPlan["files"],
): Promise<void> {
  for (const file of files) {
    const relative = file.stagedPath.slice(`${destination}/`.length);
    const source = `${temporary}/${relative}`;
    const current = await sourceStat(root, file.stagedPath);
    if (current) {
      if (
        !current.isFile() ||
        !sameDigest(await digestSource(root, file.stagedPath), file)
      )
        fail("ASSET_INTEGRITY_FAILED", file.stagedPath);
      continue;
    }
    const target = await assertSafeParents(root, file.stagedPath);
    await mkdir(path.dirname(target), { recursive: true });
    await assertSafeParents(root, file.stagedPath);
    await rename(
      await assertSafeParents(root, source),
      await assertSafeParents(root, file.stagedPath),
    );
  }
  const actual = await sourceFiles(root, destination, true);
  const expected = files.map((file) => file.stagedPath).sort(compareCodePoints);
  if (
    actual.length !== expected.length ||
    actual.some((file, index) => file !== expected[index])
  )
    fail("ASSET_INTEGRITY_FAILED", destination);
}

/** Fetch exact published prod/core refs; never reads current workspace asset bytes. */
export async function stageCoreAssets(
  root: string,
  snapshotValue: ObjectRef,
  dependencies: StageCoreDependencies = defaultDownloadDependencies,
): Promise<CoreCopyPlan> {
  const snapshotRef = objectRefIn("snapshots")(snapshotValue);
  const config = parseAssetDeliveryConfig(
    await readSourceJson(root, "asset-delivery.config.json"),
  );
  const release = await acquireAssetDeliveryLock(root);
  try {
    const snapshot = await loadObject(
      config.publicBaseUrl,
      snapshotRef,
      dependencies,
      parseBundleSnapshot,
    );
    if (!snapshot.prod) fail("ASSET_TARGET_UNAVAILABLE", snapshotRef.key);
    const prod = snapshot.prod;
    const inventory = await loadObject(
      config.publicBaseUrl,
      prod.inventory,
      dependencies,
      parseFrozenInventory,
    );
    const manifest = await loadObject(
      config.publicBaseUrl,
      prod.core,
      dependencies,
      parseCoreManifest,
      true,
    );
    const expectedFiles = inventory.files
      .filter((file) => file.profile === "core")
      .map((file) => ({
        path: file.path,
        logicalPath: file.logicalPath,
        bytes: file.bytes,
        sha256: file.sha256,
      }));
    if (
      !sameRef(manifest.inventory, prod.inventory) ||
      inventory.appVersion !== snapshot.appVersion ||
      manifest.appVersion !== snapshot.appVersion ||
      manifest.files.length !== expectedFiles.length ||
      manifest.files.some((file, index) => {
        const expected = expectedFiles[index];
        return (
          !expected ||
          file.path !== expected.path ||
          file.logicalPath !== expected.logicalPath ||
          !sameDigest(file, expected)
        );
      }) ||
      !snapshot.objects.some((ref) => sameRef(ref, manifest.archive))
    )
      fail("ASSET_INTEGRITY_FAILED");

    await assertStageSpace(
      root,
      manifest.archive.bytes +
        manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    );
    let archivePath: string;
    try {
      archivePath = await downloadArchive(
        root,
        config.publicBaseUrl,
        manifest.archive,
        dependencies,
      );
    } catch (error) {
      if (
        error instanceof AssetDeliveryError &&
        error.code === "ASSET_REVISION_UNAVAILABLE"
      )
        fail("ASSET_TARGET_UNAVAILABLE", manifest.archive.key);
      throw error;
    }

    const destination = `generated/asset-delivery/core/${prod.core.sha256}/files`;
    const temporary = `generated/asset-delivery/core/${prod.core.sha256}/staging/${randomUUID()}`;
    try {
      dependencies.progress?.(
        "verify-extract",
        manifest.archive.key,
        manifest.archive.bytes,
      );
      await extractArchive(
        root,
        archivePath,
        manifest.archive,
        manifest.files,
        temporary,
      );
      const plan = parseCoreCopyPlan({
        schemaVersion: 1,
        snapshot: snapshotRef,
        prodInventory: prod.inventory,
        coreManifest: prod.core,
        files: manifest.files.map((file) => ({
          stagedPath: `${destination}/${file.path}`,
          logicalPath: file.logicalPath,
          bytes: file.bytes,
          sha256: file.sha256,
        })),
      });
      await installStagedFiles(root, temporary, destination, plan.files);
      const planPath = `generated/asset-delivery/core/${prod.core.sha256}/copy-plan.json`;
      await replaceMetadata(root, planPath, plan);
      dependencies.progress?.("complete", planPath, plan.files.length);
      return plan;
    } finally {
      await rm(await assertSafeParents(root, temporary), {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      fail("ASSET_DISK_FULL");
    throw error;
  } finally {
    await release();
  }
}
