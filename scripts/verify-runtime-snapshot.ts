import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeSnapshotManifest,
  verifyRuntimeSnapshotFiles,
} from "../src/worker/assets/runtime-snapshot-node.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const assetRoot = path.join(projectRoot, "generated", "assets", "current");
const vendorRoot = path.join(projectRoot, "vendor", "ocgcore-wasm", "0.1.2");
const manifest = await buildRuntimeSnapshotManifest(assetRoot, vendorRoot);
await verifyRuntimeSnapshotFiles(manifest, assetRoot);
console.log(
  JSON.stringify({ status: "ok", snapshotId: manifest.snapshotId }, null, 2),
);
