import type { Sha256 } from "./identity.ts";

export interface FileDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}

import { hash, integer, object, array } from "./schema.ts";
import { assertSafePath, assertNoPathCollisions } from "./path-guards.ts";

export function parseFileDigest(value: unknown): FileDigest {
  return object(value, { path: assertSafePath, bytes: integer, sha256: hash });
}
export function parseFileDigests(value: unknown): readonly FileDigest[] {
  const files = array(parseFileDigest)(value);
  assertNoPathCollisions(files.map((file) => file.path));
  return files;
}
