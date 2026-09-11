import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { AssetResult } from "./asset-result.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { fail } from "./failure.ts";
import { INSTALL_RECEIPT_PATH } from "./install-dev-assets.ts";
import { parseInstallReceipt, type InstallReceipt } from "./install-receipt.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { assertSafeParents } from "./path-guards.ts";
import { parsePruneJournal, type PruneJournal } from "./prune-journal.ts";
import { parsePrunePlan, type PrunePlan } from "./prune-plan.ts";
import {
  digestSource,
  readSource,
  readSourceJson,
  sameDigest,
  sameFile,
  sourceStat,
} from "./source-files.ts";

export const LOCAL_PRUNE_JOURNAL_PATH =
  "generated/asset-delivery/prune-journal.json";
export const LOCAL_PRUNE_PLAN_PATH =
  "generated/asset-delivery/prune-local.json";

const equalValue = (left: unknown, right: unknown) =>
  Buffer.from(canonicalBytes(left)).equals(Buffer.from(canonicalBytes(right)));

async function receiptWithBasis(
  root: string,
): Promise<{ receipt: InstallReceipt; basisSha256: string }> {
  if (!(await sourceStat(root, INSTALL_RECEIPT_PATH)))
    fail("ASSET_REFERENCE_MISSING", INSTALL_RECEIPT_PATH);
  const source = await readSource(root, INSTALL_RECEIPT_PATH, true, true);
  return {
    receipt: parseInstallReceipt(
      JSON.parse(Buffer.from(source.bytes!).toString("utf8")),
    ),
    basisSha256: source.digest.sha256,
  };
}

async function previewAlreadyLocked(root: string): Promise<PrunePlan> {
  const { receipt, basisSha256 } = await receiptWithBasis(root);
  const candidates = [];
  for (const file of receipt.retired) {
    const info = await sourceStat(root, file.path);
    if (!info?.isFile()) continue;
    const current = await digestSource(root, file.path, true);
    if (sameDigest(current, file)) candidates.push(file);
  }
  return parsePrunePlan({
    schemaVersion: 1,
    scope: "local",
    basisSha256,
    candidates: candidates.sort((left, right) =>
      compareCodePoints(left.path, right.path),
    ),
  });
}

export async function previewLocalPrune(root: string): Promise<PrunePlan> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    return await previewAlreadyLocked(root);
  } finally {
    await release();
  }
}

export async function planLocalPrune(root: string): Promise<PrunePlan> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    const plan = await previewAlreadyLocked(root);
    await replaceMetadata(root, LOCAL_PRUNE_PLAN_PATH, plan);
    return plan;
  } finally {
    await release();
  }
}

async function writeJournal(root: string, journal: PruneJournal) {
  await replaceMetadata(root, LOCAL_PRUNE_JOURNAL_PATH, journal);
}

async function removeJournal(root: string, journal: PruneJournal) {
  const current = parsePruneJournal(
    await readSourceJson(root, LOCAL_PRUNE_JOURNAL_PATH, true),
  );
  if (!equalValue(current, journal))
    fail("ASSET_RECOVERY_REQUIRED", LOCAL_PRUNE_JOURNAL_PATH);
  await unlink(await assertSafeParents(root, LOCAL_PRUNE_JOURNAL_PATH));
}

function nextReceipt(plan: PrunePlan, receipt: InstallReceipt): InstallReceipt {
  const removed = new Set(plan.candidates.map((candidate) => candidate.path));
  return parseInstallReceipt({
    ...receipt,
    retired: receipt.retired.filter((file) => !removed.has(file.path)),
  });
}

async function validatePlan(
  root: string,
  plan: PrunePlan,
  recovery = false,
): Promise<InstallReceipt> {
  const current = await previewAlreadyLocked(root);
  if (!equalValue(current, plan))
    fail(recovery ? "ASSET_RECOVERY_REQUIRED" : "ASSET_PRUNE_STALE");
  for (const candidate of plan.candidates) {
    const digest = await digestSource(root, candidate.path, true);
    if (!sameDigest(digest, candidate))
      fail(
        recovery ? "ASSET_RECOVERY_REQUIRED" : "ASSET_PRUNE_STALE",
        candidate.path,
      );
  }
  return (await receiptWithBasis(root)).receipt;
}

