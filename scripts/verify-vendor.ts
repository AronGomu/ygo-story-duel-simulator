import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles } from "./lib/files.ts";

interface VendorManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface VendorManifest {
  schemaVersion: number;
  package: string;
  version: string;
  integrity: string;
  localPatches: string[];
  files: VendorManifestFile[];
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vendorRoot = path.join(projectRoot, "vendor", "ocgcore-wasm", "0.1.2");
const manifestPath = path.join(vendorRoot, "vendor-manifest.json");
const manifest = JSON.parse(
  await readFile(manifestPath, "utf8"),
) as VendorManifest;
const failures: string[] = [];

if (manifest.schemaVersion !== 1)
  failures.push(`Unsupported schema ${manifest.schemaVersion}`);
if (manifest.package !== "ocgcore-wasm" || manifest.version !== "0.1.2") {
  failures.push(
    `Unexpected package identity ${manifest.package}@${manifest.version}`,
  );
}
if (!manifest.integrity.startsWith("sha512-"))
  failures.push("Missing npm SHA-512 integrity");

const expected = new Map(manifest.files.map((file) => [file.path, file]));
const actual = (await listFiles(vendorRoot))
  .map((file) => path.relative(vendorRoot, file).replaceAll(path.sep, "/"))
  .filter((file) => file !== "vendor-manifest.json");

for (const relativePath of actual) {
  if (!expected.has(relativePath))
    failures.push(`Unmanifested vendor file: ${relativePath}`);
}
for (const [relativePath, expectedFile] of expected) {
  const absolutePath = path.join(vendorRoot, ...relativePath.split("/"));
  try {
    const metadata = await stat(absolutePath);
    if (metadata.size !== expectedFile.bytes) {
      failures.push(
        `${relativePath}: expected ${expectedFile.bytes} bytes, found ${metadata.size}`,
      );
      continue;
    }
    const digest = createHash("sha256")
      .update(await readFile(absolutePath))
      .digest("hex");
    if (digest !== expectedFile.sha256)
      failures.push(`${relativePath}: SHA-256 mismatch`);
  } catch (error) {
    failures.push(`${relativePath}: ${(error as Error).message}`);
  }
}

const forbiddenFiles = ["lib/ocgcore.jspi.mjs", "lib/ocgcore.jspi.wasm"];
for (const forbidden of forbiddenFiles) {
  if (expected.has(forbidden))
    failures.push(`Asynchronous engine payload is forbidden: ${forbidden}`);
}
for (const required of [
  "LICENSE",
  "README.md",
  "VENDORING.md",
  "package.json",
  "dist/index.d.ts",
  "dist/index.js",
  "lib/ocgcore.sync.mjs",
  "lib/ocgcore.sync.wasm",
]) {
  if (!expected.has(required))
    failures.push(`Required vendor file is missing: ${required}`);
}

if (failures.length > 0) {
  console.error(
    JSON.stringify({ status: "failed", vendorRoot, failures }, null, 2),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: "ok",
        package: manifest.package,
        version: manifest.version,
        files: actual.length,
      },
      null,
      2,
    ),
  );
}
