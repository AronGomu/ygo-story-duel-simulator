import type {
  ContentResult,
  InstalledRuntimeReceipt,
  ManifestRef,
  RuntimeSnapshotRef,
} from "../../content/index.ts";
import { verifyDigest } from "../../decks/catalog/snapshot-digest.ts";
import { SNAPSHOT_DATABASE_NAME, SnapshotStore } from "./snapshot-store.ts";

const paths = [
  "runtime/current/manifest.json",
  "runtime/assets/current/manifest.json",
  "runtime/engine/vendor-manifest.json",
] as const;
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|")
  );
}
const failed = (
  code:
    | "CONTENT_MISSING"
    | "CONTENT_INTEGRITY_FAILED"
    | "CONTENT_STORAGE_UNAVAILABLE"
    | "CONTENT_QUOTA_EXCEEDED",
) => ({ kind: "failed" as const, code, packId: null, path: null });
export async function parseInstalledRuntimeReceipt(
  value: unknown,
  ref: RuntimeSnapshotRef,
  runtime: ManifestRef,
): Promise<ContentResult<InstalledRuntimeReceipt>> {
  try {
    if (
      !exact(value, [
        "schemaVersion",
        "kind",
        "snapshot",
        "runtimePack",
        "runtimeManifestFile",
        "assetManifestFile",
        "engineManifestFile",
        "verifiedAt",
      ]) ||
      value.schemaVersion !== 1 ||
      value.kind !== "installed-runtime-v1" ||
      !Number.isSafeInteger(value.verifiedAt) ||
      (value.verifiedAt as number) < 0
    )
      return failed("CONTENT_INTEGRITY_FAILED");
    if (
      !exact(value.snapshot, [
        "activationId",
        "runtimeSnapshotId",
        "runtimeManifestSha256",
        "releaseCatalogSha256",
      ]) ||
      !Object.values(value.snapshot).every(hash) ||
      !Object.entries(ref).every(
        ([k, v]) =>
          value.snapshot &&
          (value.snapshot as Record<string, unknown>)[k] === v,
      )
    )
      return failed("CONTENT_INTEGRITY_FAILED");
    if (
      !exact(value.runtimePack, ["packId", "sha256", "bytes"]) ||
      value.runtimePack.packId !== "runtime" ||
      runtime.packId !== "runtime" ||
      !hash(value.runtimePack.sha256) ||
      value.runtimePack.sha256 !== runtime.sha256 ||
      value.runtimePack.bytes !== runtime.bytes ||
      !Number.isSafeInteger(runtime.bytes) ||
      runtime.bytes < 1 ||
      runtime.bytes > 4194304
    )
      return failed("CONTENT_INTEGRITY_FAILED");
    for (const [i, key] of [
      "runtimeManifestFile",
      "assetManifestFile",
      "engineManifestFile",
    ].entries()) {
      const file = value[key];
      if (
        !exact(file, ["path", "bytes", "sha256"]) ||
        file.path !== paths[i] ||
        !hash(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        (file.bytes as number) < 1 ||
        (file.bytes as number) > 16777216
      )
        return failed("CONTENT_INTEGRITY_FAILED");
    }
    const receipt = value as unknown as InstalledRuntimeReceipt;
    if (receipt.runtimeManifestFile.sha256 !== ref.runtimeManifestSha256)
      return failed("CONTENT_INTEGRITY_FAILED");
    await verifyDigest(
      "activation",
      new TextEncoder().encode(
        JSON.stringify({
          runtimeSnapshotId: ref.runtimeSnapshotId,
          releaseCatalogSha256: ref.releaseCatalogSha256,
        }),
      ),
      ref.activationId,
    );
    return { kind: "ok", value: receipt };
  } catch {
    return failed("CONTENT_INTEGRITY_FAILED");
  }
}
export async function writeInstalledRuntimeReceipt(
  receipt: InstalledRuntimeReceipt,
): Promise<ContentResult<InstalledRuntimeReceipt>> {
  const parsed = await parseInstalledRuntimeReceipt(
    receipt,
    receipt.snapshot,
    receipt.runtimePack,
  );
  if (parsed.kind === "failed") return parsed;
  try {
    const store = await SnapshotStore.open();
    try {
      await store.recordInstalledRuntimeReceipt(receipt);
    } finally {
      store.close();
    }
    return parsed;
  } catch (error) {
    return failed(
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "CONTENT_QUOTA_EXCEEDED"
        : "CONTENT_STORAGE_UNAVAILABLE",
    );
  }
}
/** An absent DB is not created; legacy records can never satisfy this reader. */
export async function readInstalledRuntimeReceipt(
  ref: RuntimeSnapshotRef,
  runtime: ManifestRef,
): Promise<ContentResult<InstalledRuntimeReceipt>> {
  return new Promise((resolve) => {
    let settled = false;
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    const finish = (
      value:
        | ContentResult<InstalledRuntimeReceipt>
        | PromiseLike<ContentResult<InstalledRuntimeReceipt>>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      resolve(value);
    };
    const timeout = setTimeout(() => {
      if (transaction) {
        try {
          transaction.abort();
        } catch (error) {
          // A completed readonly transaction needs no cancellation; timeout still fails.
          if (!(
            error instanceof DOMException && error.name === "InvalidStateError"
          )) {
            finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
            return;
          }
        }
      }
      finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
    }, 5000);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(SNAPSHOT_DATABASE_NAME);
    } catch {
      finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
      return;
    }
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () =>
      finish(
        failed(missing ? "CONTENT_MISSING" : "CONTENT_STORAGE_UNAVAILABLE"),
      );
    request.onblocked = () => finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      database = db;
      if (!db.objectStoreNames.contains("installedRuntimeReceipts")) {
        finish(failed("CONTENT_MISSING"));
        return;
      }
      try {
        transaction = db.transaction("installedRuntimeReceipts", "readonly");
        const row = transaction
          .objectStore("installedRuntimeReceipts")
          .get(ref.activationId);
        transaction.oncomplete = () =>
          finish(
            row.result === undefined
              ? failed("CONTENT_MISSING")
              : parseInstalledRuntimeReceipt(row.result, ref, runtime),
          );
        transaction.onabort = () =>
          finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
        transaction.onerror = () =>
          finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
      } catch {
        finish(failed("CONTENT_STORAGE_UNAVAILABLE"));
      }
    };
  });
}
