import type { AssetResult } from "./asset-result.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import { fail } from "./failure.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { parsePrunePlan, type PrunePlan } from "./prune-plan.ts";
import {
  applyRemotePrune,
  previewRemotePrune,
  resumeRemotePrune,
} from "./remote-prune.ts";
import { createR2ObjectStore } from "./remote-store.ts";
import { readSourceJson } from "./source-files.ts";
import { replaceMetadata } from "./atomic-metadata.ts";

async function withRemote<T>(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
  action: (
    store: ReturnType<typeof createR2ObjectStore>["store"],
  ) => Promise<T>,
): Promise<T> {
  const config = parseAssetDeliveryConfig(
    await readSourceJson(root, "asset-delivery.config.json"),
  );
  const release = await acquireAssetDeliveryLock(root);
  let remote: ReturnType<typeof createR2ObjectStore> | null = null;
  try {
    remote = createR2ObjectStore(config, environment);
    return await action(remote.store);
  } finally {
    remote?.destroy();
    await release();
  }
}

export async function previewPrune(
  root: string,
  scope: "local" | "remote",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrunePlan> {
  if (scope !== "remote") fail("ASSET_TARGET_UNAVAILABLE");
  return withRemote(root, environment, async (store) => {
    const plan = await previewRemotePrune(store, new Date());
    await replaceMetadata(
      root,
      "generated/asset-delivery/prune-remote.json",
      plan,
    );
    return plan;
  });
}

export async function applyPrune(
  root: string,
  plan: PrunePlan,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AssetResult> {
  const parsed = parsePrunePlan(plan);
  if (parsed.scope !== "remote") fail("ASSET_TARGET_UNAVAILABLE");
  await withRemote(root, environment, (store) =>
    applyRemotePrune(store, parsed, new Date()),
  );
  return { status: "ok", operation: "prune", snapshotSha256: null };
}

export async function resumePrune(
  root: string,
  scope: "local" | "remote",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AssetResult> {
  if (scope !== "remote") fail("ASSET_TARGET_UNAVAILABLE");
  await withRemote(root, environment, (store) =>
    resumeRemotePrune(store, new Date()),
  );
  return { status: "ok", operation: "prune", snapshotSha256: null };
}
