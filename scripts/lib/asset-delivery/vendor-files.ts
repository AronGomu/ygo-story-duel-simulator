import { fileURLToPath } from "node:url";
import { digestSource, readSourceJson, sameDigest } from "./source-files.ts";
import { parseFileDigests, type FileDigest } from "./file-digest.ts";
import { fail } from "./failure.ts";

/** Player producer copies only frozen WASM/manifest; dev sources never own vendor. */
export async function scanVendorFiles(
  root: string,
): Promise<readonly FileDigest[]> {
  const prefix = "vendor/ocgcore-wasm/0.1.2/";
  const manifestPath = `${prefix}vendor-manifest.json`;
  const manifest = await digestSource(root, manifestPath);
  const trustedRoot = fileURLToPath(new URL("../../../", import.meta.url));
  if (!sameDigest(manifest, await digestSource(trustedRoot, manifestPath)))
    fail("ASSET_INTEGRITY_FAILED", manifestPath);
  const value = (await readSourceJson(root, manifestPath)) as Record<
    string,
    unknown
  > | null;
  if (
    value?.schemaVersion !== 1 ||
    value.package !== "ocgcore-wasm" ||
    value.version !== "0.1.2"
  )
    fail("ASSET_INTEGRITY_FAILED", manifestPath);
  const files = parseFileDigests(value.files);
  const expected = files.find((f) => f.path === "lib/ocgcore.sync.wasm");
  const wasm = await digestSource(root, `${prefix}lib/ocgcore.sync.wasm`);
  if (!expected || !sameDigest(wasm, expected))
    fail("ASSET_INTEGRITY_FAILED", wasm.path);
  if (!sameDigest(manifest, await digestSource(root, manifestPath)))
    fail("ASSET_SOURCE_CHANGED", manifestPath);
  return [wasm, manifest];
}
