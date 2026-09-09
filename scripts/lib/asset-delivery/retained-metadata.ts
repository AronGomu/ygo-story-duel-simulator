import type { Sha256 } from "./identity.ts";

export interface RetainedMetadata {
  readonly schemaVersion: 1;
  readonly catalogs: readonly {
    readonly sha256: Sha256;
    readonly bytes: number;
  }[];
  readonly manifests: readonly {
    readonly packId: "runtime" | "chapter-01";
    readonly sha256: Sha256;
    readonly bytes: number;
  }[];
}

import {
  array,
  assertSorted,
  hash,
  integer,
  literal,
  object,
  version,
} from "./schema.ts";
import { compareCodePoints } from "./canonical-json.ts";
export function parseRetainedMetadata(value: unknown): RetainedMetadata {
  const metadata = object(value, {
    schemaVersion: version,
    catalogs: array(
      (v) => object(v, { sha256: hash, bytes: integer }),
      (ref) => ref.sha256,
    ),
    manifests: array(
      (v) =>
        object(v, {
          packId: literal("runtime", "chapter-01"),
          sha256: hash,
          bytes: integer,
        }),
      (ref) => `${ref.packId}/${ref.sha256}`,
    ),
  });
  assertSorted(metadata.catalogs, (left, right) =>
    compareCodePoints(left.sha256, right.sha256),
  );
  assertSorted(
    metadata.manifests,
    (left, right) =>
      compareCodePoints(left.sha256, right.sha256) ||
      compareCodePoints(left.packId, right.packId),
  );
  return metadata;
}
