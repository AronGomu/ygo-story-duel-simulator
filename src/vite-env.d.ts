/// <reference types="vite/client" />

declare const __RUNTIME_MANIFEST_SHA256__: string | null;
declare const __RUNTIME_SNAPSHOT_ID__: string | null;
declare const __ACTIVATION_SNAPSHOT_ID__: string | null;
declare const __APP_BUILD_ID__: string;
declare const __APP_BUILD_DATE__: string;
declare const __ACTIVE_IMAGE_MANIFEST_SHA256__: string | null;
declare const __ACTIVE_IMAGE_MANIFEST__: Readonly<{
  schemaVersion: 1;
  snapshotId: string;
  provider: "bundled-archive";
  redistributionApproved: false;
  files: readonly Readonly<{
    code: number;
    path: string;
    bytes: number;
    sha256: string;
  }>[];
  missing: readonly number[];
}> | null;
declare const __RUNTIME_REVISIONS__: Readonly<{
  runtimeSnapshotId: string;
  runtimeManifestSha256: string;
  assetManifestSha256: string;
  engineManifestSha256: string;
  babelCdb: string;
  cardScripts: string;
  distribution: string;
  imageProvider: string;
}> | null;

declare module "*.ydk?raw" {
  const source: string;
  export default source;
}
