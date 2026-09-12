import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimeSnapshotManifest } from "../../src/battle/worker/assets/runtime-snapshot-node.ts";
import { contentDigest, contentSetupFixture } from "./content-setup.ts";
import { DECK_CATALOG } from "../../src/battle/duel/presets/deck-catalog.ts";

/** Complete lawful runtime inputs; caller owns scratch root cleanup. */
export async function contentSetupFilesFixture(root: string) {
  const input = contentSetupFixture();
  const put = async (relative: string, bytes: string | Uint8Array) => {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  };
  const putJson = (relative: string, value: unknown) =>
    put(relative, JSON.stringify(value));
  const persistInputs = async () => {
    await put("content/authoring/card-set-source.json", input.source);
    await putJson("content/chapter-selections.json", input.selections);
    await putJson("content/authoring/chapter-policy.json", input.chapterPolicy);
    await putJson("content/distribution-evidence.json", input.distribution);
  };
  await persistInputs();
  const vendorRoot = "vendor/ocgcore-wasm/0.1.2";
  const vendorBytes = await readFile(`${vendorRoot}/vendor-manifest.json`);
  const vendor = JSON.parse(vendorBytes.toString("utf8"));
  await put(`${vendorRoot}/vendor-manifest.json`, vendorBytes);
  for (const file of vendor.files)
    await put(
      `${vendorRoot}/${file.path}`,
      await readFile(`${vendorRoot}/${file.path}`),
    );
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const putAsset = async (relative: string, value: unknown) => {
    const bytes = JSON.stringify(value);
    await put(`${ASSET_SOURCES.data.source}/${relative}`, bytes);
    const entry = {
      path: relative,
      bytes: Buffer.byteLength(bytes),
      sha256: contentDigest(bytes),
    };
    const index = files.findIndex((file) => file.path === relative);
    if (index === -1) files.push(entry);
    else files[index] = entry;
  };
  for (let shard = 0; shard < 64; shard++) {
    const name = shard.toString(16).padStart(2, "0");
    const codes = [1, 2, 3, 4, 5, 6].filter((code) => code % 64 === shard);
    await putAsset(
      `catalog/cards/${name}.json`,
      codes.map((code) => ({
        code,
        alias: 0,
        setcodes: [],
        type: 17,
        level: 4,
        attribute: 1,
        race: "1",
        attack: 1000,
        defense: 1000,
        lscale: 0,
        rscale: 0,
        linkMarker: 0,
        ot: 2,
        category: 0,
      })),
    );
    await putAsset(
      `catalog/texts/en/${name}.json`,
      codes.map((code) => ({
        code,
        name: `Synthetic card ${code}`,
        description: "Lawful fixture",
        strings: [],
      })),
    );
    await putAsset(
      `images/${name}.json`,
      codes.map((code) => ({
        code,
        full: `https://example.invalid/full/${code}.jpg`,
        cropped: `https://example.invalid/cropped/${code}.jpg`,
      })),
    );
  }
  await putAsset("scripts/index.json", {
    official: ["c1.lua"],
    preRelease: [],
    globals: ["constant.lua", "utility.lua"],
    shardCount: 256,
  });
  await putAsset("scripts/globals.json", {
    "constant.lua": "-- Lawful synthetic fixture\nreturn",
    "utility.lua": "-- Lawful synthetic fixture\nreturn",
  });
  for (let shard = 0; shard < 256; shard++)
    await putAsset(
      `scripts/cards/${shard.toString(16).padStart(2, "0")}.json`,
      shard === 1 ? { "c1.lua": "-- Lawful synthetic fixture\nreturn" } : {},
    );
  await putAsset("strings/en.json", {
    system: {},
    victory: {},
    counter: {},
    setname: {},
  });
  const assetManifest = {
    schemaVersion: 1,
    generatedAt: "2026-09-07T00:00:00Z",
    sources: {
      babelCdb: { commit: "fixture-db" },
      cardScripts: { commit: "fixture-scripts" },
      distribution: { commit: "fixture-distribution" },
    },
    files,
  };
  const publishRuntimeManifest = async () => {
    await putJson(`${ASSET_SOURCES.data.source}/manifest.json`, assetManifest);
    const runtime = await buildRuntimeSnapshotManifest(
      path.join(root, ASSET_SOURCES.data.source),
      path.join(root, "vendor/ocgcore-wasm/0.1.2"),
    );
    await putJson(`${ASSET_SOURCES.runtime.source}/manifest.json`, runtime);
    return runtime;
  };
  await publishRuntimeManifest();
  const jpeg = Buffer.alloc(1000);
  jpeg.set([0xff, 0xd8], 0);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  for (let code = 1; code <= 6; code++) {
    for (const kind of ["full", "cropped"])
      await put(
        `${path.posix.dirname(ASSET_SOURCES.fullImages.source)}/${kind}/${code}.jpg`,
        jpeg,
      );
  }
  await putJson("public/story/shop-sets.v1.json", {
    sets: input.selections.chapters.map(({ id }) => ({ id, name: id })),
  });
  const setManifest = {
    schemaVersion: 1,
    files: input.selections.chapters.map(({ id }) => ({
      setId: id,
      bytes: jpeg.length,
      sha256: contentDigest(jpeg),
    })),
  };
  await putJson(`${ASSET_SOURCES.setImages.source}/manifest.json`, setManifest);
  for (const { id } of input.selections.chapters)
    await put(`${ASSET_SOURCES.setImages.source}/${id}.jpg`, jpeg);
  for (const relative of [
    "src/story/content/prologue.ts",
    `${ASSET_SOURCES.story.source}/chapter-01/city-map-placeholder.svg`,
  ])
    await put(relative, "Lawful synthetic fixture; not production media.");
  for (const relative of [
    ...DECK_CATALOG.map(
      ({ fileName }) => `src/battle/duel/presets/decks/${fileName}`,
    ),
    "src/decks/chapter-one-starter.ydk",
  ])
    await put(relative, `#main\n${"1\n".repeat(40)}#extra\n!side\n`);
  return {
    root,
    input,
    put,
    putJson,
    persistInputs,
    putAsset,
    publishRuntimeManifest,
    assetManifest,
    setManifest,
  };
}
