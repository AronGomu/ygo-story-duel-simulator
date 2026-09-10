import type { Sha256 } from "./sha256.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { RuntimeSnapshotRef } from "./runtime-snapshot-ref.ts";

export interface ContentSetRef {
  readonly catalogSha256: Sha256;
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ManifestRef[];
}
