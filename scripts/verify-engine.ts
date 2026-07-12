import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectSubpath } from "./lib/paths.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const root = resolveProjectSubpath(
  projectRoot,
  "generated/engine/current",
  "generated/engine",
  "engine output",
);
const manifest = JSON.parse(
  await readFile(path.join(root, "engine-manifest.json"), "utf8"),
) as {
  schemaVersion: number;
  package: string;
  version: string;
  integrity: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};
const failures: string[] = [];
const required = [
  "package.json",
  "lib/ocgcore.sync.wasm",
  "lib/ocgcore.sync.mjs",
  "dist/index.js",
  "dist/index.d.ts",
];
const declared = new Set(manifest.files.map((file) => file.path));

if (manifest.schemaVersion !== 1) failures.push(`Unsupported schema: ${manifest.schemaVersion}`);
if (manifest.package !== "ocgcore-wasm" || manifest.version !== "0.1.2") {
  failures.push(`Unexpected engine package: ${manifest.package}@${manifest.version}`);
}
for (const requiredPath of required) {
  if (!declared.has(requiredPath)) failures.push(`Missing required engine file: ${requiredPath}`);
}
for (const file of manifest.files) {
  const filePath = path.join(root, ...file.path.split("/"));
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size !== file.bytes) {
      failures.push(`Engine file size mismatch: ${file.path}`);
      continue;
    }
    const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
    if (digest !== file.sha256) failures.push(`Engine file hash mismatch: ${file.path}`);
  } catch (error) {
    failures.push(`Cannot read engine file ${file.path}: ${(error as Error).message}`);
  }
}

const wasmPath = path.join(root, "lib", "ocgcore.sync.wasm");
try {
  const wasm = await readFile(wasmPath);
  if (
    wasm.length < 8 ||
    wasm[0] !== 0x00 ||
    wasm[1] !== 0x61 ||
    wasm[2] !== 0x73 ||
    wasm[3] !== 0x6d
  ) {
    failures.push("ocgcore.sync.wasm has an invalid WebAssembly header");
  }
} catch {
  // The missing file is already reported above.
}

const result = {
  status: failures.length ? "failed" : "ok",
  package: `${manifest.package}@${manifest.version}`,
  files: manifest.files.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
