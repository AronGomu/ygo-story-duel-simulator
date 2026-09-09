import type { FileDigest } from "./file-digest.ts";
import type { ObjectRef } from "./object-ref.ts";

export interface CoreFile extends FileDigest {
  readonly logicalPath: string;
}
export interface CoreManifest {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly inventory: ObjectRef;
  readonly archive: ObjectRef;
  readonly files: readonly CoreFile[];
}

import {
  array,
  hash,
  integer,
  object,
  releaseVersion,
  version,
} from "./schema.ts";
import { objectRefIn } from "./object-ref.ts";
import {
  assertManagedPath,
  assertSafePath,
  assertNoPathCollisions,
} from "./path-guards.ts";
import { assertArchiveFiles } from "./archive-limits.ts";
export function parseCoreFile(value: unknown): CoreFile {
  return object(value, {
    path: assertManagedPath,
    logicalPath: assertSafePath,
    bytes: integer,
    sha256: hash,
  });
}
export function parseCoreManifest(value: unknown): CoreManifest {
  const manifest = object(value, {
    schemaVersion: version,
    appVersion: releaseVersion,
    inventory: objectRefIn("inventories"),
    archive: objectRefIn("core/archives"),
    files: array(parseCoreFile),
  });
  assertArchiveFiles(manifest.files, manifest.archive.bytes);
  assertNoPathCollisions(manifest.files.map((file) => file.logicalPath));
  return manifest;
}
