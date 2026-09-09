import type { AssetRoot, ProfileId } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";

export interface SelectedAsset extends FileDigest {
  readonly root: AssetRoot;
  readonly sourcePath: string;
  readonly profile: ProfileId | "dev-only";
  readonly logicalPath: string | null;
}

import { hash, integer, nullable, object } from "./schema.ts";
import {
  assertManagedPath,
  assertSourcePath,
  assertSafePath,
  parseAssetRoot,
} from "./path-guards.ts";
import { parseProfileId } from "./asset-profile.ts";
import { fail } from "./failure.ts";
export function parseSelectedAsset(value: unknown): SelectedAsset {
  const file = object(value, {
    path: assertManagedPath,
    bytes: integer,
    sha256: hash,
    root: parseAssetRoot,
    sourcePath: assertSourcePath,
    profile: (v) => (v === "dev-only" ? v : parseProfileId(v)),
    logicalPath: nullable(assertSafePath),
  });
  if (
    file.path !== `assets/${file.root}/${file.sourcePath}` ||
    (file.profile === "dev-only") !== (file.logicalPath === null)
  )
    fail();
  return file;
}
