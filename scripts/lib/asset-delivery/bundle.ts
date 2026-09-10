import type { BundleSnapshot } from "./bundle-snapshot.ts";
import type { Channel, TargetOption } from "./identity.ts";
import type { RetainedMetadata } from "./retained-metadata.ts";
import type { PreparedPlayerMetadata } from "./prepared-player-metadata.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { bundleAlreadyLocked } from "./bundle-locked.ts";

/** Public writer acquires once across scan, freeze, verification and activation. */
export async function bundleAssets(
  root: string,
  target: TargetOption,
  channel: Channel,
  retainedMetadata: RetainedMetadata,
  playerMetadata: PreparedPlayerMetadata | null,
): Promise<BundleSnapshot> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    return (
      await bundleAlreadyLocked(
        root,
        target,
        channel,
        retainedMetadata,
        playerMetadata,
      )
    ).snapshot;
  } finally {
    await release();
  }
}
