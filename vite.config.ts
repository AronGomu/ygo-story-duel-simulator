import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type UserConfig } from "vite";
import { appBuildIdentity } from "./scripts/lib/app-build-identity.ts";
import {
  coreContentPlugin,
  prepareCoreDelivery,
} from "./scripts/lib/vite-core-content.ts";
import { syncOnlyVendoredCorePlugin } from "./scripts/lib/vite-sync-core.ts";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async (): Promise<UserConfig> => {
  const developmentPort = Number(process.env.DEV_PORT ?? "4202");
  if (!Number.isSafeInteger(developmentPort) || developmentPort <= 0)
    throw new Error("DEV_PORT must be a positive integer");
  const delivery = await prepareCoreDelivery(
    projectRoot,
    process.env.CONTENT_RUN,
  );
  const appBuildDate = new Date().toISOString().slice(0, 10);

  return {
    base: process.env.BASE_PATH ?? "/",
    /* Public currently contains acquired/story gameplay data. CORE serves only
       explicit source assets plus the verified delivery plugin below. */
    publicDir: false,
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
      coreContentPlugin(projectRoot, delivery),
    ],
    define: {
      __RUNTIME_MANIFEST_SHA256__: "null",
      __RUNTIME_SNAPSHOT_ID__: "null",
      __ACTIVATION_SNAPSHOT_ID__: "null",
      __APP_BUILD_ID__: JSON.stringify(
        appBuildIdentity(projectRoot, delivery.bootstrapBytes),
      ),
      __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
      __ACTIVE_IMAGE_MANIFEST__: "null",
      __ACTIVE_IMAGE_MANIFEST_SHA256__: "null",
      __RUNTIME_REVISIONS__: "null",
    },
    build: {
      target: "es2023",
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        /* Product ships one document. Acceptance harness stays opt-in. */
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
  };
});
