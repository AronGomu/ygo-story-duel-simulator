import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parseRuntimeSnapshotManifest } from "../src/worker/assets/runtime-manifest.ts";
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
const publishedManifest = parseRuntimeSnapshotManifest(
  JSON.parse(
    await readFile(
      path.join(
        projectRoot,
        "generated",
        "runtime",
        "current",
        "manifest.json",
      ),
      "utf8",
    ),
  ) as unknown,
);
if (!isDeepStrictEqual(publishedManifest, manifest)) {
  throw new Error(
    "Published runtime manifest does not match the independently derived snapshot",
  );
}
await verifyRuntimeSnapshotFiles(manifest, assetRoot);
console.log(
  JSON.stringify({ status: "ok", snapshotId: manifest.snapshotId }, null, 2),
);
