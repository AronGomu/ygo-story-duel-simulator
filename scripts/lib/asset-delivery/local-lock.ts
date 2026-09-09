import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertSafeParents } from "./path-guards.ts";
import { fail } from "./failure.ts";
import { assertMigrationReady } from "./migration-state.ts";

export const LOCAL_LOCK_PATH = "generated/.locks/asset-delivery";

/** Local before remote; no reentrant acquisition or automatic stale takeover. */
export async function acquireAssetDeliveryLock(
  root: string,
  recoveryPlanSha256?: string,
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
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
