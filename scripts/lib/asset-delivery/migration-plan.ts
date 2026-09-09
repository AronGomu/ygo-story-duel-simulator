import type { Sha256 } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";

export interface MigrationPlan {
  readonly schemaVersion: 1;
  readonly files: readonly {
    readonly from: string;
    readonly to: string;
    readonly bytes: number;
    readonly sha256: Sha256;
  }[];
}
export interface MigrationReceipt {
  readonly schemaVersion: 1;
  readonly planSha256: Sha256;
  readonly completed: readonly FileDigest[];
}

import {
  array,
  assertSorted,
  hash,
  integer,
  object,
  version,
} from "./schema.ts";
import { compareCodePoints } from "./canonical-json.ts";
import {
  assertManagedPath,
  assertSafePath,
  assertNoPathCollisions,
} from "./path-guards.ts";
import { parseFileDigests } from "./file-digest.ts";
import { mappedLegacyPath } from "./source-mapping.ts";
import { fail } from "./failure.ts";
export function parseMigrationPlan(value: unknown): MigrationPlan {
  const plan = object(value, {
    schemaVersion: version,
    files: array((v) =>
      object(v, {
        from: assertSafePath,
        to: assertManagedPath,
        bytes: integer,
        sha256: hash,
      }),
    ),
  });
  for (const file of plan.files)
    if (mappedLegacyPath(file.from) !== file.to) fail("ASSET_PATH_UNSAFE");
  assertNoPathCollisions(plan.files.map((file) => file.from));
  assertNoPathCollisions(plan.files.map((file) => file.to));
  assertSorted(
    plan.files,
    (left, right) =>
      compareCodePoints(left.from, right.from) ||
      compareCodePoints(left.to, right.to) ||
      left.bytes - right.bytes ||
      compareCodePoints(left.sha256, right.sha256),
  );
  return plan;
}
export function parseMigrationReceipt(value: unknown): MigrationReceipt {
  const receipt = object(value, {
    schemaVersion: version,
    planSha256: hash,
    completed: parseFileDigests,
  });
  receipt.completed.forEach((file) => assertManagedPath(file.path));
  return receipt;
}
