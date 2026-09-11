import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bundleAlreadyLocked, type BundleCandidate } from "./bundle-locked.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import { parseDevManifest } from "./dev-manifest.ts";
import { fail } from "./failure.ts";
import {
  parseFrozenInventory,
  type FrozenInventory,
} from "./frozen-inventory.ts";
import type { Channel, TargetOption } from "./identity.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import type { ObjectRef } from "./object-ref.ts";
import { assertSafeParents } from "./path-guards.ts";
import {
  parsePublicationApproval,
  verifyPublicationApproval,
  verifyPublicationEvidence,
} from "./publication-approval.ts";
import { preparePublicationHistory } from "./publication-history.ts";
import { verifyPublicObject } from "./public-object.ts";
import { publishRemote } from "./remote-publication.ts";
import { createR2ObjectStore, type RemoteObjectStore } from "./remote-store.ts";
import {
  parsePreparedPlayerMetadata,
  type PreparedPlayerMetadata,
} from "./prepared-player-metadata.ts";
import { canonicalBytes, parseJsonBytes } from "./canonical-json.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { readSourceJson, sourceStat } from "./source-files.ts";
import type { AssetResult } from "./asset-result.ts";
import { parseSetupOrigin } from "./setup-options.ts";

const CONFIG_PATH = "asset-delivery.config.json";
const APPROVAL_PATH = "content/asset-publication-approval.json";
const PLAYER_PATH = "generated/asset-delivery/prepared-player.json";

async function objectBytes(
  root: string,
  candidate: BundleCandidate,
  store: RemoteObjectStore,
  ref: ObjectRef,
): Promise<Uint8Array> {
  const local = await assertSafeParents(
    root,
    `${candidate.run}/objects/${ref.key}`,
  );
  let bytes: Uint8Array;
  try {
    bytes = await readFile(local);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const remote = await store.read(ref.key, ref.bytes);
    if (!remote) fail("ASSET_REFERENCE_MISSING", ref.key);
    bytes = remote.bytes;
  }
  if (
    bytes.byteLength !== ref.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== ref.sha256
  )
    fail("ASSET_INTEGRITY_FAILED", ref.key);
  return bytes;
}
async function publicationInventories(
  root: string,
  candidate: BundleCandidate,
  store: RemoteObjectStore,
): Promise<FrozenInventory[]> {
  const refs = new Map<string, ObjectRef>();
  refs.set(candidate.snapshot.inventory.key, candidate.snapshot.inventory);
  if (candidate.snapshot.prod)
    refs.set(
      candidate.snapshot.prod.inventory.key,
      candidate.snapshot.prod.inventory,
    );
  if (candidate.snapshot.dev) {
    const manifest = parseDevManifest(
      parseJsonBytes(
        await objectBytes(root, candidate, store, candidate.snapshot.dev),
      ),
    );
    refs.set(manifest.inventory.key, manifest.inventory);
  }
  const inventories: FrozenInventory[] = [];
  for (const ref of refs.values())
    inventories.push(
      parseFrozenInventory(
        parseJsonBytes(await objectBytes(root, candidate, store, ref)),
      ),
    );
  return inventories;
}

/** Explicit publisher. Local lock spans evidence, remote lock, freeze, upload, verify, commit. */
export async function publishAssets(
  root: string,
  target: TargetOption,
  channel: Channel,
  expectedOrigin: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AssetResult> {
  if (!["dev", "prod", "all"].includes(target)) fail("ASSET_ARGUMENT_INVALID");
  const origin = parseSetupOrigin(expectedOrigin);
  const releaseLocal = await acquireAssetDeliveryLock(root);
  let remote: ReturnType<typeof createR2ObjectStore> | null = null;
  try {
    const config = parseAssetDeliveryConfig(
      await readSourceJson(root, CONFIG_PATH),
    );
    const approval = parsePublicationApproval(
      await readSourceJson(root, APPROVAL_PATH),
    );
    await verifyPublicationEvidence(root, approval);
    let player: PreparedPlayerMetadata | null = null;
    if (target !== "dev") {
      if (!(await sourceStat(root, PLAYER_PATH)))
        fail("ASSET_TARGET_UNAVAILABLE", PLAYER_PATH);
      player = parsePreparedPlayerMetadata(
        await readSourceJson(root, PLAYER_PATH),
      );
    }
    remote = createR2ObjectStore(config, environment);
    const candidate = await publishRemote(
      {
        root,
        store: remote.store,
        now: () => new Date(),
        build: (actualTarget, actualChannel, history, retainedObjects) =>
          bundleAlreadyLocked(
            root,
            actualTarget,
            actualChannel,
            history,
            player,
            {
              ...(retainedObjects ? { retainedObjects } : {}),
            },
          ),
        authorize: async (built) => {
          const result = verifyPublicationApproval(
            approval,
            built.snapshot,
            await publicationInventories(root, built, remote!.store),
          );
          if (result.status === "failed") fail(result.code, result.path);
        },
        verifyPublic: (object) => verifyPublicObject(config, object, origin),
        prepareHistory: (advertised, existingRelease) =>
          preparePublicationHistory(
            root,
            remote!.store,
            advertised,
            existingRelease,
          ),
      },
      target,
      channel,
    );
    await replaceMetadata(
      root,
      "generated/asset-delivery/publication-report.json",
      {
        schemaVersion: 1,
        approvalSha256: createHash("sha256")
          .update(canonicalBytes(approval))
          .digest("hex"),
        snapshot: candidate.snapshotRef,
      },
    );
    return {
      status: "ok",
      operation: "publish",
      snapshotSha256: candidate.snapshotRef.sha256,
    };
  } finally {
    remote?.destroy();
    await releaseLocal();
  }
}
