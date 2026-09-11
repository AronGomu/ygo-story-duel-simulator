import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  rename,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { FileDigest } from "./file-digest.ts";
import { parseInstallReceipt, type InstallReceipt } from "./install-receipt.ts";
import {
  parseInstallJournal,
  type InstallChange,
  type InstallJournal,
} from "./install-journal.ts";
import { assertSafeParents } from "./path-guards.ts";
import {
  digestSource,
  readSourceJson,
  sameDigest,
  sourceStat,
} from "./source-files.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import { fail } from "./failure.ts";
import {
  assertNoInstallTemp,
  beginInstallTemp,
  finishInstallTemp,
  recoverInstallTemp,
} from "./install-temp.ts";

export const INSTALL_RECEIPT_PATH = "assets/.install-receipt.json";
export const INSTALL_JOURNAL_PATH =
  "generated/asset-delivery/install/journal.json";
const backupRoot = (snapshot: string) =>
  `generated/asset-delivery/install/backups/${snapshot}`;
const equalValue = (left: unknown, right: unknown) =>
  Buffer.from(canonicalBytes(left)).equals(Buffer.from(canonicalBytes(right)));

async function optionalReceipt(root: string): Promise<InstallReceipt | null> {
  if (!(await sourceStat(root, INSTALL_RECEIPT_PATH))) return null;
  return parseInstallReceipt(
    await readSourceJson(root, INSTALL_RECEIPT_PATH, true),
  );
}

async function optionalJournal(root: string): Promise<InstallJournal | null> {
  if (!(await sourceStat(root, INSTALL_JOURNAL_PATH))) return null;
  try {
    return parseInstallJournal(
      await readSourceJson(root, INSTALL_JOURNAL_PATH, true),
    );
  } catch {
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_JOURNAL_PATH);
  }
}

