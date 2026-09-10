import type { FileDigest } from "./file-digest.ts";
import type { ObjectRef } from "./object-ref.ts";

export interface DevManifest {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly layoutVersion: 1;
  readonly inventory: ObjectRef;
  readonly archive: ObjectRef;
  readonly files: readonly FileDigest[];
}

import { assertSorted, object, releaseVersion, version } from "./schema.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { objectRefIn } from "./object-ref.ts";
import { parseFileDigests } from "./file-digest.ts";
import { assertArchiveFiles } from "./archive-limits.ts";
import { parseLayoutVersion } from "./install-receipt.ts";
export function parseDevManifest(value: unknown): DevManifest {
  const manifest = object(value, {
    schemaVersion: version,
    appVersion: releaseVersion,
    layoutVersion: parseLayoutVersion,
    inventory: objectRefIn("inventories"),
    archive: objectRefIn("dev/archives"),
    files: parseFileDigests,
  });
  assertSorted(manifest.files, (a, b) => compareCodePoints(a.path, b.path));
  assertArchiveFiles(manifest.files, manifest.archive.bytes);
  return manifest;
}
