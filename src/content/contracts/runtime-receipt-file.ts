import type { Sha256 } from "./sha256.ts";
export interface RuntimeReceiptFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