async function removeExact(root: string, relative: string): Promise<void> {
  try {
    await unlink(await assertSafeParents(root, relative));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function currentDigest(
  root: string,
  relative: string,
): Promise<FileDigest | null> {
  const info = await sourceStat(root, relative);
  if (!info) return null;
  if (!info.isFile()) fail("ASSET_LOCAL_CONFLICT", relative);
  return digestSource(root, relative, true);
}

async function assertAvailableBytes(root: string, required: number) {
  const stats = await statfs(root, { bigint: true });
  const available = stats.bavail * stats.bsize;
  if (available < BigInt(required)) fail("ASSET_DISK_FULL");
}

async function backupChange(
  root: string,
  change: InstallChange,
  snapshot: string,
): Promise<void> {
  if (!change.before) return;
  const relative = `${backupRoot(snapshot)}/${change.path}`;
  const target = await assertSafeParents(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (await sourceStat(root, relative))
    fail("ASSET_RECOVERY_REQUIRED", relative);
  if (!sameDigest((await currentDigest(root, change.path))!, change.before))
    fail("ASSET_LOCAL_CONFLICT", change.path);
  await copyFile(
    await assertSafeParents(root, change.path),
    target,
    constants.COPYFILE_EXCL,
  );
  if (!sameDigest(await digestSource(root, relative, true), change.before))
    fail("ASSET_RECOVERY_REQUIRED", relative);
}

async function replaceFromStage(
  root: string,
  stage: string,
  snapshotSha256: string,
  change: InstallChange,
): Promise<void> {
  const current = await currentDigest(root, change.path);
  if (
    change.before === null
      ? current !== null
      : current === null || !sameDigest(current, change.before)
  )
    fail("ASSET_LOCAL_CONFLICT", change.path);
  const target = await assertSafeParents(root, change.path);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${path.posix.dirname(change.path)}/.i-${randomUUID()}`;
  const temp = await assertSafeParents(root, temporary);
  const { pending, handle } = await beginInstallTemp(
    root,
    snapshotSha256,
    change.path,
    temporary,
  );
  let closed = false;
  try {
    const source = await open(
      await assertSafeParents(root, `${stage}/${change.path}`),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let written = 0;
      for (;;) {
        const item = await source.read(buffer, 0, buffer.length, null);
        if (item.bytesRead === 0) break;
        if (written + item.bytesRead > change.after.bytes)
          fail("ASSET_INTEGRITY_FAILED", change.path);
        let offset = 0;
        while (offset < item.bytesRead) {
          const output = await handle.write(
            buffer,
            offset,
            item.bytesRead - offset,
            written + offset,
          );
          offset += output.bytesWritten;
        }
        written += item.bytesRead;
      }
      if (written !== change.after.bytes)
        fail("ASSET_INTEGRITY_FAILED", change.path);
      await handle.sync();
    } finally {
      await source.close();
    }
    await handle.close();
    closed = true;
    if (!sameDigest(await digestSource(root, temporary, true), change.after))
      fail("ASSET_INTEGRITY_FAILED", change.path);
    const rechecked = await currentDigest(root, change.path);
    if (
      change.before === null
        ? rechecked !== null
        : rechecked === null || !sameDigest(rechecked, change.before)
    )
      fail("ASSET_LOCAL_CONFLICT", change.path);
    await rename(temp, target);
  } finally {
    if (!closed) await handle.close();
    await finishInstallTemp(root, pending, change.after);
  }
  if (!sameDigest((await currentDigest(root, change.path))!, change.after))
    fail("ASSET_INTEGRITY_FAILED", change.path);
}

async function clearJournal(root: string, journal: InstallJournal) {
  const current = await optionalJournal(root);
  if (!current || !equalValue(current, journal))
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_JOURNAL_PATH);
  await removeExact(root, INSTALL_JOURNAL_PATH);
  for (const change of journal.changes) {
    if (change.before)
      await removeExact(
        root,
        `${backupRoot(journal.snapshotSha256)}/${change.path}`,
      );
  }
}

/** Hash-guarded rollback; post-crash edits stop recovery untouched. */
export async function recoverInstallAlreadyLocked(root: string): Promise<void> {
  let journal = await optionalJournal(root);
  if (!journal) {
    await assertNoInstallTemp(root);
    return;
  }
  await recoverInstallTemp(root, journal);
  const receipt = await optionalReceipt(root);
  if (equalValue(receipt, journal.nextReceipt)) {
    if (journal.phase !== "committed") {
      journal = { ...journal, phase: "committed" };
      await replaceMetadata(root, INSTALL_JOURNAL_PATH, journal);
    }
    await clearJournal(root, journal);
    return;
  }
  if (!equalValue(receipt, journal.previousReceipt))
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_RECEIPT_PATH);

  for (const change of journal.changes) {
    const current = await currentDigest(root, change.path);
    const before =
      change.before !== null &&
      current !== null &&
      sameDigest(current, change.before);
    const after = current !== null && sameDigest(current, change.after);
    if (!before && !after && !(change.before === null && current === null))
      fail("ASSET_RECOVERY_REQUIRED", change.path);
    if (after && change.before) {
      const backup = `${backupRoot(journal.snapshotSha256)}/${change.path}`;
      const saved = await currentDigest(root, backup);
      if (!saved || !sameDigest(saved, change.before))
        fail("ASSET_RECOVERY_REQUIRED", backup);
    }
  }
  for (const change of [...journal.changes].reverse()) {
    const current = await currentDigest(root, change.path);
    if (!current || !sameDigest(current, change.after)) continue;
    if (change.before === null) await removeExact(root, change.path);
    else {
      await rename(
        await assertSafeParents(
          root,
          `${backupRoot(journal.snapshotSha256)}/${change.path}`,
        ),
        await assertSafeParents(root, change.path),
      );
    }
  }
  await clearJournal(root, journal);
}

export async function installDevFilesAlreadyLocked(
  root: string,
  snapshotSha256: string,
  files: readonly FileDigest[],
  stage: string,
): Promise<InstallReceipt> {
  const previous = await optionalReceipt(root);
  const incoming = new Map(files.map((file) => [file.path, file]));
  const currentManaged = new Map(
    previous?.files.map((file) => [file.path, file]),
  );
  const retiredManaged = new Map(
    previous?.retired.map((file) => [file.path, file]),
  );

  for (const file of previous?.files ?? []) {
    const local = await currentDigest(root, file.path);
    if (!local || !sameDigest(local, file))
      fail("ASSET_LOCAL_CONFLICT", file.path);
  }
  const changes: InstallChange[] = [];
  for (const after of files) {
    const local = await currentDigest(root, after.path);
    const managed =
      currentManaged.get(after.path) ?? retiredManaged.get(after.path);
    if (managed && local && !sameDigest(local, managed))
      fail("ASSET_LOCAL_CONFLICT", after.path);
    if (!managed && local && !sameDigest(local, after))
      fail("ASSET_LOCAL_CONFLICT", after.path);
    if (!local || !sameDigest(local, after))
      changes.push({ path: after.path, before: local, after });
    const staged = await currentDigest(root, `${stage}/${after.path}`);
    if (!staged || !sameDigest(staged, after))
      fail("ASSET_INTEGRITY_FAILED", after.path);
  }

  const retired = [
    ...(previous?.retired ?? []),
    ...(previous?.files.filter((file) => !incoming.has(file.path)) ?? []),
  ]
    .filter((file) => !incoming.has(file.path))
    .filter(
      (file, index, all) =>
        all.findIndex((other) => other.path === file.path) === index,
    )
    .sort((left, right) => compareCodePoints(left.path, right.path));
  const nextReceipt: InstallReceipt = parseInstallReceipt({
    schemaVersion: 1,
    layoutVersion: 1,
    snapshotSha256,
    files: [...files].sort((left, right) =>
      compareCodePoints(left.path, right.path),
    ),
    retired,
  });
  if (!changes.length && equalValue(previous, nextReceipt)) return nextReceipt;

  const required =
    files.reduce((sum, file) => sum + file.bytes, 0) +
    changes.reduce((sum, change) => sum + (change.before?.bytes ?? 0), 0) +
    canonicalBytes(nextReceipt).byteLength * 3;
  await assertAvailableBytes(root, required);
  const journal: InstallJournal = parseInstallJournal({
    schemaVersion: 1,
    snapshotSha256,
    phase: "prepared",
    previousReceipt: previous,
    nextReceipt,
    changes,
  });
  await replaceMetadata(root, INSTALL_JOURNAL_PATH, journal, null);
  for (const change of changes)
    await backupChange(root, change, snapshotSha256);
  let applying: InstallJournal = { ...journal, phase: "applying" };
  await replaceMetadata(root, INSTALL_JOURNAL_PATH, applying);
  for (const change of changes)
    await replaceFromStage(root, stage, snapshotSha256, change);
  const receiptDigest = previous
    ? await digestSource(root, INSTALL_RECEIPT_PATH, true)
    : null;
  await replaceMetadata(root, INSTALL_RECEIPT_PATH, nextReceipt, receiptDigest);
  applying = { ...applying, phase: "committed" };
  await replaceMetadata(root, INSTALL_JOURNAL_PATH, applying);
  await clearJournal(root, applying);
  return nextReceipt;
}
