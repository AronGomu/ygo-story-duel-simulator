import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { buildActiveCardTextManifest } from "./scripts/lib/active-card-text-manifest.ts";
import {
  activeImageManifestSha256,
  buildActiveImageManifest,
} from "./scripts/lib/active-image-manifest.ts";
import { browserRuntimeAssetsPlugin } from "./scripts/lib/vite-runtime-assets.ts";
import { syncOnlyVendoredCorePlugin } from "./scripts/lib/vite-sync-core.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeManifestBytes = readFileSync(
  path.join(projectRoot, "generated/runtime/current/manifest.json"),
);
const runtimeManifestSha256 = createHash("sha256")
  .update(runtimeManifestBytes)
  .digest("hex");
const runtimeManifest = JSON.parse(runtimeManifestBytes.toString("utf8")) as {
  readonly snapshotId: string;
  readonly engine: { readonly manifestSha256: string };
  readonly assets: {
    readonly manifestSha256: string;
    readonly babelCdbRevision: string;
    readonly cardScriptsRevision: string;
    readonly distributionRevision: string;
  };
};
const runtimeSnapshotId = runtimeManifest.snapshotId;
const activeImageManifest = buildActiveImageManifest(
  projectRoot,
  runtimeSnapshotId,
);
const activeImageDigest = activeImageManifestSha256(activeImageManifest);
const activeCardTexts = buildActiveCardTextManifest(
  projectRoot,
  new Set([
    ...activeImageManifest.files.map(({ code }) => code),
    ...activeImageManifest.missing,
  ]),
);
const activationSnapshotId = createHash("sha256")
  .update(
    JSON.stringify({
      runtimeSnapshotId,
      activeImageManifestSha256: activeImageDigest,
    }),
  )
  .digest("hex");

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    syncOnlyVendoredCorePlugin(projectRoot),
    svelte(),
    browserRuntimeAssetsPlugin(projectRoot),
  ],
  define: {
    __RUNTIME_MANIFEST_SHA256__: JSON.stringify(runtimeManifestSha256),
    __RUNTIME_SNAPSHOT_ID__: JSON.stringify(runtimeSnapshotId),
    __ACTIVATION_SNAPSHOT_ID__: JSON.stringify(activationSnapshotId),
    __APP_BUILD_ID__: JSON.stringify(
      `0.1.0+${runtimeManifestSha256.slice(0, 12)}`,
    ),
    __ACTIVE_IMAGE_MANIFEST__: JSON.stringify(activeImageManifest),
    __ACTIVE_IMAGE_MANIFEST_SHA256__: JSON.stringify(activeImageDigest),
    __ACTIVE_CARD_TEXTS__: JSON.stringify(activeCardTexts),
    __RUNTIME_REVISIONS__: JSON.stringify({
      runtimeSnapshotId,
      runtimeManifestSha256,
      assetManifestSha256: runtimeManifest.assets.manifestSha256,
      engineManifestSha256: runtimeManifest.engine.manifestSha256,
      babelCdb: runtimeManifest.assets.babelCdbRevision,
      cardScripts: runtimeManifest.assets.cardScriptsRevision,
      distribution: runtimeManifest.assets.distributionRevision,
      imageProvider: `bundled-archive:${activeImageDigest}`,
    }),
  },
  build: {
    target: "es2023",
    // Phaser is isolated in an on-demand presentation chunk.
    chunkSizeWarningLimit: 1_500,
  },
  worker: {
    format: "es",
    plugins: () => [syncOnlyVendoredCorePlugin(projectRoot)],
  },
});
