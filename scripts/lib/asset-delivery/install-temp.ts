import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { canonicalBytes } from "./canonical-json.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import type { FileDigest } from "./file-digest.ts";
import type { InstallJournal } from "./install-journal.ts";
import type { Sha256 } from "./identity.ts";
import { assertManagedPath, assertSafeParents } from "./path-guards.ts";
import { hash, nullable, object, text, version } from "./schema.ts";
import {
  digestSource,
  readSourceJson,
  sameDigest,
  sourceStat,
} from "./source-files.ts";
import { replaceMetadata } from "./atomic-metadata.ts";

export const INSTALL_PENDING_TEMP_PATH =
  "generated/asset-delivery/install/pending-temp.json";
const INSTALL_TEMP_NAME =
  /^\.i-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const parsePendingInstallTemp = (value: unknown) => {
  const pending = object(value, {
    schemaVersion: version,
    snapshotSha256: hash,
    path: assertManagedPath,
    temporary: assertManagedPath,
    identity: nullable((identity) =>
      object(identity, { dev: text, ino: text, birthtimeNs: text }),
    ),
  });
  if (
    path.posix.dirname(pending.path) !==
      path.posix.dirname(pending.temporary) ||
    !INSTALL_TEMP_NAME.test(path.posix.basename(pending.temporary))
  )
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
  return pending;
};
type PendingInstallTemp = ReturnType<typeof parsePendingInstallTemp>;

const identity = (info: BigIntStats) => ({
  dev: String(info.dev),
  ino: String(info.ino),
  birthtimeNs: String(info.birthtimeNs),
});
const equal = (left: unknown, right: unknown) =>
  Buffer.from(canonicalBytes(left)).equals(Buffer.from(canonicalBytes(right)));

async function syncParent(root: string, relative: string): Promise<void> {
  const handle = await open(
    path.dirname(await assertSafeParents(root, relative)),
    constants.O_RDONLY,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readPending(root: string): Promise<PendingInstallTemp | null> {
  try {
    if (!(await sourceStat(root, INSTALL_PENDING_TEMP_PATH))) return null;
    return parsePendingInstallTemp(
      await readSourceJson(root, INSTALL_PENDING_TEMP_PATH, true),
    );
  } catch (error) {
    if (error instanceof AssetDeliveryError)
      fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
    throw error;
  }
}

export async function beginInstallTemp(
  root: string,
  snapshotSha256: Sha256,
  managedPath: string,
  temporary: string,
): Promise<{ pending: PendingInstallTemp; handle: FileHandle }> {
  const prepared = parsePendingInstallTemp({
    schemaVersion: 1,
    snapshotSha256,
    path: managedPath,
    temporary,
    identity: null,
  });
  await replaceMetadata(root, INSTALL_PENDING_TEMP_PATH, prepared, null);
  await syncParent(root, INSTALL_PENDING_TEMP_PATH);

  let handle: FileHandle;
  try {
    handle = await open(
      await assertSafeParents(root, temporary),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail("ASSET_RECOVERY_REQUIRED", temporary);
    throw error;
  }
  try {
    const pending = parsePendingInstallTemp({
      ...prepared,
      identity: identity(await handle.stat({ bigint: true })),
    });
    await handle.sync();
    await syncParent(root, temporary);
    await replaceMetadata(
      root,
      INSTALL_PENDING_TEMP_PATH,
      pending,
      await digestSource(root, INSTALL_PENDING_TEMP_PATH, true),
    );
    await syncParent(root, INSTALL_PENDING_TEMP_PATH);
    return { pending, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertOwned(
  root: string,
  pending: PendingInstallTemp,
): Promise<void> {
  const info = await sourceStat(root, pending.temporary);
  if (
    !info?.isFile() ||
    !pending.identity ||
    !equal(identity(info), pending.identity)
  )
    fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
}

export async function finishInstallTemp(
  root: string,
  pending: PendingInstallTemp,
  expected: FileDigest,
): Promise<void> {
  const current = await readPending(root);
  if (!current || !equal(current, pending))
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
  if (await sourceStat(root, pending.temporary)) {
    try {
      await assertOwned(root, pending);
      if (
        !sameDigest(await digestSource(root, pending.temporary, true), expected)
      )
        fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
      await assertOwned(root, pending);
      await unlink(await assertSafeParents(root, pending.temporary));
    } catch (error) {
      if (error instanceof AssetDeliveryError)
        fail("ASSET_RECOVERY_REQUIRED", pending.temporary);
      throw error;
    }
  }
  await syncParent(root, pending.temporary);
  const rechecked = await readPending(root);
  if (!rechecked || !equal(rechecked, pending))
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
  await unlink(await assertSafeParents(root, INSTALL_PENDING_TEMP_PATH));
  await syncParent(root, INSTALL_PENDING_TEMP_PATH);
}

export async function recoverInstallTemp(
  root: string,
  journal: InstallJournal,
): Promise<void> {
  const pending = await readPending(root);
  if (!pending) return;
  const change = journal.changes.find((item) => item.path === pending.path);
  if (!change || pending.snapshotSha256 !== journal.snapshotSha256)
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
  await finishInstallTemp(root, pending, change.after);
}

export async function assertNoInstallTemp(root: string): Promise<void> {
  if (await readPending(root))
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_PENDING_TEMP_PATH);
}
