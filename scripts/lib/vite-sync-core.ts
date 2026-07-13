import { builtinModules } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

const DEFAULT_FACTORY =
  "async function Ce(e){return e?.sync??!1?await Te(e??{}):await Re(e??{})}";
const SYNC_FACTORY = "async function Ce(e){return await Te(e??{})}";
const OPTIONAL_WASM =
  "async function Te({...e}){let t=!e.wasmBinary&&!e.locateFile,[o,s]=await Promise.all([De(),t?Le():e.wasmBinary]);s&&(e.wasmBinary=s);";
const REQUIRED_WASM =
  'async function Te({...e}){if(!e.wasmBinary)throw new Error("wasmBinary is required");let[o,s]=await Promise.all([De(),e.wasmBinary]);s&&(e.wasmBinary=s);';

/**
 * The pinned package's general entry advertises async/embedded fallbacks that
 * production never permits. Narrow that reviewed entry at bundle time so Vite
 * can tree-shake JSPI and embedded-WASM chunks while all parsing/encoding code
 * still comes from the integrity-verified vendored source.
 */
export function syncOnlyVendoredCorePlugin(projectRoot: string): Plugin {
  const vendoredEntry = path
    .resolve(projectRoot, "vendor/ocgcore-wasm/0.1.2/dist/index.js")
    .replaceAll("\\", "/");
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  return {
    name: "ygo-sync-only-vendored-core",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer !== undefined && builtins.has(source))
        throw new Error(
          `Browser module ${importer} imports Node builtin ${source}`,
        );
      return null;
    },
    transform(source, id) {
      if (id.split("?", 1)[0]?.replaceAll("\\", "/") !== vendoredEntry)
        return null;
      if (
        !source.includes(DEFAULT_FACTORY) ||
        !source.includes(OPTIONAL_WASM)
      ) {
        throw new Error(
          "Pinned ocgcore entry changed; review the sync-only browser transform",
        );
      }
      return {
        code: source
          .replace(DEFAULT_FACTORY, SYNC_FACTORY)
          .replace(OPTIONAL_WASM, REQUIRED_WASM),
        map: null,
      };
    },
    generateBundle(_options, bundle) {
      const forbidden =
        /(?:^node:|[\\/](?:create-node-runtime|duel\.worker-node|mvp-preset-node|runtime-snapshot-node|active-duel-dependencies-node)\.ts$|[\\/]node_modules[\\/]ocgcore-wasm[\\/])/;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const moduleId = Object.keys(output.modules).find((id) =>
          forbidden.test(id),
        );
        if (moduleId !== undefined)
          throw new Error(
            `Browser chunk ${output.fileName} contains forbidden module ${moduleId}`,
          );
      }
    },
  };
}
