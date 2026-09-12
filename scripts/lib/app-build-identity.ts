import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT_FILES = [
  "assets/story/chapter-01/city-map-placeholder.svg",
  "index.html",
  "package-lock.json",
  "package.json",
  "vite.config.ts",
] as const;
const SOURCE_ROOTS = ["src", "vendor/ocgcore-wasm/0.1.2"] as const;
const BUILD_HELPERS = [
  "scripts/lib/app-build-identity.ts",
  "scripts/lib/vite-core-content.ts",
  "scripts/lib/vite-sync-core.ts",
] as const;

function filesUnder(root: string, relative: string): string[] {
  const absolute = path.join(root, relative);
  if (statSync(absolute).isFile()) return [relative];
  return readdirSync(absolute)
    .sort()
    .flatMap((entry) => filesUnder(root, path.join(relative, entry)));
}

/** Deterministic executable/static identity; acquired runtime roots never enter. */
export function appBuildIdentity(
  projectRoot: string,
  coreBootstrapBytes: Uint8Array,
): string {
  const hash = createHash("sha256");
  const files = [
    ...ROOT_FILES,
    ...BUILD_HELPERS,
    ...SOURCE_ROOTS.flatMap((root) => filesUnder(projectRoot, root)),
  ].sort();
  for (const file of files) {
    const normalized = file.split(path.sep).join("/");
    const bytes = readFileSync(path.join(projectRoot, file));
    hash.update(`${normalized}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  hash.update(`core-bootstrap.json\0${coreBootstrapBytes.byteLength}\0`);
  hash.update(coreBootstrapBytes);
  return `0.1.0+${hash.digest("hex").slice(0, 12)}`;
}
