import { statfs } from "node:fs/promises";
import type { AssetResult } from "./asset-result.ts";
import type { Channel } from "./identity.ts";
import { canonicalBytes, parseJsonBytes } from "./canonical-json.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import { parseBundleSnapshot } from "./bundle-snapshot.ts";
import { parsePublicationInventory } from "./publication-inventory.ts";
import { parseReleasePointer } from "./release-pointer.ts";
import { parseDevManifest } from "./dev-manifest.ts";
import { parseFrozenInventory } from "./frozen-inventory.ts";
import type { ObjectRef } from "./object-ref.ts";
import { readSourceJson, sameDigest } from "./source-files.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import {
  defaultDownloadDependencies,
  downloadArchive,
  fetchMutableBytes,
  fetchObjectBytes,
  type DownloadDependencies as TransportDependencies,
} from "./download-transport.ts";
import { extractDevArchive } from "./extract-dev-archive.ts";
import {
  installDevFilesAlreadyLocked,
  recoverInstallAlreadyLocked,
} from "./install-dev-assets.ts";

export interface DownloadDependencies extends TransportDependencies {
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
  dependencies: DownloadDependencies,
  parse: (value: unknown) => T,
): Promise<T> {
  dependencies.progress?.("fetch", ref.key, ref.bytes);
  return parseVerifiedJson(
    await fetchObjectBytes(baseUrl, ref, dependencies),
    parse,
    ref.key,
  );
}

async function assertDownloadSpace(root: string, bytes: number) {
  const stats = await statfs(root, { bigint: true });
  if (stats.bavail * stats.bsize < BigInt(bytes)) fail("ASSET_DISK_FULL");
}

async function selectedSnapshot(
  baseUrl: string,
  channel: Channel,
  dependencies: DownloadDependencies,
): Promise<ObjectRef> {
  dependencies.progress?.("resolve", "channels/index.json");
  const state = parseVerifiedJson(
    await fetchMutableBytes(`${baseUrl}channels/index.json`, dependencies),
    parsePublicationInventory,
    "channels/index.json",
  );
  if (channel.kind === "nightly") {
    if (!state.nightly) fail("ASSET_TARGET_UNAVAILABLE");
    return state.nightly;
  }
  const release = state.releases.find(
    (entry) => entry.version === channel.version,
  );
  if (!release) fail("ASSET_REVISION_UNAVAILABLE");
  const pointer = await loadObject(
    baseUrl,
    release.pointer,
    dependencies,
    parseReleasePointer,
  );
  if (pointer.version !== channel.version)
    fail("ASSET_INTEGRITY_FAILED", release.pointer.key);
  return pointer.snapshot;
}

async function downloadSelected(
  root: string,
  channel: Channel,
  baseUrl: string,
  dependencies: DownloadDependencies,
): Promise<string> {
  const snapshotRef = await selectedSnapshot(baseUrl, channel, dependencies);
  const snapshot = await loadObject(
    baseUrl,
    snapshotRef,
    dependencies,
    parseBundleSnapshot,
  );
  if (!snapshot.dev) fail("ASSET_TARGET_UNAVAILABLE");
  const manifest = await loadObject(
    baseUrl,
    snapshot.dev,
    dependencies,
    parseDevManifest,
  );
  const inventory = await loadObject(
    baseUrl,
    snapshot.inventory,
    dependencies,
    parseFrozenInventory,
  );
  if (
    !sameRef(manifest.inventory, snapshot.inventory) ||
    manifest.appVersion !== snapshot.appVersion ||
    inventory.appVersion !== snapshot.appVersion ||
    !snapshot.objects.some((ref) => sameRef(ref, manifest.archive)) ||
    manifest.files.length !== inventory.files.length ||
    manifest.files.some((file, index) => {
      const selected = inventory.files[index];
      return (
        !selected || file.path !== selected.path || !sameDigest(file, selected)
      );
    })
  )
    fail("ASSET_INTEGRITY_FAILED");
  const packageJson = (await readSourceJson(root, "package.json")) as {
    version?: unknown;
  };
  if (packageJson.version !== snapshot.appVersion)
    dependencies.progress?.("app-version-mismatch", "package.json");

  const totalFiles = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  await assertDownloadSpace(root, manifest.archive.bytes + totalFiles);
  const archivePath = await downloadArchive(
    root,
    baseUrl,
    manifest.archive,
    dependencies,
  );
  dependencies.progress?.(
    "verify-extract",
    manifest.archive.key,
    manifest.archive.bytes,
  );
  const stage = await extractDevArchive(
    root,
    archivePath,
    manifest.archive,
    manifest.files,
    snapshotRef.sha256,
  );
  dependencies.progress?.("install-preflight", null, totalFiles);
  const receipt = await installDevFilesAlreadyLocked(
    root,
    snapshotRef.sha256,
    manifest.files,
    stage,
  );
  dependencies.progress?.(
    "complete",
    INSTALL_SUMMARY_PATH,
    receipt.files.length,
  );
  return snapshotRef.sha256;
}

const INSTALL_SUMMARY_PATH = "assets/.install-receipt.json";

export async function downloadAssets(
  root: string,
  channel: Channel,
  dependencies: DownloadDependencies = defaultDownloadDependencies,
): Promise<AssetResult> {
  const config = parseAssetDeliveryConfig(
    await readSourceJson(root, "asset-delivery.config.json"),
  );
  const release = await acquireAssetDeliveryLock(root, undefined, "install");
  try {
    await recoverInstallAlreadyLocked(root);
    for (let resolution = 0; ; resolution++) {
      try {
        const snapshotSha256 = await downloadSelected(
          root,
          channel,
          config.publicBaseUrl,
          dependencies,
        );
        return {
          status: "ok",
          operation: "download",
          snapshotSha256,
        };
      } catch (error) {
        if (
          channel.kind === "nightly" &&
          resolution === 0 &&
          error instanceof AssetDeliveryError &&
          error.code === "ASSET_REVISION_UNAVAILABLE" &&
          error.path !== null
        ) {
          dependencies.progress?.("nightly-reresolve", error.path);
          continue;
        }
        throw error;
      }
    }
  } finally {
    await release();
  }
}
