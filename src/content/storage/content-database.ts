import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { InstallReceipt } from "../contracts/install-receipt.ts";
import type { PersistedDownloadJob } from "../contracts/persisted-download-job.ts";
import type { InstalledContentSet } from "../contracts/installed-content-set.ts";
import type { ContentFailure } from "../contracts/content-failure.ts";
import {
  CONTENT_DATABASE_NAME,
  CONTENT_DATABASE_VERSION,
} from "../content-constants.ts";
import { failure } from "../content-verification.ts";
import { validateInstalledState } from "../install/manifest-closure.ts";

export interface ContentDatabase extends DBSchema {
  catalogs: { key: string; value: Uint8Array };
  manifests: { key: string; value: Uint8Array };
  jobs: { key: string; value: PersistedDownloadJob };
  receipts: { key: string; value: InstallReceipt };
  active: { key: string; value: InstalledContentSet };
  invalid: { key: string; value: ContentFailure };
}
export const EMPTY_CONTENT: InstalledContentSet = {
  generation: 0,
  current: null,
  previous: null,
};
export function openContentDatabase(): Promise<IDBPDatabase<ContentDatabase>> {
  return openDB<ContentDatabase>(
    CONTENT_DATABASE_NAME,
    CONTENT_DATABASE_VERSION,
    {
      upgrade(db) {
        for (const name of [
          "catalogs",
          "manifests",
          "jobs",
          "receipts",
          "active",
          "invalid",
        ] as const)
          db.createObjectStore(name);
      },
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
      },
    },
  );
}
export async function abortContentTransaction(
  tx: { abort(): void },
  done: Promise<unknown>,
): Promise<void> {
  try {
    tx.abort();
  } catch (error) {
    // IDB may already have aborted/committed; retain the original operation failure.
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError")
      throw error;
  }
  await done;
}
/** No hashing, Cache work or foreign promises inside this transaction. */
export async function commitInstall(
  db: IDBPDatabase<ContentDatabase>,
  job: PersistedDownloadJob,
  receipts: readonly InstallReceipt[],
): Promise<InstalledContentSet> {
  const tx = db.transaction(
    ["active", "receipts", "jobs", "invalid"],
    "readwrite",
  );
  const done = tx.done.then(
    () => null,
    (error: unknown) => error,
  );
  try {
    const old = validateInstalledState(
      (await tx.objectStore("active").get("current")) ?? EMPTY_CONTENT,
    );
    if (old.generation === Number.MAX_SAFE_INTEGER)
      throw failure("CONTENT_ACTIVATION_CONFLICT");
    if (old.generation !== job.expectedGeneration)
      throw failure("CONTENT_ACTIVATION_CONFLICT");
    if (!job.content) throw failure("CONTENT_INTEGRITY_FAILED");
    const next = {
      generation: old.generation + 1,
      current: job.content,
      previous: old.current,
    };
    for (const receipt of receipts) {
      await tx.objectStore("receipts").put(receipt, receipt.manifest.sha256);
      await tx.objectStore("invalid").delete(receipt.manifest.sha256);
    }
    await tx.objectStore("active").put(next, "current");
    await tx.objectStore("jobs").put(
      {
        ...job,
        progress: { ...job.progress, phase: "complete" },
        failure: null,
      },
      job.jobId,
    );
    const error = await done;
    if (error) throw error;
    return next;
  } catch (error) {
    await abortContentTransaction(tx, done);
    throw error;
  }
}
