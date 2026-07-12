import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceDirectoryRecoverably, writeJson } from "./lib/files.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import { acquireRunLock } from "./lib/run-lock.ts";
import { readTarFiles } from "./lib/tar.ts";

const PACKAGE_NAME = "ocgcore-wasm";
const PACKAGE_VERSION = "0.1.2";
const PACKAGE_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
const PACKAGE_INTEGRITY = "sha512-Zgjx2xIf2RJf1gjvHGR8lvcLRfw54Cq48QFMOrOxtt3SeAf+/h58IbVNoYpZbK7O5O23GCwLeNqS4T6zODHpWA==";
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_PACKAGE_BYTES = 50 * 1024 * 1024;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const offline = parseOptions(process.argv.slice(2));
const cacheRoot = resolveProjectSubpath(
  projectRoot,
  ".cache/upstream/npm",
  ".cache",
  "engine package cache",
);
const output = resolveProjectSubpath(
  projectRoot,
  "generated/engine/current",
  "generated/engine",
  "engine output",
);
const packagePath = path.join(cacheRoot, `${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`);
const staging = `${output}.staging-${process.pid}`;
const releaseRunLock = await acquireRunLock(
  path.join(projectRoot, "generated", ".locks", "engine-sync"),
);

try {
  await mkdir(cacheRoot, { recursive: true });
  let packageBytes = await readValidCachedPackage(packagePath);
  if (!packageBytes) {
    if (offline) throw new Error(`Offline engine package cache is missing or invalid: ${packagePath}`);
    emit("download", "start", { package: PACKAGE_NAME, version: PACKAGE_VERSION });
    const response = await fetch(PACKAGE_URL, {
      headers: { "user-agent": "YGO-Story-Duel-Simulator/0.1 asset importer" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Engine package download failed: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PACKAGE_BYTES) throw new Error("Engine package exceeds size limit");
    packageBytes = new Uint8Array(await response.arrayBuffer());
    validatePackage(packageBytes);
    const temporary = `${packagePath}.tmp-${process.pid}`;
    await writeFile(temporary, packageBytes);
    await rm(packagePath, { force: true });
    await rename(temporary, packagePath);
    emit("download", "ok", { bytes: packageBytes.byteLength });
  } else {
    emit("cache", "ok", { package: PACKAGE_NAME, version: PACKAGE_VERSION });
  }

  const files = readTarFiles(
    gunzipSync(packageBytes, { maxOutputLength: MAX_EXPANDED_PACKAGE_BYTES }),
    "package/",
  );
  await rm(staging, { recursive: true, force: true });
  for (const file of files) {
    const destination = path.join(staging, ...file.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes);
  }

  const packageJson = JSON.parse(
    await readFile(path.join(staging, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  if (packageJson.name !== PACKAGE_NAME || packageJson.version !== PACKAGE_VERSION) {
    throw new Error("Engine package identity does not match the pinned package");
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    source: PACKAGE_URL,
    integrity: PACKAGE_INTEGRITY,
    files: files
      .map((file) => ({
        path: file.path,
        bytes: file.bytes.byteLength,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  await writeJson(path.join(staging, "engine-manifest.json"), manifest);
  await replaceDirectoryRecoverably(staging, output);
  console.log(
    JSON.stringify(
      { status: "ok", package: PACKAGE_NAME, version: PACKAGE_VERSION, files: files.length, output },
      null,
      2,
    ),
  );
} finally {
  await rm(staging, { recursive: true, force: true });
  await releaseRunLock();
}

function parseOptions(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--offline") return true;
  throw new Error(`Unknown engine sync arguments: ${args.join(" ")}`);
}

async function readValidCachedPackage(filePath: string): Promise<Uint8Array | null> {
  try {
    const bytes = new Uint8Array(await readFile(filePath));
    validatePackage(bytes);
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (offline) throw error;
    return null;
  }
}

function validatePackage(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error(`Invalid engine package size: ${bytes.byteLength}`);
  }
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== PACKAGE_INTEGRITY) throw new Error("Engine package integrity mismatch");
}

function emit(stage: string, status: string, detail: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), operation: "engineSync", stage, status, ...detail })}\n`,
  );
}
