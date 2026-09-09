import type { Sha256 } from "./identity.ts";
import type { ObjectRef } from "./object-ref.ts";

export interface CoreCopyPlan {
  readonly schemaVersion: 1;
  readonly snapshot: ObjectRef;
  readonly prodInventory: ObjectRef;
  readonly coreManifest: ObjectRef;
  readonly files: readonly {
    readonly stagedPath: string;
    readonly logicalPath: string;
    readonly bytes: number;
    readonly sha256: Sha256;
  }[];
}

import { array, hash, integer, object, version } from "./schema.ts";
import { objectRefIn } from "./object-ref.ts";
import {
  assertManagedPath,
  assertSafePath,
  assertNoPathCollisions,
} from "./path-guards.ts";
import { fail } from "./failure.ts";
export function parseCoreCopyPlan(value: unknown): CoreCopyPlan {
  const plan = object(value, {
    schemaVersion: version,
    snapshot: objectRefIn("snapshots"),
    prodInventory: objectRefIn("inventories"),
    coreManifest: objectRefIn("core/manifests"),
    files: array((v) =>
      object(v, {
        stagedPath: assertSafePath,
        logicalPath: assertSafePath,
        bytes: integer,
        sha256: hash,
      }),
    ),
  });
  const prefix = `generated/asset-delivery/core/${plan.coreManifest.sha256}/files/`;
  for (const file of plan.files) {
    if (!file.stagedPath.startsWith(prefix)) fail("ASSET_PATH_UNSAFE");
    assertManagedPath(file.stagedPath.slice(prefix.length));
  }
  assertNoPathCollisions(plan.files.map((file) => file.stagedPath));
  assertNoPathCollisions(plan.files.map((file) => file.logicalPath));
  return plan;
}
