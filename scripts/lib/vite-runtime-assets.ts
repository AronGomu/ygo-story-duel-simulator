import { ASSET_SOURCES } from "./asset-roots.ts";
import { assertSafeParents } from "./asset-delivery/path-guards.ts";
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
import { parseRuntimeSnapshotManifest } from "../../src/battle/worker/assets/runtime-manifest.ts";
import { buildActiveImageManifest } from "./active-image-manifest.ts";
import type { SetImageManifest } from "./set-images.ts";
import { setImageFileName } from "./set-images.ts";

const RUNTIME_PREFIX = "runtime/";

export function browserRuntimeAssetsPlugin(projectRoot: string): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "ygo-browser-runtime-assets",
    configResolved(resolved) {
      config = resolved;
    },
    async configureServer(server) {
      await installRuntimeMiddleware(server, projectRoot);
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

async function installRuntimeMiddleware(
  server: ViteDevServer,
  projectRoot: string,
): Promise<void> {
  const manifest = parseRuntimeSnapshotManifest(
    JSON.parse(
      await readFile(
        path.join(projectRoot, ASSET_SOURCES.runtime.source, "manifest.json"),
        "utf8",
      ),
    ),
  );
  const snapshotFiles = new Set(
    snapshotCopyPaths(manifest).map((file) => `runtime/assets/current/${file}`),
  );
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
    if (
      relativeRequest.startsWith("runtime/assets/current/") &&
      !snapshotFiles.has(relativeRequest)
    ) {
      response.statusCode = 404;
      response.end("Runtime asset not found");
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
    void assertSafeParents(
      projectRoot,
      path.relative(projectRoot, source).replaceAll("\\", "/"),
    )
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
        const stream = createReadStream(source);
        stream.on("error", () => {
          response.statusCode = 404;
          response.end("Runtime asset not found");
        });
        stream.pipe(response);
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
      path.join(projectRoot, `${ASSET_SOURCES.runtime.source}/manifest.json`),
      path.join(runtimeOutput, "current/manifest.json"),
    ),
    copySnapshotAssets(projectRoot, runtimeOutput),
    copyActiveCardImages(projectRoot, runtimeOutput, allowPrivateContent),
    copySetImages(projectRoot, runtimeOutput),
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
  await copyCardBackImage(projectRoot, runtimeOutput);
}

/* The card back is acquired by `scripts/download-card-back.ts` into ignored
   canonical sources, so a tree that never ran it still builds and the duel field
   falls back to its drawn SVG back. It is copied after `copyActiveCardImages`
   because that step clears the image output root first. */
async function copyCardBackImage(
  projectRoot: string,
  runtimeOutput: string,
): Promise<void> {
  try {
    await copyFileWithParents(
      path.join(projectRoot, ASSET_SOURCES.cardBack.source),
      path.join(runtimeOutput, "images/card-back.jpg"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function copyActiveCardImages(
  projectRoot: string,
  runtimeOutput: string,
  allowPrivateContent: boolean,
): Promise<void> {
  const imageSourceRoot = path.join(
    projectRoot,
    ASSET_SOURCES.fullImages.source,
  );
  const imageOutputRoot = path.join(runtimeOutput, "images");
  const cropSourceRoot = path.join(
    projectRoot,
    ASSET_SOURCES.croppedImages.source,
  );
  const cropOutputRoot = path.join(runtimeOutput, "images-cropped");
  const runtimeManifest = parseRuntimeSnapshotManifest(
    JSON.parse(
      await readFile(
        path.join(projectRoot, `${ASSET_SOURCES.runtime.source}/manifest.json`),
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
  await Promise.all([
    rm(imageOutputRoot, { recursive: true, force: true }),
    rm(cropOutputRoot, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(imageOutputRoot, { recursive: true }),
    mkdir(cropOutputRoot, { recursive: true }),
  ]);
  for (const file of manifest.files) {
    const source = resolveWithin(imageSourceRoot, file.path);
    const cropSource = resolveWithin(cropSourceRoot, file.path);
    await Promise.all([
      assertRealPathContained(imageSourceRoot, source),
      assertRealPathContained(cropSourceRoot, cropSource),
    ]);
    await Promise.all([
      copyFileWithParents(source, resolveWithin(imageOutputRoot, file.path)),
      copyFileWithParents(cropSource, resolveWithin(cropOutputRoot, file.path)),
    ]);
  }
  await writeFile(
    path.join(imageOutputRoot, "active-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/* Shop set art, ADR-052. It is pinned by its own sha256 manifest and served
   as a plain static URL, so it is copied like card art rather than joining the
   duel's verified snapshot. An archive nobody has acquired yet leaves the shop
   tiles typographic instead of failing the build; `npm run assets:sets:verify`
   inside `assets:verify` is the gate that reports it. */
async function copySetImages(
  projectRoot: string,
  runtimeOutput: string,
): Promise<void> {
  const sourceRoot = path.join(projectRoot, ASSET_SOURCES.setImages.source);
  const manifest = await readSetImageManifest(sourceRoot);
  if (manifest === null) return;
  const outputRoot = path.join(runtimeOutput, "sets");
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  for (const record of manifest.files) {
    const fileName = setImageFileName(record.setId);
    const source = resolveWithin(sourceRoot, fileName);
    await assertRealPathContained(sourceRoot, source);
    await copyFileWithParents(source, resolveWithin(outputRoot, fileName));
  }
}

async function readSetImageManifest(
  sourceRoot: string,
): Promise<SetImageManifest | null> {
  try {
    return JSON.parse(
      await readFile(path.join(sourceRoot, "manifest.json"), "utf8"),
    ) as SetImageManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Full snapshot (2026-08-20): ~45 MB across 451 declared files. Editor offers all 14,794 cards → duel must load any.
export function snapshotCopyPaths(manifest: {
  readonly assets: { readonly files: readonly { readonly path: string }[] };
}): readonly string[] {
  return [
    ...new Set(["manifest.json", ...manifest.assets.files.map((f) => f.path)]),
  ].sort();
}

async function copySnapshotAssets(
  projectRoot: string,
  runtimeOutput: string,
): Promise<void> {
  const sourceRoot = path.join(projectRoot, ASSET_SOURCES.data.source);
  const destinationRoot = path.join(runtimeOutput, "assets/current");
  const runtimeManifest = parseRuntimeSnapshotManifest(
    JSON.parse(
      await readFile(
        path.join(projectRoot, `${ASSET_SOURCES.runtime.source}/manifest.json`),
        "utf8",
      ),
    ) as unknown,
  );
  const paths = snapshotCopyPaths(runtimeManifest);
  await rm(destinationRoot, { recursive: true, force: true });
  for (let i = 0; i < paths.length; i += 32) {
    await Promise.all(
      paths.slice(i, i + 32).map(async (relativePath) => {
        const source = resolveWithin(sourceRoot, relativePath);
        const destination = resolveWithin(destinationRoot, relativePath);
        await assertRealPathContained(sourceRoot, source);
        await copyFileWithParents(source, destination);
      }),
    );
  }
}

async function copyThirdPartyLicenses(
  projectRoot: string,
  outputRoot: string,
): Promise<void> {
  const licenses = [
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

export function runtimeSourcePath(
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
    return path.join(
      projectRoot,
      `${ASSET_SOURCES.runtime.source}/manifest.json`,
    );
  }
  if (normalized === "engine/vendor-manifest.json") {
    return path.join(
      projectRoot,
      "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json",
    );
  }
  if (normalized === "images/card-back.jpg") {
    return path.join(projectRoot, ASSET_SOURCES.cardBack.source);
  }
  if (/^images\/\d+\.jpg$/.test(normalized)) {
    try {
      return resolveWithin(
        path.join(projectRoot, ASSET_SOURCES.fullImages.source),
        normalized.slice("images/".length),
      );
    } catch {
      return null;
    }
  }
  if (/^images-cropped\/\d+\.jpg$/.test(normalized)) {
    try {
      return resolveWithin(
        path.join(projectRoot, ASSET_SOURCES.croppedImages.source),
        normalized.slice("images-cropped/".length),
      );
    } catch {
      return null;
    }
  }
  if (/^sets\/[A-Za-z0-9_-]+\.jpg$/.test(normalized)) {
    try {
      return resolveWithin(
        path.join(projectRoot, ASSET_SOURCES.setImages.source),
        normalized.slice("sets/".length),
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
      path.join(projectRoot, ASSET_SOURCES.data.source),
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
