import { link, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectContentSetup } from "../../scripts/lib/content-setup-files.ts";
import { loadBrowserRuntimeAssets } from "../../src/battle/worker/assets/browser-runtime-assets.ts";
import { buildRuntimeSnapshotManifest } from "../../src/battle/worker/assets/runtime-snapshot-node.ts";
import { createFetchShardReader } from "../../src/decks/catalog/runtime-catalog.ts";
import { contentSetupFilesFixture } from "../fixtures/content-setup-files.ts";
import { bindContentSource, contentDigest } from "../fixtures/content-setup.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(path.resolve(".tmp/content-setup-runtime-"));
  roots.push(root);
  return contentSetupFilesFixture(root);
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const assetRoot = "generated/assets/current";
const runtimePath = "generated/runtime/current/manifest.json";
const vendorRoot = "vendor/ocgcore-wasm/0.1.2";
const mib = 1024 * 1024;

async function browserFixture(input: Fixture) {
  const bytes = await readFile(path.join(input.root, runtimePath));
  const manifest = JSON.parse(bytes.toString("utf8"));
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = new URL(
      request instanceof Request ? request.url : String(request),
    );
    const relative = url.pathname.slice("/runtime/".length);
    const file =
      relative === "current/manifest.json"
        ? runtimePath
        : relative === "engine/vendor-manifest.json"
          ? `${vendorRoot}/vendor-manifest.json`
          : relative === "engine/ocgcore.sync.wasm"
            ? `${vendorRoot}/lib/ocgcore.sync.wasm`
            : relative.startsWith("assets/current/")
              ? `generated/${relative}`
              : null;
    if (url.origin !== "https://example.invalid" || file === null)
      return new Response("missing", { status: 404 });
    return new Response(
      Uint8Array.from(await readFile(path.join(input.root, file))).buffer,
    );
  };
  const pin = {
    expectedManifestSha256: contentDigest(bytes),
    expectedSnapshotId: manifest.snapshotId as string,
  };
  return {
    fetch,
    pin,
    load: () =>
      loadBrowserRuntimeAssets("https://example.invalid/", {
        fetch,
        expectedManifestSha256: pin.expectedManifestSha256,
      }),
  };
}

async function padManifest(input: Fixture, relative: string, size: number) {
  const bytes = await readFile(path.join(input.root, relative));
  await input.put(
    relative,
    Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 0x20)]),
  );
  if (relative !== runtimePath) {
    const runtime = await buildRuntimeSnapshotManifest(
      path.join(input.root, assetRoot),
      path.join(input.root, vendorRoot),
    );
    await input.putJson(runtimePath, runtime);
  }
}

async function padAggregate(input: Fixture, total: number) {
  let remaining =
    total -
    input.assetManifest.files.reduce((sum, file) => sum + file.bytes, 0);
  const full = Buffer.alloc(16 * mib);
  const fullDigest = contentDigest(full);
  let index = 0;
  while (remaining > 0) {
    const bytes = Math.min(remaining, full.length);
    const relative = `support/padding-${index}.bin`;
    if (index > 0 && bytes === full.length)
      await link(
        path.join(input.root, assetRoot, "support/padding-0.bin"),
        path.join(input.root, assetRoot, relative),
      );
    else await input.put(`${assetRoot}/${relative}`, full.subarray(0, bytes));
    input.assetManifest.files.push({
      path: relative,
      bytes,
      sha256:
        bytes === full.length
          ? fullDigest
          : contentDigest(full.subarray(0, bytes)),
    });
    remaining -= bytes;
    index++;
  }
  await input.publishRuntimeManifest();
}

async function addCard(
  input: Fixture,
  code: number,
  fields: Record<string, unknown> = {},
) {
  const shard = (code % 64).toString(16).padStart(2, "0");
  const original = JSON.parse(
    await readFile(
      path.join(input.root, assetRoot, "catalog/cards/01.json"),
      "utf8",
    ),
  )[0];
  for (const [directory, card] of [
    ["catalog/cards", { ...original, code, ...fields }],
    [
      "catalog/texts/en",
      { code, name: "Synthetic ABI card", description: "", strings: [] },
    ],
    ["images", { code, full: `${code}.jpg`, cropped: `${code}.jpg` }],
  ] as const) {
    const relative = `${directory}/${shard}.json`;
    const records = JSON.parse(
      await readFile(path.join(input.root, assetRoot, relative), "utf8"),
    );
    records.push(card);
    await input.putAsset(relative, records);
  }
}
async function changeCard(input: Fixture, fields: Record<string, unknown>) {
  const relative = "catalog/cards/01.json";
  const records = JSON.parse(
    await readFile(path.join(input.root, assetRoot, relative), "utf8"),
  );
  Object.assign(records[0], fields);
  await input.putAsset(relative, records);
  await input.publishRuntimeManifest();
}

