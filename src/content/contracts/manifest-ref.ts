import type { Sha256 } from "./sha256.ts";
import type { PackId } from "./pack-id.ts";

export interface ManifestRef {
  readonly packId: PackId;
  readonly sha256: Sha256;
  readonly bytes: number;
}
