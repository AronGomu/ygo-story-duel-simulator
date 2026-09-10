import type { Sha256 } from "./sha256.ts";

export interface VerifiedMetadata<T> {
  readonly bytes: Uint8Array;
  readonly value: T;
  readonly sha256: Sha256;
}
