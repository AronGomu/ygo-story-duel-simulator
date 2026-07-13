import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { parseRuntimeSnapshotManifest } from "../../src/worker/assets/runtime-manifest.ts";
import { buildActiveImageManifest } from "./active-image-manifest.ts";
import { resolveActiveRuntimeFiles } from "./active-runtime-files.ts";

const RUNTIME_PREFIX = "runtime/";

export function browserRuntimeAssetsPlugin(projectRoot: string): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "ygo-browser-runtime-assets",
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      installRuntimeMiddleware(server, projectRoot);
    },
    async closeBundle() {
      if (config?.command !== "build") return;
      const outputRoot = path.resolve(config.root, config.build.outDir);
      await copyRuntimeAssets(
        projectRoot,
        outputRoot,
        config.mode === "private",
      );
    },
  };
}

function installRuntimeMiddleware(
  server: ViteDevServer,
  projectRoot: string,
): void {
  server.middlewares.use((request, response, next) => {
    if (request.url === undefined) {
      next();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://vite.local").pathname,
      );
    } catch {
      response.statusCode = 400;
      response.end("Invalid runtime asset URL");
      return;
    }
    const base = normalizedBase(server.config.base);
    if (!pathname.startsWith(base)) {
      next();
      return;
    }
    const relativeRequest = pathname.slice(base.length);
    if (!relativeRequest.startsWith(RUNTIME_PREFIX)) {
      next();
      return;
    }
    const source = runtimeSourcePath(
      projectRoot,
      relativeRequest.slice(RUNTIME_PREFIX.length),
    );
    if (source === null) {
      response.statusCode = 404;
      response.end("Runtime asset not found");
      return;
    }
    void assertRealPathContained(projectRoot, source)
      .then(() => stat(source))
      .then((metadata) => {
        if (!metadata.isFile()) {
          response.statusCode = 404;
          response.end("Runtime asset not found");
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType(source));
        response.setHeader("Cache-Control", "no-store");
        createReadStream(source).pipe(response);
      })
      .catch((error: unknown) => {
        console.error({
          event: "vite.runtime.asset.failed",
          path: source,
          err: error,
        });
        response.statusCode = 404;
        response.end("Runtime asset not found");
      });
  });
}

async function copyRuntimeAssets(
  projectRoot: string,
  outputRoot: string,
  allowPrivateContent: boolean,
): Promise<void> {
  const runtimeOutput = path.join(outputRoot, "runtime");
  await Promise.all([
    copyFileWithParents(
      path.join(projectRoot, "generated/runtime/current/manifest.json"),
      path.join(runtimeOutput, "current/manifest.json"),
    ),
    copySnapshotAssets(projectRoot, runtimeOutput),
    copyActiveCardImages(projectRoot, runtimeOutput, allowPrivateContent),
    copyThirdPartyLicenses(projectRoot, outputRoot),
    copyFileWithParents(
      path.join(projectRoot, "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json"),
      path.join(runtimeOutput, "engine/vendor-manifest.json"),
    ),
    copyFileWithParents(
      path.join(projectRoot, "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm"),
      path.join(runtimeOutput, "engine/ocgcore.sync.wasm"),
    ),
  ]);
}

