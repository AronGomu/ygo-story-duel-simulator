import type { ObjectRef } from "./object-ref.ts";

export interface PublicationInventory {
  readonly schemaVersion: 1;
  readonly nightly: ObjectRef | null;
  readonly releases: readonly {
    readonly version: string;
    readonly pointer: ObjectRef;
  }[];
  readonly retiredNightlies: readonly {
    readonly snapshot: ObjectRef;
    readonly retiredAt: string;
  }[];
}

import {
  array,
  hash,
  integer,
  nullable,
  object,
  releaseVersion,
  utcTimestamp,
  version,
} from "./schema.ts";
import { objectRefIn } from "./object-ref.ts";
import { assertSafePath } from "./path-guards.ts";
import { fail } from "./failure.ts";

export function parsePublicationInventory(
  value: unknown,
): PublicationInventory {
  const state = object(value, {
    schemaVersion: version,
    nightly: nullable(objectRefIn("snapshots")),
    releases: array(
      (v) => {
        const entry = object(v, {
          version: releaseVersion,
          pointer: (p) =>
            object(p, { key: assertSafePath, bytes: integer, sha256: hash }),
        });
        if (entry.pointer.key !== `releases/${entry.version}.json`) fail();
        return entry;
      },
      (entry) => entry.version,
    ),
    retiredNightlies: array(
      (v) =>
        object(v, {
          snapshot: objectRefIn("snapshots"),
          retiredAt: utcTimestamp,
        }),
      (entry) => entry.snapshot.key,
    ),
  });
  if (
    state.retiredNightlies.some(
      (entry) => entry.snapshot.key === state.nightly?.key,
    )
  )
    fail();
  return state;
}
