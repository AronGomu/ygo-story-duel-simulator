import type { Sha256 } from "./sha256.ts";

export interface ZipPart {
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly unpackedBytes: number;
}