// Consumer limits stay private. These tests compare actual loaders, not copied cap helpers.
describe("content setup runtime consumer parity", () => {
  it.each([
    [runtimePath, mib, "runtime manifest: response exceeds 1048576 bytes"],
    [
      `${assetRoot}/manifest.json`,
      2 * mib,
      "asset manifest: response exceeds 2097152 bytes",
    ],
  ] as const)(
    "matches browser manifest byte boundary: %s",
    async (relative, cap, message) => {
      const input = await fixture();
      await padManifest(input, relative, cap);
      await expect(
        (await browserFixture(input)).load(),
      ).resolves.toHaveProperty("wasmBinary");
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(true);
      await padManifest(input, relative, cap + 1);
      await expect((await browserFixture(input)).load()).rejects.toThrow(
        message,
      );
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(false);
    },
  );
  it("matches browser file-count boundary", async () => {
    const input = await fixture();
    while (input.assetManifest.files.length < 2048)
      await input.putAsset(
        `support/${input.assetManifest.files.length}.json`,
        [],
      );
    await input.publishRuntimeManifest();
    await expect((await browserFixture(input)).load()).resolves.toHaveProperty(
      "wasmBinary",
    );
    expect((await inspectContentSetup(input.root, {})).codeReady).toBe(true);
    await input.putAsset("support/overflow.json", []);
    await input.publishRuntimeManifest();
    await expect((await browserFixture(input)).load()).rejects.toThrow(
      "Runtime snapshot declares too many files: 2049",
    );
    expect((await inspectContentSetup(input.root, {})).codeReady).toBe(false);
  });
  it.each([0, 1])(
    "matches browser aggregate-byte boundary +%i",
    async (overflow) => {
      const input = await fixture();
      await padAggregate(input, 256 * mib + overflow);
      const browser = await browserFixture(input);
      if (overflow)
        await expect(browser.load()).rejects.toThrow(
          "Runtime snapshot exceeds the maximum aggregate size",
        );
      else await expect(browser.load()).resolves.toHaveProperty("wasmBinary");
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(
        overflow === 0,
      );
    },
  );
  it("retains source snapshot capacity above runtime manifest cap", async () => {
    const input = await fixture();
    bindContentSource(
      input.input,
      Buffer.concat([input.input.source, Buffer.alloc(mib, 0x20)]),
    );
    await input.persistInputs();
    expect((await inspectContentSetup(input.root, {})).codeReady).toBe(true);
  });
  it.each([
    "catalog/cards/40.json",
    "catalog/texts/en/40.json",
    "catalog/cards/3F.json",
    "catalog/texts/en/3F.json",
    "catalog/cards/040.json",
    "catalog/texts/en/nested/00.json",
  ])("rejects coherent noncanonical catalog shard: %s", async (relative) => {
    const input = await fixture();
    await input.putAsset(relative, []);
    await input.publishRuntimeManifest();
    if (relative === "catalog/cards/40.json") {
      const browser = await browserFixture(input);
      vi.stubGlobal("fetch", browser.fetch);
      const reader = createFetchShardReader(
        "https://example.invalid/",
        browser.pin,
      );
      await expect(
        reader.readJson("assets/current/catalog/cards/00.json"),
      ).rejects.toMatchObject({
        cause: { message: "Unsupported catalog shard count: 65" },
      });
    }
    expect((await inspectContentSetup(input.root, {})).codeReady).toBe(false);
  });
});

// Frozen dist/index.js writeCardData: uint32 fields, int32 attack/defense, uint64 race.
// Its setcodes allocation uses Uint16Array([...setcodes, 0]); zero is terminator.
describe("content setup engine ABI boundaries", () => {
  it.each(["type", "level", "attribute", "lscale", "rscale", "linkMarker"])(
    "enforces uint32 %s without clamping",
    async (field) => {
      const input = await fixture();
      for (const value of [0, 0xffffffff, -1, 0x100000000]) {
        await changeCard(input, { [field]: value });
        expect(
          (await inspectContentSetup(input.root, {})).codeReady,
          `${field}=${value}`,
        ).toBe(value >= 0 && value <= 0xffffffff);
      }
    },
  );
  it.each(["attack", "defense"])(
    "enforces int32 %s preserving negative sentinels",
    async (field) => {
      const input = await fixture();
      for (const value of [
        -0x80000000, 0x7fffffff, -2, -1, 0, -0x80000001, 0x80000000,
        0x100000000,
      ]) {
        await changeCard(input, { [field]: value });
        expect(
          (await inspectContentSetup(input.root, {})).codeReady,
          `${field}=${value}`,
        ).toBe(value >= -0x80000000 && value <= 0x7fffffff);
      }
    },
  );
  it.each([1, 0xffffffff, 0x100000000, 0x100000001])(
    "enforces uint32 code: %i",
    async (code) => {
      const input = await fixture();
      if (code !== 1) await addCard(input, code);
      await input.publishRuntimeManifest();
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(
        code <= 0xffffffff,
      );
    },
  );
  it.each([0, 0xffffffff, -1, 0x100000000])(
    "enforces uint32 alias with dependency present: %i",
    async (alias) => {
      const input = await fixture();
      if (alias > 0) await addCard(input, alias);
      await changeCard(input, { alias });
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(
        alias >= 0 && alias <= 0xffffffff,
      );
    },
  );
  it.each(
    [[], [1, 65535], [0], [-1], [65536], [-1, 65536], [1.5]].map(
      (setcodes) => ({ setcodes }),
    ),
  )("enforces nonzero uint16 setcodes: $setcodes", async ({ setcodes }) => {
    const input = await fixture();
    await changeCard(input, { setcodes });
    expect((await inspectContentSetup(input.root, {})).codeReady).toBe(
      setcodes.every(
        (value) => Number.isInteger(value) && value >= 1 && value <= 65535,
      ),
    );
  });
  it.each(["0", "18446744073709551615", "-1", "18446744073709551616"])(
    "enforces uint64 race: %s",
    async (race) => {
      const input = await fixture();
      await changeCard(input, { race });
      expect((await inspectContentSetup(input.root, {})).codeReady).toBe(
        BigInt(race) >= 0n && BigInt(race) <= 0xffffffffffffffffn,
      );
    },
  );
});