async function finishPrune(
  root: string,
  journal: PruneJournal,
): Promise<AssetResult> {
  const durableIntentPaths = new Set(journal.intentPaths);
  let current = journal;
  for (const candidate of current.plan.candidates) {
    if (!current.intentPaths.includes(candidate.path)) {
      const beforeIntent = await sourceStat(root, candidate.path);
      if (!beforeIntent?.isFile())
        fail("ASSET_RECOVERY_REQUIRED", candidate.path);
      const beforeIntentDigest = await digestSource(root, candidate.path, true);
      const beforeIntentRecheck = await sourceStat(root, candidate.path);
      if (
        !sameDigest(beforeIntentDigest, candidate) ||
        !beforeIntentRecheck ||
        !sameFile(beforeIntent, beforeIntentRecheck)
      )
        fail("ASSET_RECOVERY_REQUIRED", candidate.path);
      current = {
        ...current,
        phase: "deleting",
        intentPaths: [...current.intentPaths, candidate.path],
      };
      await writeJournal(root, current);
    }
    const info = await sourceStat(root, candidate.path);
    if (!info) {
      if (!durableIntentPaths.has(candidate.path))
        fail("ASSET_PRUNE_STALE", candidate.path);
    } else {
      if (!info.isFile()) fail("ASSET_RECOVERY_REQUIRED", candidate.path);
      const digest = await digestSource(root, candidate.path, true);
      const rechecked = await sourceStat(root, candidate.path);
      if (
        !sameDigest(digest, candidate) ||
        !rechecked ||
        !sameFile(info, rechecked)
      )
        fail("ASSET_RECOVERY_REQUIRED", candidate.path);
      await unlink(await assertSafeParents(root, candidate.path));
    }
    if (!current.completedPaths.includes(candidate.path)) {
      current = {
        ...current,
        completedPaths: [...current.completedPaths, candidate.path],
      };
      await writeJournal(root, current);
    }
  }
  const basis = await digestSource(root, INSTALL_RECEIPT_PATH, true);
  if (basis.sha256 !== current.plan.basisSha256)
    fail("ASSET_RECOVERY_REQUIRED", INSTALL_RECEIPT_PATH);
  await replaceMetadata(root, INSTALL_RECEIPT_PATH, current.nextReceipt, basis);
  current = { ...current, phase: "committed" };
  await writeJournal(root, current);
  await removeJournal(root, current);
  return {
    status: "ok",
    operation: "prune",
    snapshotSha256: current.nextReceipt!.snapshotSha256,
  };
}

export async function applyLocalPrune(
  root: string,
  value: PrunePlan,
): Promise<AssetResult> {
  const plan = parsePrunePlan(value);
  if (plan.scope !== "local") fail("ASSET_ARGUMENT_INVALID");
  const release = await acquireAssetDeliveryLock(root);
  try {
    const receipt = await validatePlan(root, plan);
    const journal: PruneJournal = parsePruneJournal({
      schemaVersion: 1,
      plan,
      phase: "prepared",
      intentPaths: [],
      completedPaths: [],
      nextState: null,
      nextReceipt: nextReceipt(plan, receipt),
    });
    await replaceMetadata(root, LOCAL_PRUNE_JOURNAL_PATH, journal, null);
    return await finishPrune(root, journal);
  } finally {
    await release();
  }
}

export async function resumeLocalPrune(root: string): Promise<AssetResult> {
  const release = await acquireAssetDeliveryLock(root, undefined, "prune");
  try {
    if (!(await sourceStat(root, LOCAL_PRUNE_JOURNAL_PATH)))
      fail("ASSET_REFERENCE_MISSING", LOCAL_PRUNE_JOURNAL_PATH);
    let journal: PruneJournal;
    try {
      journal = parsePruneJournal(
        await readSourceJson(root, LOCAL_PRUNE_JOURNAL_PATH, true),
      );
    } catch {
      fail("ASSET_RECOVERY_REQUIRED", LOCAL_PRUNE_JOURNAL_PATH);
    }
    const current = await receiptWithBasis(root);
    if (equalValue(current.receipt, journal.nextReceipt)) {
      const committed: PruneJournal = {
        ...journal,
        phase: "committed",
        intentPaths: journal.plan.candidates.map((candidate) => candidate.path),
        completedPaths: journal.plan.candidates.map(
          (candidate) => candidate.path,
        ),
      };
      await writeJournal(root, committed);
      await removeJournal(root, committed);
      return {
        status: "ok",
        operation: "prune",
        snapshotSha256: committed.nextReceipt!.snapshotSha256,
      };
    }
    if (current.basisSha256 !== journal.plan.basisSha256)
      fail("ASSET_RECOVERY_REQUIRED", INSTALL_RECEIPT_PATH);
    for (const candidate of journal.plan.candidates) {
      const info = await sourceStat(root, candidate.path);
      if (!info) {
        if (!journal.intentPaths.includes(candidate.path))
          fail("ASSET_RECOVERY_REQUIRED", candidate.path);
        continue;
      }
      const digest = await digestSource(root, candidate.path, true);
      if (!sameDigest(digest, candidate))
        fail("ASSET_RECOVERY_REQUIRED", candidate.path);
    }
    return await finishPrune(root, journal);
  } finally {
    await release();
  }
}

export function prunePlanSha256(plan: PrunePlan): string {
  return createHash("sha256").update(canonicalBytes(plan)).digest("hex");
}
