import type { Sha256 } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";
import type { InstallReceipt } from "./install-receipt.ts";

export interface InstallChange {
  readonly path: string;
  readonly before: FileDigest | null;
  readonly after: FileDigest;
}
export interface InstallJournal {
  readonly schemaVersion: 1;
  readonly snapshotSha256: Sha256;
  readonly phase: "prepared" | "applying" | "committed";
  readonly previousReceipt: InstallReceipt | null;
  readonly nextReceipt: InstallReceipt;
  readonly changes: readonly InstallChange[];
}

import { array, hash, literal, nullable, object, version } from "./schema.ts";
import { parseFileDigest } from "./file-digest.ts";
import { parseInstallReceipt } from "./install-receipt.ts";
import { assertManagedPath, assertNoPathCollisions } from "./path-guards.ts";
import { fail } from "./failure.ts";
export function parseInstallChange(value: unknown): InstallChange {
  const change = object(value, {
    path: assertManagedPath,
    before: nullable(parseFileDigest),
    after: parseFileDigest,
  });
  if (
    change.path !== change.after.path ||
    (change.before !== null && change.path !== change.before.path)
  )
    fail();
  return change;
}
export function parseInstallJournal(value: unknown): InstallJournal {
  const journal = object(value, {
    schemaVersion: version,
    snapshotSha256: hash,
    phase: literal("prepared", "applying", "committed"),
    previousReceipt: nullable(parseInstallReceipt),
    nextReceipt: parseInstallReceipt,
    changes: array(parseInstallChange),
  });
  assertNoPathCollisions(journal.changes.map((change) => change.path));
  const nextFiles = new Map(
    journal.nextReceipt.files.map((file) => [file.path, file]),
  );
  if (
    journal.snapshotSha256 !== journal.nextReceipt.snapshotSha256 ||
    journal.changes.some((change) => {
      const file = nextFiles.get(change.path);
      return (
        file?.bytes !== change.after.bytes ||
        file.sha256 !== change.after.sha256
      );
    })
  )
    fail("ASSET_INTEGRITY_FAILED");
  return journal;
}
