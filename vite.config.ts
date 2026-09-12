import { ASSET_SOURCES } from "./scripts/lib/asset-roots.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import {
  activeImageManifestSha256,
  buildActiveImageManifest,
} from "./scripts/lib/active-image-manifest.ts";
import { browserRuntimeAssetsPlugin } from "./scripts/lib/vite-runtime-assets.ts";
import { syncOnlyVendoredCorePlugin } from "./scripts/lib/vite-sync-core.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const appBuildDate = new Date().toISOString().slice(0, 10);
const developmentPort = Number(process.env.DEV_PORT ?? "4202");
if (!Number.isSafeInteger(developmentPort) || developmentPort <= 0) {
  throw new Error("DEV_PORT must be a positive integer");
}
const runtimeManifestBytes = readFileSync(
  path.join(projectRoot, `${ASSET_SOURCES.runtime.source}/manifest.json`),
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
  server: {
    port: developmentPort,
    strictPort: true,
    watch: {
      ignored: ["**/.tmp/**"],
    },
  },
  preview: {
    port: developmentPort,
    strictPort: true,
  },
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
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
    __ACTIVE_IMAGE_MANIFEST__: JSON.stringify(activeImageManifest),
    __ACTIVE_IMAGE_MANIFEST_SHA256__: JSON.stringify(activeImageDigest),
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
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      /* The product ships one document. The acceptance harness is the only
         reason a second input exists, and it is opt-in per run. */
      input:
        process.env.ACCEPTANCE_SCENARIOS === "1"
          ? {
              index: path.join(projectRoot, "index.html"),
              acceptance: path.join(projectRoot, "acceptance.html"),
            }
          : { app: path.join(projectRoot, "index.html") },
    },
  },
  worker: {
    format: "es",
    plugins: () => [syncOnlyVendoredCorePlugin(projectRoot)],
  },
});
