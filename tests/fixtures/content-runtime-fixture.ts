import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ChapterCard, ContentMediaType } from "../../src/content/index.ts";

export interface ContentRuntimeFixtureOptions {
  readonly indexedScript?: boolean;
  readonly omitScript?: boolean;
  readonly omitImages?: boolean;
  readonly omitGlobal?: boolean;
  readonly globals?: Readonly<Record<string, unknown>>;
  readonly globalIndex?: readonly string[];
}
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Parser-valid runtime with the actual frozen vendor/WASM, not a receipt mock. */
export async function contentRuntimeFixture(
  cards: readonly ChapterCard[],
  options: ContentRuntimeFixtureOptions,
) {
  const assets = new Map<string, Uint8Array>();
  for (const card of cards) {
    const shard = (card.code % 64).toString(16).padStart(2, "0");
    assets.set(`catalog/cards/${shard}.json`, encode([card.record]));
    assets.set(`catalog/texts/en/${shard}.json`, encode([card.text]));
    assets.set(
      `images/${shard}.json`,
      encode(
        options.omitImages
          ? []
          : [
              {
                code: card.code,
                full: "https://fixture.invalid/full.jpg",
                cropped: "https://fixture.invalid/cropped.jpg",
              },
            ],
      ),
    );
  }
  assets.set(
    "scripts/index.json",
    encode({
      official: options.indexedScript ? ["c1.lua"] : [],
      preRelease: [],
      globals: options.globalIndex ?? ["constant.lua", "utility.lua"],
      shardCount: 256,
    }),
  );
  assets.set(
    "scripts/globals.json",
    encode(
      options.globals ??
        (options.omitGlobal
          ? {}
          : {
              "constant.lua": "-- fixture constants",
              "utility.lua": "-- fixture utilities",
            }),
    ),
  );
  if (options.indexedScript && !options.omitScript)
    assets.set(
      "scripts/cards/01.json",
      encode({ "c1.lua": "-- fixture script" }),
    );
  assets.set(
    "strings/en.json",
    encode({ system: {}, victory: {}, counter: {}, setname: {} }),
  );
  const files = [...assets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: sha(bytes),
    }));
  const sources = {
    babelCdb: { commit: "fixture" },
    cardScripts: { commit: "fixture" },
    distribution: { commit: "fixture" },
  };
  const assetManifest = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources,
    files,
  };
  const assetBytes = encode(assetManifest);
  const vendorBytes = new Uint8Array(
    await readFile("vendor/ocgcore-wasm/0.1.2/vendor-manifest.json"),
  );
  const vendor = JSON.parse(new TextDecoder().decode(vendorBytes));
  const engineManifestSha256 = sha(vendorBytes);
  const assetContentSha256 = sha(encode({ schemaVersion: 1, sources, files }));
  const snapshotId = sha(
    encode({ schemaVersion: 1, assetContentSha256, engineManifestSha256 }),
  );
  const runtimeRaw = encode({
    schemaVersion: 1,
    generatedAt: assetManifest.generatedAt,
    snapshotId,
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: vendor.integrity,
      coreVersion: vendor.coreVersion,
      embeddedCoreRevision: vendor.embeddedCoreRevision,
      manifestSha256: engineManifestSha256,
    },
    assets: {
      manifestSha256: sha(assetBytes),
      babelCdbRevision: "fixture",
      cardScriptsRevision: "fixture",
      distributionRevision: "fixture",
      files,
    },
  });
  const payload: {
    path: string;
    bytes: Uint8Array;
    mediaType: ContentMediaType;
  }[] = [
    ...[...assets].map(([path, bytes]) => ({
      path: `runtime/assets/current/${path}`,
      bytes,
      mediaType: "application/json" as const,
    })),
    {
      path: "runtime/assets/current/manifest.json",
      bytes: assetBytes,
      mediaType: "application/json",
    },
    {
      path: "runtime/current/manifest.json",
      bytes: runtimeRaw,
      mediaType: "application/json",
    },
    {
      path: "runtime/engine/vendor-manifest.json",
      bytes: vendorBytes,
      mediaType: "application/json",
    },
    {
      path: "runtime/engine/ocgcore.sync.wasm",
      bytes: new Uint8Array(
        await readFile("vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm"),
      ),
      mediaType: "application/wasm",
    },
  ];
  return { snapshotId, runtimeRaw, files: payload };
}
