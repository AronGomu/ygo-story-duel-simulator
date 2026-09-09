import { link, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ASSET_SOURCES } from "../asset-roots.ts";
import { mappedLegacyPath } from "./source-mapping.ts";
import {
  ASSET_ROOTS,
  assertNoPathCollisions,
  assertSafeParents,
} from "./path-guards.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import {
  parseMigrationPlan,
  type MigrationPlan,
  type MigrationReceipt,
} from "./migration-plan.ts";
import {
  digestSource,
  sameDigest,
  sourceFiles,
  sourceEntries,
  sourceStat,
} from "./source-files.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { fail } from "./failure.ts";
import { migrationTempPath } from "./migration-temp.ts";
import { copyMigrationSource } from "./copy-migration-source.ts";
import {
  assertMigrationReady,
  beginMigrationTemp,
  assertOwnedMigrationTemp,
  finishMigrationTemp,
  recoverMigrationTemp,
} from "./migration-state.ts";

export const MIGRATION_PLAN_PATH =
  "generated/asset-delivery/migration-plan.json";
export const MIGRATION_RECEIPT_PATH =
  "generated/asset-delivery/migration-receipt.json";

async function legacyFiles(
  root: string,
  observedRoots: Set<string>,
): Promise<string[]> {
  const paths: string[] = [];
  for (const { legacy, kind } of Object.values(ASSET_SOURCES)) {
    const info = await sourceStat(root, legacy);
    if (info && (kind === "file" ? !info.isFile() : !info.isDirectory()))
      fail("ASSET_PATH_UNSAFE", legacy);
    if (info) observedRoots.add(legacy);
    paths.push(...(await sourceFiles(root, legacy, observedRoots.has(legacy))));
  }
  return paths.sort(compareCodePoints);
}
async function checkDestination(
  root: string,
  file: MigrationPlan["files"][number],
): Promise<boolean> {
  const info = await sourceStat(root, file.to);
  if (!info) return false;
  if (!info.isFile() || !sameDigest(await digestSource(root, file.to), file))
    fail("ASSET_LOCAL_CONFLICT", file.to);
  return true;
}
export async function previewMigration(root: string): Promise<MigrationPlan> {
  await assertMigrationReady(root);
  const observedRoots = new Set<string>();
  const paths = await legacyFiles(root, observedRoots);
  const files: MigrationPlan["files"][number][] = [];
  for (const from of paths) {
    const digest = await digestSource(root, from, true);
    const file = {
      from,
      to: mappedLegacyPath(from),
      bytes: digest.bytes,
      sha256: digest.sha256,
    };
    migrationTempPath(file.to);
    await checkDestination(root, file);
    files.push(file);
  }
  // Detect portable collisions with unknown existing destinations too.
  const destinations: string[] = [];
  const directories: string[] = [];
  for (const family of ASSET_ROOTS) {
    const entries = await sourceEntries(root, `assets/${family}`);
    destinations.push(...entries.files);
    directories.push(...entries.directories);
  }
  assertNoPathCollisions(
    [...new Set([...destinations, ...files.map((f) => f.to)])],
    directories,
  );
  if (
    JSON.stringify(paths) !==
    JSON.stringify(await legacyFiles(root, observedRoots))
  )
    fail("ASSET_SOURCE_CHANGED");
  return parseMigrationPlan({ schemaVersion: 1, files });
}

/** No-clobber installation: link independent temp bytes, never original source inode. */
async function copyMissing(
  root: string,
  file: MigrationPlan["files"][number],
  planSha256: string,
  fileIndex: number,
): Promise<void> {
  if (await checkDestination(root, file)) return;
  const destination = await assertSafeParents(root, file.to);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = migrationTempPath(file.to, randomUUID());
  const temp = await assertSafeParents(root, temporary);
  const { pending, handle } = await beginMigrationTemp(
    root,
    planSha256,
    fileIndex,
    temporary,
  );
  try {
    // Exclusive creation + durable inode ownership precede writes into our own temp.
    await assertOwnedMigrationTemp(root, pending);
    await copyMigrationSource(root, file, handle);
    await assertOwnedMigrationTemp(root, pending);
    await handle.sync();
    if (
      !sameDigest(await digestSource(root, temporary), file) ||
      !sameDigest(await digestSource(root, file.from, true), file)
    )
      fail("ASSET_SOURCE_CHANGED", file.from);
    if (await checkDestination(root, file)) return;
    await assertSafeParents(root, file.to);
    await assertSafeParents(root, temporary);
    try {
      await link(temp, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        if (!(await checkDestination(root, file)))
          fail("ASSET_LOCAL_CONFLICT", file.to);
      } else if (
        ["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
          code ?? "",
        )
      ) {
        fail("ASSET_LOCAL_CONFLICT", file.to);
      } else throw error;
    }
    if (!(await checkDestination(root, file)))
      fail("ASSET_INTEGRITY_FAILED", file.to);
  } finally {
    try {
      await handle.close();
    } finally {
      await finishMigrationTemp(root, pending, file);
    }
  }
}

export async function applyMigration(
  root: string,
  value: MigrationPlan,
): Promise<MigrationReceipt> {
  const plan = parseMigrationPlan(value);
  const planSha256 = createHash("sha256")
    .update(canonicalBytes(plan))
    .digest("hex");
  const release = await acquireAssetDeliveryLock(root, planSha256);
  try {
    await recoverMigrationTemp(root, plan, planSha256);
    // Full rescan and all source/destination hashes before first copy.
    const current = await previewMigration(root);
    if (
      !Buffer.from(canonicalBytes(current)).equals(
        Buffer.from(canonicalBytes(plan)),
      )
    )
      fail("ASSET_SOURCE_CHANGED");
    const completed: MigrationReceipt["completed"][number][] = [];
    for (const [fileIndex, file] of plan.files.entries()) {
      if (!sameDigest(await digestSource(root, file.from, true), file))
        fail("ASSET_SOURCE_CHANGED", file.from);
      await copyMissing(root, file, planSha256, fileIndex);
      const digest = await digestSource(root, file.to);
      if (!sameDigest(digest, file)) fail("ASSET_INTEGRITY_FAILED", file.to);
      completed.push(digest);
    }
    completed.sort((a, b) => compareCodePoints(a.path, b.path));
    const receipt: MigrationReceipt = {
      schemaVersion: 1,
      planSha256,
      completed,
    };
    await replaceMetadata(root, MIGRATION_RECEIPT_PATH, receipt);
    return receipt;
  } finally {
    await release();
  }
}

export async function planMigration(root: string): Promise<MigrationPlan> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    const plan = await previewMigration(root);
    await replaceMetadata(root, MIGRATION_PLAN_PATH, plan);
    return plan;
  } finally {
    await release();
  }
}
