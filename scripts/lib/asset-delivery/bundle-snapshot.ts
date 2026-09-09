import type { Sha256 } from "./identity.ts";
import type { ObjectRef } from "./object-ref.ts";

export interface PlayerBundleRef {
  readonly inventory: ObjectRef;
  readonly core: ObjectRef;
  readonly index: ObjectRef;
  readonly runtimeSnapshotId: Sha256;
}
export interface BundleSnapshot {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly inventory: ObjectRef;
  readonly dev: ObjectRef | null;
  readonly prod: PlayerBundleRef | null;
  readonly objects: readonly ObjectRef[];
}

import {
  array,
  assertSorted,
  hash,
  nullable,
  object,
  releaseVersion,
  version,
} from "./schema.ts";
import { objectRefIn, parseObjectRef } from "./object-ref.ts";
import { fail } from "./failure.ts";
import { compareCodePoints } from "./canonical-json.ts";
export function parsePlayerBundleRef(value: unknown): PlayerBundleRef {
  return object(value, {
    inventory: objectRefIn("inventories"),
    core: objectRefIn("core/manifests"),
    index: objectRefIn("content/indexes"),
    runtimeSnapshotId: hash,
  });
}
export function parseBundleSnapshot(value: unknown): BundleSnapshot {
  const snapshot = object(value, {
    schemaVersion: version,
    appVersion: releaseVersion,
    inventory: objectRefIn("inventories"),
    dev: nullable(objectRefIn("dev/manifests")),
    prod: nullable(parsePlayerBundleRef),
    objects: array(parseObjectRef, (ref) => ref.key),
  });
  assertSorted(snapshot.objects, (left, right) =>
    compareCodePoints(left.key, right.key),
  );
  if (snapshot.dev === null && snapshot.prod === null) fail();
  if (snapshot.objects.some((ref) => ref.key.startsWith("snapshots/"))) fail();
  const refs = [
    snapshot.inventory,
    ...(snapshot.dev ? [snapshot.dev] : []),
    ...(snapshot.prod
      ? [snapshot.prod.inventory, snapshot.prod.core, snapshot.prod.index]
      : []),
  ];
  for (const ref of refs) {
    if (
      !snapshot.objects.some(
        (other) =>
          other.key === ref.key &&
          other.bytes === ref.bytes &&
          other.sha256 === ref.sha256,
      )
    )
      fail("ASSET_REFERENCE_MISSING");
  }
  // Full transitive closure needs referenced documents; verified by consumer, not shape parser.
  return snapshot;
}
