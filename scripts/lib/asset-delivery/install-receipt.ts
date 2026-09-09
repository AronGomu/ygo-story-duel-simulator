import type { Sha256 } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";

export interface InstallReceipt {
  readonly schemaVersion: 1;
  readonly layoutVersion: 1;
  readonly snapshotSha256: Sha256;
  readonly files: readonly FileDigest[];
  readonly retired: readonly FileDigest[];
}

import { hash, object, version } from "./schema.ts";
import { parseFileDigests } from "./file-digest.ts";
import { assertManagedPath, assertNoPathCollisions } from "./path-guards.ts";
import { fail } from "./failure.ts";
export function parseLayoutVersion(value: unknown): 1 {
  if (value !== 1) fail("ASSET_LAYOUT_INCOMPATIBLE");
  return 1;
}
export function parseInstallReceipt(value: unknown): InstallReceipt {
  const receipt = object(value, {
    schemaVersion: version,
    layoutVersion: parseLayoutVersion,
    snapshotSha256: hash,
    files: parseFileDigests,
    retired: parseFileDigests,
  });
  const paths = [...receipt.files, ...receipt.retired].map((file) =>
    assertManagedPath(file.path),
  );
  assertNoPathCollisions(paths);
  return receipt;
}
