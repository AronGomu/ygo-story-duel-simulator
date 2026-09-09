import { open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { BigIntStats } from "node:fs";
import { assertManagedPath, assertSafeParents } from "./path-guards.ts";
import { object, version, hash, integer, nullable, text } from "./schema.ts";
import { canonicalBytes } from "./canonical-json.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import {
  readSourceJson,
  sourceStat,
  digestSource,
  sameDigest,
} from "./source-files.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import type { MigrationPlan } from "./migration-plan.ts";
import { MIGRATION_TEMP_NAME } from "./migration-temp.ts";

export const MIGRATION_PENDING_PATH =
  "generated/asset-delivery/migration-pending.json";
const parsePending = (value: unknown) =>
  object(value, {
    schemaVersion: version,
    planSha256: hash,
    fileIndex: integer,
    temporary: assertManagedPath,
    identity: nullable((v) =>
      object(v, { dev: text, ino: text, birthtimeNs: text }),
    ),
  });
type PendingMigration = ReturnType<typeof parsePending>;
const identity = (stat: BigIntStats) => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  birthtimeNs: String(stat.birthtimeNs),
});
const equal = (a: unknown, b: unknown) =>
  Buffer.from(canonicalBytes(a)).equals(Buffer.from(canonicalBytes(b)));

async function readPending(root: string): Promise<PendingMigration | null> {
  try {
    if (!(await sourceStat(root, MIGRATION_PENDING_PATH))) return null;
    return parsePending(
      await readSourceJson(root, MIGRATION_PENDING_PATH, true),
    );
  } catch (error) {
    if (error instanceof AssetDeliveryError)
      fail("ASSET_RECOVERY_REQUIRED", MIGRATION_PENDING_PATH);
    throw error;
  }
}

/** Normal inventory and every common-lock writer are barred until recovery completes. */
export async function assertMigrationReady(
  root: string,
  recoveryPlanSha256?: string,
): Promise<void> {
  const pending = await readPending(root);
  if (pending && pending.planSha256 !== recoveryPlanSha256)
    fail("ASSET_RECOVERY_REQUIRED", MIGRATION_PENDING_PATH);
}
async function syncParent(root: string, relative: string): Promise<void> {
  const handle = await open(
    path.dirname(await assertSafeParents(root, relative)),
    "r",
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Intent is durable before exclusive creation; inode ownership is durable before copying. */
export async function beginMigrationTemp(
  root: string,
  planSha256: string,
  fileIndex: number,
  temporary: string,
): Promise<{ pending: PendingMigration; handle: FileHandle }> {
  const intent: PendingMigration = {
    schemaVersion: 1,
    planSha256,
    fileIndex,
    temporary,
    identity: null,
  };
  await replaceMetadata(root, MIGRATION_PENDING_PATH, intent, null);
  await syncParent(root, MIGRATION_PENDING_PATH);
  let handle;
  try {
    handle = await open(await assertSafeParents(root, temporary), "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail("ASSET_RECOVERY_REQUIRED", temporary);
    throw error;
  }
  try {
    const pending = {
      ...intent,
      identity: identity(await handle.stat({ bigint: true })),
    };
    await handle.sync();
    await syncParent(root, temporary);
    await replaceMetadata(root, MIGRATION_PENDING_PATH, pending);
    await syncParent(root, MIGRATION_PENDING_PATH);
    return { pending, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function assertOwnedMigrationTemp(
  root: string,
  pending: PendingMigration,
): Promise<void> {
  try {
    const stat = await sourceStat(root, pending.temporary);
    if (
      !stat?.isFile() ||
      !pending.identity ||
      !equal(identity(stat), pending.identity)
    )
      fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
  } catch (error) {
    if (error instanceof AssetDeliveryError)
      fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
    throw error;
  }
}

/** Remove only the exact plan-bound, inode-owned, full-hash-verified temp. */
export async function finishMigrationTemp(
  root: string,
  pending: PendingMigration,
  file: MigrationPlan["files"][number],
): Promise<void> {
  if (await sourceStat(root, pending.temporary)) {
    await assertOwnedMigrationTemp(root, pending);
    if (!sameDigest(await digestSource(root, pending.temporary, true), file))
      fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
    await assertOwnedMigrationTemp(root, pending);
    await unlink(await assertSafeParents(root, pending.temporary));
  }
  // Persist temp removal (and any installed sibling) before lifting the recovery gate.
  await syncParent(root, pending.temporary);
  if (!equal(await readPending(root), pending))
    fail("ASSET_RECOVERY_REQUIRED", MIGRATION_PENDING_PATH);
  await unlink(await assertSafeParents(root, MIGRATION_PENDING_PATH));
  await syncParent(root, MIGRATION_PENDING_PATH);
}

/** Same-plan retry only; malformed/partial/unowned entries remain untouched for owner recovery. */
export async function recoverMigrationTemp(
  root: string,
  plan: MigrationPlan,
  planSha256: string,
): Promise<void> {
  const pending = await readPending(root);
  if (!pending) return;
  const file = plan.files[pending.fileIndex];
  if (
    pending.planSha256 !== planSha256 ||
    !file ||
    path.posix.dirname(pending.temporary) !== path.posix.dirname(file.to) ||
    !MIGRATION_TEMP_NAME.test(path.posix.basename(pending.temporary))
  )
    fail("ASSET_RECOVERY_REQUIRED", MIGRATION_PENDING_PATH);
  try {
    await finishMigrationTemp(root, pending, file);
  } catch (error) {
    if (error instanceof AssetDeliveryError)
      fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
    throw error;
  }
}
