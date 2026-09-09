import type { Sha256 } from "./identity.ts";

export interface ObjectRef {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}

import { hash, integer, object } from "./schema.ts";
import { assertSafePath } from "./path-guards.ts";
import { fail } from "./failure.ts";

export function parseObjectRef(value: unknown): ObjectRef {
  const ref = object(value, {
    key: assertSafePath,
    bytes: integer,
    sha256: hash,
  });
  const match =
    /^(inventories|dev\/manifests|snapshots|core\/manifests|content\/(?:indexes|catalogs|manifests)|dev\/archives|core\/archives|content\/parts)\/([a-f0-9]{64})\.(json|zip)$/.exec(
      ref.key,
    );
  // Release pointers are the sole immutable, version-addressed exception.
  if (!match) fail();
  if (match[2] !== ref.sha256) fail("ASSET_INTEGRITY_FAILED");
  if (match[3] !== (/archives$|parts$/.test(match[1]!) ? "zip" : "json"))
    fail();
  return ref;
}
export function objectRefIn(prefix: string): (value: unknown) => ObjectRef {
  return (value) => {
    const ref = parseObjectRef(value);
    if (!ref.key.startsWith(`${prefix}/`)) fail();
    return ref;
  };
}
