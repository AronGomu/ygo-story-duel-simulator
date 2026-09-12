import type { RuntimeSnapshotRef } from "./runtime-snapshot-ref.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { RuntimeReceiptFile } from "./runtime-receipt-file.ts";
export interface InstalledRuntimeReceipt {
  readonly schemaVersion: 1;
  readonly kind: "installed-runtime-v1";
  readonly snapshot: RuntimeSnapshotRef;
  readonly runtimePack: ManifestRef;
  readonly runtimeManifestFile: RuntimeReceiptFile;
  readonly assetManifestFile: RuntimeReceiptFile;
  readonly engineManifestFile: RuntimeReceiptFile;
  readonly verifiedAt: number;
}
