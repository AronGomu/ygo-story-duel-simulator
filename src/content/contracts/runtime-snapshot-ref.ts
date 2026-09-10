import type { Sha256 } from "./sha256.ts";

export interface RuntimeSnapshotRef {
  readonly activationId: Sha256;
  readonly runtimeSnapshotId: Sha256;
  readonly runtimeManifestSha256: Sha256;
  readonly releaseCatalogSha256: Sha256;
}
