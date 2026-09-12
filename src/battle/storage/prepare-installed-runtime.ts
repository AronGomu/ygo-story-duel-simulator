import { FROZEN_VENDOR_MANIFEST_SHA256 } from "./frozen-vendor-pin.ts";
import type {
  ContentReadPort,
  ContentResult,
  InstalledRuntimeReceipt,
  ManifestRef,
  RuntimeReceiptFile,
  RuntimeSnapshotRef,
} from "../../content/index.ts";
import { verifyDigest } from "../../decks/catalog/snapshot-digest.ts";
import { parseRuntimeSnapshotManifest } from "../worker/assets/runtime-manifest.ts";
import { verifyRuntimeSupport } from "./verify-runtime-support.ts";
import { writeInstalledRuntimeReceipt } from "./installed-runtime-receipt.ts";

export async function prepareInstalledRuntime(
  ref: RuntimeSnapshotRef,
  runtime: ManifestRef,
  reader: ContentReadPort,
): Promise<ContentResult<RuntimeSnapshotRef>> {
  const fail = () => ({
    kind: "failed" as const,
    code: "CONTENT_INTEGRITY_FAILED" as const,
    packId: null,
    path: null,
  });
  try {
    const pack = await reader.readManifest(runtime);
    if (pack.kind === "failed") return pack;
    const catalog = await reader.readCatalog(ref.releaseCatalogSha256);
    if (catalog.kind === "failed") return catalog;
    if (
      catalog.value.value.runtime.sha256 !== runtime.sha256 ||
      catalog.value.value.runtime.bytes !== runtime.bytes ||
      catalog.value.value.runtimeSnapshotId !== ref.runtimeSnapshotId ||
      pack.value.value.runtimeSnapshotId !== ref.runtimeSnapshotId
    )
      return fail();
    const read = async (path: string): Promise<Uint8Array> => {
      if (!pack.value.value.files.some((file) => file.path === path))
        throw fail();
      const file = await reader.readFile(runtime, path);
      if (file.kind === "failed") throw file;
      return new Uint8Array(await file.value.arrayBuffer());
    };
    const parse = (bytes: Uint8Array): unknown =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const receiptFile = (path: string): RuntimeReceiptFile => {
      const file = pack.value.value.files.find((f) => f.path === path);
      if (!file) throw fail();
      return { path, bytes: file.bytes, sha256: file.sha256 };
    };
    const runtimeManifestFile = receiptFile("runtime/current/manifest.json");
    const assetManifestFile = receiptFile(
      "runtime/assets/current/manifest.json",
    );
    const engineManifestFile = receiptFile(
      "runtime/engine/vendor-manifest.json",
    );
    const raw = await read(runtimeManifestFile.path);
    await verifyDigest("runtime", raw, ref.runtimeManifestSha256);
    const manifest = parseRuntimeSnapshotManifest(parse(raw));
    if (
      manifest.snapshotId !== ref.runtimeSnapshotId ||
      manifest.assets.manifestSha256 !== assetManifestFile.sha256 ||
      manifest.engine.manifestSha256 !== engineManifestFile.sha256
    )
      return fail();
    if (engineManifestFile.sha256 !== FROZEN_VENDOR_MANIFEST_SHA256)
      return fail();
    const vendorBytes = await read(engineManifestFile.path);
    await verifyDigest(
      "frozen vendor",
      vendorBytes,
      FROZEN_VENDOR_MANIFEST_SHA256,
    );
    const vendor = parse(vendorBytes) as {
      integrity: string;
      embeddedCoreRevision: string;
      coreVersion: number[];
      files: RuntimeReceiptFile[];
    };
    if (
      manifest.engine.integrity !== vendor.integrity ||
      manifest.engine.embeddedCoreRevision !== vendor.embeddedCoreRevision ||
      JSON.stringify(manifest.engine.coreVersion) !==
        JSON.stringify(vendor.coreVersion)
    )
      return fail();
    const assetBytes = await read(assetManifestFile.path);
    await verifyDigest("assets", assetBytes, manifest.assets.manifestSha256);
    const assets = parse(assetBytes) as {
      schemaVersion: number;
      sources: {
        babelCdb: { commit: string };
        cardScripts: { commit: string };
        distribution: { commit: string };
      };
      files: RuntimeReceiptFile[];
    };
    if (
      assets.schemaVersion !== 1 ||
      assets.files.length !== manifest.assets.files.length ||
      assets.files.some(
        (f, i) =>
          f.path !== manifest.assets.files[i]?.path ||
          f.bytes !== manifest.assets.files[i]?.bytes ||
          f.sha256 !== manifest.assets.files[i]?.sha256,
      ) ||
      assets.sources.babelCdb.commit !== manifest.assets.babelCdbRevision ||
      assets.sources.cardScripts.commit !==
        manifest.assets.cardScriptsRevision ||
      assets.sources.distribution.commit !==
        manifest.assets.distributionRevision
    )
      return fail();
    const contentHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: assets.schemaVersion,
          sources: assets.sources,
          files: assets.files,
        }),
      ),
    );
    const assetContentSha256 = Array.from(new Uint8Array(contentHash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await verifyDigest(
      "snapshot",
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          assetContentSha256,
          engineManifestSha256: engineManifestFile.sha256,
        }),
      ),
      ref.runtimeSnapshotId,
    );
    for (const file of manifest.assets.files) {
      const declared = receiptFile(`runtime/assets/current/${file.path}`);
      if (declared.bytes !== file.bytes || declared.sha256 !== file.sha256)
        return fail();
      await verifyDigest("asset", await read(declared.path), file.sha256);
    }
    const wasm = vendor.files.find((f) => f.path === "lib/ocgcore.sync.wasm");
    const declaredWasm = receiptFile("runtime/engine/ocgcore.sync.wasm");
    if (
      !wasm ||
      wasm.bytes !== declaredWasm.bytes ||
      wasm.sha256 !== declaredWasm.sha256
    )
      return fail();
    await verifyDigest("wasm", await read(declaredWasm.path), wasm.sha256);
    await verifyRuntimeSupport(
      {
        async readJson<T>(path: string): Promise<T> {
          return parse(await read(`runtime/assets/current/${path}`)) as T;
        },
      },
      pack.value.value.cardCodes,
    );
    const receipt: InstalledRuntimeReceipt = {
      schemaVersion: 1,
      kind: "installed-runtime-v1",
      snapshot: ref,
      runtimePack: runtime,
      runtimeManifestFile,
      assetManifestFile,
      engineManifestFile,
      verifiedAt: Date.now(),
    };
    const persisted = await writeInstalledRuntimeReceipt(receipt);
    return persisted.kind === "failed" ? persisted : { kind: "ok", value: ref };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "kind" in error &&
      error.kind === "failed"
    )
      return error as ContentResult<RuntimeSnapshotRef>;
    return fail();
  }
}
