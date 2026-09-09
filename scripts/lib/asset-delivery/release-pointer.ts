import type { ObjectRef } from "./object-ref.ts";

export interface ReleasePointer {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly snapshot: ObjectRef;
}

import { object, releaseVersion, version } from "./schema.ts";
import { objectRefIn } from "./object-ref.ts";
export function parseReleasePointer(value: unknown): ReleasePointer {
  return object(value, {
    schemaVersion: version,
    version: releaseVersion,
    snapshot: objectRefIn("snapshots"),
  });
}
