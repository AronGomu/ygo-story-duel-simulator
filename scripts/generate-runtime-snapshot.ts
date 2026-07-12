import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntimeSnapshotManifest } from "../src/worker/assets/runtime-snapshot-node.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const assetRoot = path.join(projectRoot, "generated", "assets", "current");
const vendorRoot = path.join(projectRoot, "vendor", "ocgcore-wasm", "0.1.2");
const outputRoot = path.join(projectRoot, "generated", "runtime", "current");
const manifest = await buildRuntimeSnapshotManifest(assetRoot, vendorRoot);
await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    { status: "ok", snapshotId: manifest.snapshotId, outputRoot },
    null,
    2,
  ),
);
