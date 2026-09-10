import type { ManifestRef } from "./manifest-ref.ts";
import type { RuntimeSnapshotRef } from "./runtime-snapshot-ref.ts";
import type { ContentResult } from "./content-result.ts";
import type { ContentReadPort } from "./content-read-port.ts";

export interface RuntimeActivationPort {
  prepare(
    ref: RuntimeSnapshotRef,
    runtime: ManifestRef,
    reader: ContentReadPort,
  ): Promise<ContentResult<RuntimeSnapshotRef>>;
}
