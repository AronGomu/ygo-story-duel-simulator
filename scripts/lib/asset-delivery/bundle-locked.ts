import { frozenSourcePath } from "./frozen-source-path.ts";
import type { BigIntStats } from "node:fs";
import { parseBundleSnapshot, type BundleSnapshot } from "./bundle-snapshot.ts";
import { parseChannel, type Channel, type TargetOption } from "./identity.ts";
import {
  parseRetainedMetadata,
  type RetainedMetadata,
} from "./retained-metadata.ts";
import {
  parsePreparedPlayerMetadata,
  type PreparedPlayerMetadata,
} from "./prepared-player-metadata.ts";
import { ASSET_ROOTS } from "./path-guards.ts";
import { createBundleObjects } from "./bundle-objects.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import { EMPTY_RETAINED_METADATA, scanAssetProfiles } from "./scan-assets.ts";
import { loadProfiles, loadSelection } from "./profile-set.ts";
import {
  readSourceJson,
  sameFile,
  sourceFiles,
  sourceStat,
} from "./source-files.ts";
import { freezeFile, type StreamObservation } from "./freeze-file.ts";
import { writeArchive } from "./write-archive.ts";
import { parseDevManifest } from "./dev-manifest.ts";
import { buildPlayerBundle } from "./player-bundle.ts";
import { historyRefs, walkContentClosure } from "./content-closure.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import type { ObjectRef } from "./object-ref.ts";
import { verifyBundle } from "./verify-bundle.ts";
import { AssetDeliveryError, fail } from "./failure.ts";

export interface BundleCandidate {
  readonly run: string;
  readonly snapshot: BundleSnapshot;
  readonly snapshotRef: ObjectRef;
}
interface BundleOptions {
  readonly retainedObjects?: string;
  readonly onFreezeChunk?: StreamObservation;
}
const equal = (a: unknown, b: unknown): boolean =>
  Buffer.from(canonicalBytes(a)).equals(Buffer.from(canonicalBytes(b)));
async function assetPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const family of ASSET_ROOTS)
    paths.push(...(await sourceFiles(root, `assets/${family}`)));
  return paths.sort(compareCodePoints);
}

/** T4 private seam: caller already owns common local lock for the entire candidate lifetime.
 * Retained object bytes are explicit local staging, not inferred from old generated sources.
 */
export async function bundleAlreadyLocked(
  root: string,
  target: TargetOption,
  channel: Channel,
  retainedMetadata: RetainedMetadata,
  playerMetadata: PreparedPlayerMetadata | null,
  options: BundleOptions = {},
): Promise<BundleCandidate> {
  if (
    !["dev", "prod", "all"].includes(target) ||
    !channel ||
    (channel.kind !== "nightly" && channel.kind !== "release")
  )
    fail("ASSET_ARGUMENT_INVALID");
  channel = parseChannel(channel);
  const history = parseRetainedMetadata(
    target === "dev" ? EMPTY_RETAINED_METADATA : retainedMetadata,
  );
  let player: PreparedPlayerMetadata | null = null;
  if (target !== "dev" && playerMetadata !== null) {
    try {
      player = parsePreparedPlayerMetadata(playerMetadata);
    } catch (error) {
      if (
        error instanceof AssetDeliveryError &&
        error.code === "ASSET_CONFIG_INVALID"
      )
        fail("ASSET_TARGET_UNAVAILABLE");
      throw error;
    }
  }
  if (target !== "dev" && player === null) fail("ASSET_TARGET_UNAVAILABLE");
  const selection = await loadSelection(root);
  const profiles = await loadProfiles(root);
  const initial = await assetPaths(root);
  const identities = new Map<string, BigIntStats>();
  for (const file of [
    ...initial,
    ...(player
      ? [
          "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
          "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json",
        ]
      : []),
  ]) {
    const info = await sourceStat(root, file);
    if (!info) fail("ASSET_SOURCE_CHANGED", file);
    identities.set(file, info);
  }
  const { inventory, diagnostics } = await scanAssetProfiles(
    root,
    selection,
    history,
    player,
  );
  if (
    !equal(
      initial,
      inventory.files.map((f) => f.path),
    ) ||
    !equal(profiles, await loadProfiles(root))
  )
    fail("ASSET_SOURCE_CHANGED");
  if (channel.kind === "release" && channel.version !== inventory.appVersion)
    fail("ASSET_ARGUMENT_INVALID");
  const store = await createBundleObjects(root);
  for (const file of [...inventory.files, ...inventory.vendorFiles])
    await freezeFile(
      root,
      file,
      frozenSourcePath(store.run, file.path),
      identities.get(file.path),
      options.onFreezeChunk,
    );
  if (
    !equal(initial, await assetPaths(root)) ||
    !equal(selection, await loadSelection(root)) ||
    !equal(profiles, await loadProfiles(root))
  )
    fail("ASSET_SOURCE_CHANGED");
  const pkg = await readSourceJson(root, "package.json");
  if (
    !pkg ||
    typeof pkg !== "object" ||
    !("version" in pkg) ||
    pkg.version !== inventory.appVersion
  )
    fail("ASSET_SOURCE_CHANGED", "package.json");
  for (const [file, before] of identities) {
    const after = await sourceStat(root, file);
    if (!after || !sameFile(before, after)) fail("ASSET_SOURCE_CHANGED", file);
  }
  // No mutable asset/profile/vendor bytes are read after this point.
  const input = await store.json("inventories", inventory);
  let dev: ObjectRef | null = null;
  if (target !== "prod") {
    const files = inventory.files.map((f) => ({
      path: f.path,
      bytes: f.bytes,
      sha256: f.sha256,
    }));
    const archive = await store.archive(
      "dev/archives",
      await writeArchive(
        root,
        `${store.run}/archives/dev.zip`,
        files.map((f) => ({
          ...f,
          stagedPath: frozenSourcePath(store.run, f.path),
        })),
      ),
    );
    dev = await store.json(
      "dev/manifests",
      parseDevManifest({
        schemaVersion: 1,
        appVersion: inventory.appVersion,
        layoutVersion: 1,
        inventory: input,
        archive,
        files,
      }),
    );
  }
  const prod =
    target === "dev" ? null : await buildPlayerBundle(store, inventory, input);
  if (prod)
    await walkContentClosure(historyRefs(history), async (ref, json) => {
      if (store.include(ref)) {
        const source = `${options.retainedObjects ?? "generated/asset-delivery/retained/objects"}/${ref.key}`;
        if (!(await sourceStat(root, source)))
          fail("ASSET_REFERENCE_MISSING", ref.key);
        await freezeFile(
          root,
          { path: source, bytes: ref.bytes, sha256: ref.sha256 },
          store.path(ref),
        );
      }
      return json ? readSourceJson(root, store.path(ref)) : null;
    });
  const snapshot = parseBundleSnapshot({
    schemaVersion: 1,
    appVersion: inventory.appVersion,
    inventory: input,
    dev,
    prod,
    objects: store.objects,
  });
  const snapshotRef = await store.json("snapshots", snapshot);
  await store.bytes(
    `${store.run}/candidate.json`,
    canonicalBytes({ schemaVersion: 1, snapshot: snapshotRef }),
  );
  await store.bytes(
    `${store.run}/omissions.json`,
    canonicalBytes({ schemaVersion: 1, diagnostics }),
  );
  await verifyBundle(root, store.run);
  await replaceMetadata(root, "generated/asset-delivery/current.json", {
    schemaVersion: 1,
    run: store.run,
    snapshot: snapshotRef,
  });
  return { run: store.run, snapshot, snapshotRef };
}