async function copyActiveCardImages(
  projectRoot: string,
  runtimeOutput: string,
  allowPrivateContent: boolean,
): Promise<void> {
  const imageSourceRoot = path.join(
    projectRoot,
    "generated/card-images/archive/full",
  );
  const imageOutputRoot = path.join(runtimeOutput, "images");
  const runtimeManifest = parseRuntimeSnapshotManifest(
    JSON.parse(
      await readFile(
        path.join(projectRoot, "generated/runtime/current/manifest.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const manifest = buildActiveImageManifest(
    projectRoot,
    runtimeManifest.snapshotId,
  );
  if (!manifest.redistributionApproved && !allowPrivateContent)
    throw new Error(
      "Card-image redistribution is not approved; use the explicit private build mode or package placeholders only",
    );
  if (!manifest.redistributionApproved)
    await writeFile(
      path.join(path.dirname(runtimeOutput), "PRIVATE_DEPLOYMENT_ONLY.txt"),
      "This artifact contains card images without approved redistribution posture. Keep it private.\n",
    );
  await rm(imageOutputRoot, { recursive: true, force: true });
  await mkdir(imageOutputRoot, { recursive: true });
  for (const file of manifest.files) {
    const source = resolveWithin(imageSourceRoot, file.path);
    await assertRealPathContained(imageSourceRoot, source);
    await copyFileWithParents(
      source,
      resolveWithin(imageOutputRoot, file.path),
    );
  }
  await writeFile(
    path.join(imageOutputRoot, "active-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function copySnapshotAssets(
  projectRoot: string,
  runtimeOutput: string,
): Promise<void> {
  const sourceRoot = path.join(projectRoot, "generated/assets/current");
  const destinationRoot = path.join(runtimeOutput, "assets/current");
  const runtimeManifest = parseRuntimeSnapshotManifest(
    JSON.parse(
      await readFile(
        path.join(projectRoot, "generated/runtime/current/manifest.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const activePaths = await resolveActiveRuntimeFiles(projectRoot);
  const declaredPaths = new Set(
    runtimeManifest.assets.files.map((file) => file.path),
  );
  const undeclared = activePaths.find((file) => !declaredPaths.has(file));
  if (undeclared !== undefined)
    throw new Error(`Active runtime file is not declared: ${undeclared}`);
  await rm(destinationRoot, { recursive: true, force: true });
  await Promise.all([
    copyFileWithParents(
      path.join(sourceRoot, "manifest.json"),
      path.join(destinationRoot, "manifest.json"),
    ),
    ...activePaths.map(async (relativePath) => {
      const source = resolveWithin(sourceRoot, relativePath);
      const destination = resolveWithin(destinationRoot, relativePath);
      await assertRealPathContained(sourceRoot, source);
      await copyFileWithParents(source, destination);
    }),
  ]);
}

async function copyThirdPartyLicenses(
  projectRoot: string,
  outputRoot: string,
): Promise<void> {
  const licenses = [
    ["node_modules/phaser/LICENSE.md", "phaser-MIT.txt"],
    ["node_modules/svelte/LICENSE.md", "svelte-MIT.txt"],
    ["node_modules/idb/LICENSE", "idb-ISC.txt"],
    ["vendor/ocgcore-wasm/0.1.2/LICENSE", "ocgcore-wasm-MIT.txt"],
  ] as const;
  await Promise.all(
    licenses.map(([source, destination]) =>
      copyFileWithParents(
        path.join(projectRoot, ...source.split("/")),
        path.join(outputRoot, "licenses", destination),
      ),
    ),
  );
}

async function copyFileWithParents(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

function runtimeSourcePath(
  projectRoot: string,
  runtimePath: string,
): string | null {
  const normalized = runtimePath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /[:%?#]/.test(normalized) ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  if (normalized === "current/manifest.json") {
    return path.join(projectRoot, "generated/runtime/current/manifest.json");
  }
  if (normalized === "engine/vendor-manifest.json") {
    return path.join(
      projectRoot,
      "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json",
    );
  }
  if (/^images\/\d+\.jpg$/.test(normalized)) {
    try {
      return resolveWithin(
        path.join(projectRoot, "generated/card-images/archive/full"),
        normalized.slice("images/".length),
      );
    } catch {
      return null;
    }
  }
  if (normalized === "engine/ocgcore.sync.wasm") {
    return path.join(
      projectRoot,
      "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
    );
  }
  const assetPrefix = "assets/current/";
  if (!normalized.startsWith(assetPrefix)) return null;
  try {
    return resolveWithin(
      path.join(projectRoot, "generated/assets/current"),
      normalized.slice(assetPrefix.length),
    );
  } catch {
    return null;
  }
}

function resolveWithin(root: string, relativePath: string): string {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes(":")
  ) {
    throw new Error(`Runtime path must be relative: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Runtime path escapes its root: ${relativePath}`);
  }
  return resolved;
}

async function assertRealPathContained(
  root: string,
  candidate: string,
): Promise<void> {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Runtime source resolves outside its root: ${candidate}`);
  }
}

function normalizedBase(base: string): string {
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".jpg")) return "image/jpeg";
  return "application/octet-stream";
}
