import type { ManifestRef } from "./manifest-ref.ts";
export interface InstallReceipt {
  readonly manifest: ManifestRef;
  readonly verifiedAt: number;
  readonly fileKeys: readonly string[];
}
