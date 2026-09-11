import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertSafeParents } from "./path-guards.ts";
import { fail } from "./failure.ts";
import { assertMigrationReady } from "./migration-state.ts";

export const LOCAL_LOCK_PATH = "generated/.locks/asset-delivery";

/** Local before remote; no reentrant acquisition or automatic stale takeover. */
export type LocalRecoveryKind = "install" | "prune";

async function assertMutationReady(
  root: string,
  recoveryKind?: LocalRecoveryKind,
): Promise<void> {
  for (const [kind, relative] of [
    ["install", "generated/asset-delivery/install/journal.json"],
    ["install", "generated/asset-delivery/install/pending-temp.json"],
    ["prune", "generated/asset-delivery/prune-journal.json"],
  ] as const) {
    try {
      await lstat(await assertSafeParents(root, relative));
      if (kind !== recoveryKind) fail("ASSET_RECOVERY_REQUIRED", relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function acquireAssetDeliveryLock(
  root: string,
  recoveryPlanSha256?: string,
  recoveryKind?: LocalRecoveryKind,
): Promise<() => Promise<void>> {
  const file = await assertSafeParents(root, LOCAL_LOCK_PATH);
  const owner = `${randomUUID()}\n`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await assertSafeParents(root, LOCAL_LOCK_PATH);
    let handle;
    try {
      handle = await open(file, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        fail("ASSET_BUSY", LOCAL_LOCK_PATH);
      throw error;
    }
    try {
      await handle.writeFile(owner, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      fail("ASSET_DISK_FULL");
    throw error;
  }
  // Failed creation/write deliberately leaves a busy lock for owner recovery.
  const release = async () => {
    try {
      await assertSafeParents(root, LOCAL_LOCK_PATH);
      if ((await readFile(file, "utf8")) !== owner)
        fail("ASSET_BUSY", LOCAL_LOCK_PATH);
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOSPC")
        fail("ASSET_DISK_FULL");
      throw error;
    }
  };
  try {
    await assertMigrationReady(root, recoveryPlanSha256);
    await assertMutationReady(root, recoveryKind);
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
