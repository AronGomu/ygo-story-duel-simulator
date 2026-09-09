import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectContentSetup,
  runContentSetup,
} from "../../scripts/lib/content-setup-files.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { cardCode } from "../../src/battle/duel/contracts/ids.ts";
import { bindContentSource, contentDigest } from "../fixtures/content-setup.ts";

import { contentSetupFilesFixture } from "../fixtures/content-setup-files.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function localFixture() {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(path.resolve(".tmp/content-setup-fs-"));
  roots.push(root);
  return contentSetupFilesFixture(root);
}

describe("content setup filesystem inspector", () => {
  it("valid local snapshot and selected assets reach code readiness without synthetic availability injection", async () => {
    const fixture = await localFixture();
    const dependencies = await loadActiveDuelDependenciesNode(
      path.join(fixture.root, ASSET_SOURCES.data.source),
      new Set([1, 2, 3, 4, 5, 6].map(cardCode)),
    );
    expect(dependencies.counts).toEqual({
      cards: 6,
      texts: 6,
      images: 6,
      scripts: 3,
      globals: 2,
    });
    const report = await inspectContentSetup(fixture.root, {});
    expect(report).toMatchObject({ codeReady: true, publishReady: false });
    expect(report.blockers.map(({ code }) => code)).toEqual([
      "LICENSE_EVIDENCE_REQUIRED",
      "HOST_SETUP_REQUIRED",
      "DEVICE_ACCESS_REQUIRED",
    ]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runContentSetup(fixture.root, [], {})).toBe(0);
    expect(await runContentSetup(fixture.root, ["--public"], {})).toBe(2);
    expect(
      JSON.parse(
        await readFile(
          path.join(fixture.root, "generated/content/setup-report.json"),
          "utf8",
        ),
      ),
    ).toEqual(report);
  });
  it("missing later-only art does not block Chapter 1; selected art still blocks", async () => {
    const fixture = await localFixture();
    for (const kind of ["full", "cropped"])
      await rm(
        path.join(
          fixture.root,
          `${path.posix.dirname(ASSET_SOURCES.fullImages.source)}/${kind}/2.jpg`,
        ),
      );
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(true);
    await rm(
      path.join(fixture.root, `${ASSET_SOURCES.fullImages.source}/1.jpg`),
    );
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it("unused incompatible legacy deck on disk does not block a compatible exposed roster", async () => {
    const fixture = await localFixture();
    await fixture.put(
      "src/battle/duel/presets/decks/unused-legacy.ydk",
      "#main\n999\n#extra\n!side\n",
    );
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(true);
  });
  it.each([
    "src/battle/duel/presets/decks/chapter-one-starter.ydk",
    "src/battle/duel/presets/decks/chapter-one-practice.ydk",
    "src/decks/chapter-one-starter.ydk",
  ])(
    "missing exposed preset, default or starter blocks: %s",
    async (relative) => {
      const fixture = await localFixture();
      await rm(path.join(fixture.root, relative));
      const report = await inspectContentSetup(fixture.root, {});
      expect(report.codeReady).toBe(false);
      expect(
        report.blockers.some(({ detail }) =>
          detail.includes("prototype deck compatibility"),
        ),
      ).toBe(true);
    },
  );
  it.each(["main", "extra", "side"])(
    "rejects exposed deck outside selected union in %s",
    async (section) => {
      const fixture = await localFixture();
      const main = Array(40).fill(1);
      if (section === "main") main[0] = 2;
      await fixture.put(
        "src/battle/duel/presets/decks/chapter-one-practice.ydk",
        `#main\n${main.join("\n")}\n#extra\n${section === "extra" ? "2\n" : ""}!side\n${section === "side" ? "2\n" : ""}`,
      );
      expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(
        false,
      );
    },
  );
  it.each(["empty", "invalid", "malformed UTF-8", "oversized"])(
    "rejects unreadable or empty required starter without leaking values: %s",
    async (fault) => {
      const fixture = await localFixture();
      const sentinel = "fake-deck-secret-sentinel";
      const source = {
        empty: "#main\n#extra\n!side\n",
        invalid: `#main\n${sentinel}\n`,
        "malformed UTF-8": Buffer.from([0xff]),
        oversized: Buffer.alloc(1024 * 1024 + 1, 0x20),
      }[fault]!;
      await fixture.put("src/decks/chapter-one-starter.ydk", source);
      const report = await inspectContentSetup(fixture.root, {});
      expect(report.codeReady).toBe(false);
      expect(JSON.stringify(report)).not.toContain(sentinel);
    },
  );
  it("full frozen runtime closure remains required for unselected later cards", async () => {
    const fixture = await localFixture();
    await fixture.putAsset("catalog/texts/en/02.json", []);
    await fixture.publishRuntimeManifest();
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each([
    "catalog/texts/en/01.json",
    "images/01.json",
    "scripts/index.json",
    "scripts/globals.json",
    "scripts/cards/01.json",
    "scripts/cards/ff.json",
    "strings/en.json",
  ])(
    "rejects consumer-required role omitted from coherent manifest: %s",
    async (relative) => {
      const fixture = await localFixture();
      fixture.assetManifest.files.splice(
        fixture.assetManifest.files.findIndex((file) => file.path === relative),
        1,
      );
      await fixture.publishRuntimeManifest();
      const report = await inspectContentSetup(fixture.root, {});
      expect(report.codeReady).toBe(false);
      expect(
        report.blockers.some(({ code }) => code === "SOURCE_COVERAGE_REQUIRED"),
      ).toBe(true);
    },
  );
  it.each([
    "catalog/texts/en/01.json",
    "images/01.json",
    "scripts/index.json",
    "scripts/globals.json",
    "scripts/cards/01.json",
    "strings/en.json",
  ])("rejects missing runtime payload: %s", async (relative) => {
    const fixture = await localFixture();
    await rm(path.join(fixture.root, ASSET_SOURCES.data.source, relative));
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each([
    "lib/ocgcore.sync.wasm",
    "lib/ocgcore.sync.mjs",
    "dist/index.js",
    "dist/ocgcore.sync-MMMSWPBB.js",
  ])("rejects missing pinned engine payload: %s", async (relative) => {
    const fixture = await localFixture();
    await rm(path.join(fixture.root, "vendor/ocgcore-wasm/0.1.2", relative));
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each([
    "lib/ocgcore.sync.wasm",
    "lib/ocgcore.sync.mjs",
    "dist/index.js",
    "dist/ocgcore.sync-MMMSWPBB.js",
  ])(
    "rejects same-size corrupt pinned engine payload: %s",
    async (relative) => {
      const fixture = await localFixture();
      const file = `vendor/ocgcore-wasm/0.1.2/${relative}`;
      const bytes = await readFile(path.join(fixture.root, file));
      bytes[0] = bytes[0]! ^ 0xff;
      await fixture.put(file, bytes);
      expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(
        false,
      );
    },
  );
  it.each(["omit", "rehash"])(
    "rejects replacement engine manifest: %s",
    async (mode) => {
      const fixture = await localFixture();
      const relative = "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json";
      const manifest = JSON.parse(
        await readFile(path.join(fixture.root, relative), "utf8"),
      );
      if (mode === "omit") manifest.files = [];
      else {
        const entry = manifest.files.find(
          (file: { path: string }) => file.path === "lib/ocgcore.sync.wasm",
        );
        await fixture.put(
          "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
          "forged",
        );
        entry.bytes = 6;
        entry.sha256 = contentDigest("forged");
      }
      await fixture.putJson(relative, manifest);
      await fixture.publishRuntimeManifest();
      expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(
        false,
      );
    },
  );
  it.each([
    ["catalog/cards/01.json", [{ code: 1 }]],
    ["catalog/texts/en/01.json", [{ code: 1 }]],
    ["catalog/texts/en/01.json", []],
    ["images/01.json", [{ code: 1 }]],
    ["images/01.json", []],
    ["scripts/cards/01.json", {}],
    ["scripts/globals.json", {}],
    [
      "scripts/index.json",
      { official: [], preRelease: [], globals: [], shardCount: 256 },
    ],
    ["strings/en.json", {}],
  ])(
    "rejects malformed or incomplete runtime records after coherent rehash: %s %j",
    async (relative, value) => {
      const fixture = await localFixture();
      await fixture.putAsset(relative as string, value);
      await fixture.publishRuntimeManifest();
      expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(
        false,
      );
    },
  );
  it.each([
    `${ASSET_SOURCES.runtime.source}/manifest.json`,
    `${ASSET_SOURCES.data.source}/manifest.json`,
    "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json",
    `${ASSET_SOURCES.setImages.source}/manifest.json`,
  ])("rejects oversized manifest: %s", async (relative) => {
    const fixture = await localFixture();
    const original = await readFile(path.join(fixture.root, relative));
    const cap = relative.includes("set-images")
      ? 1024 * 1024
      : 16 * 1024 * 1024;
    await fixture.put(
      relative,
      Buffer.concat([original, Buffer.alloc(cap + 1, 0x20)]),
    );
    // Keep vendor digest coherent: size alone, not mismatch, must block this case.
    if (relative.startsWith("vendor/")) await fixture.publishRuntimeManifest();
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each([
    "../outside.json",
    "/outside.json",
    "catalog/../../outside.json",
    "catalog/%2e%2e/outside.json",
  ])("rejects unsafe runtime path: %s", async (unsafe) => {
    const fixture = await localFixture();
    const runtime = JSON.parse(
      await readFile(
        path.join(
          fixture.root,
          `${ASSET_SOURCES.runtime.source}/manifest.json`,
        ),
        "utf8",
      ),
    );
    runtime.assets.files[0].path = unsafe;
    await fixture.putJson(
      `${ASSET_SOURCES.runtime.source}/manifest.json`,
      runtime,
    );
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each([
    `${ASSET_SOURCES.data.source}/catalog/cards/01.json`,
    `${ASSET_SOURCES.fullImages.source}/1.jpg`,
    `${ASSET_SOURCES.croppedImages.source}/1.jpg`,
    `${ASSET_SOURCES.setImages.source}/chapter-01.jpg`,
    `${ASSET_SOURCES.story.source}/city-map-placeholder.svg`,
  ])("reports missing local asset: %s", async (relative) => {
    const fixture = await localFixture();
    await rm(path.join(fixture.root, relative));
    const report = await inspectContentSetup(fixture.root, {});
    expect(report.codeReady).toBe(false);
    expect(
      report.blockers.some(({ code }) => code === "SOURCE_COVERAGE_REQUIRED"),
    ).toBe(true);
  });
  it.each([
    `${ASSET_SOURCES.data.source}/catalog/cards/01.json`,
    `${ASSET_SOURCES.fullImages.source}/1.jpg`,
    `${ASSET_SOURCES.croppedImages.source}/1.jpg`,
    `${ASSET_SOURCES.setImages.source}/chapter-01.jpg`,
  ])("rejects corrupt local asset: %s", async (relative) => {
    const fixture = await localFixture();
    const bytes = await readFile(path.join(fixture.root, relative));
    bytes[0] = 0;
    await fixture.put(relative, bytes);
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it("rejects set-image hash mismatch even when JPEG signatures stay valid", async () => {
    const fixture = await localFixture();
    fixture.setManifest.files[0]!.sha256 = "0".repeat(64);
    await fixture.putJson(
      `${ASSET_SOURCES.setImages.source}/manifest.json`,
      fixture.setManifest,
    );
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(false);
  });
  it.each(["raw", "decoded"])(
    "rejects malformed source UTF-8 with %s digest on disk",
    async (mode) => {
      const fixture = await localFixture();
      const bytes = Buffer.concat([
        Buffer.from('{"purpose":"'),
        Buffer.from([0xff]),
        Buffer.from('",'),
        fixture.input.source.subarray(1),
      ]);
      bindContentSource(fixture.input, bytes);
      if (mode === "decoded") {
        fixture.input.selections.sourceSha256 = contentDigest(
          bytes.toString("utf8"),
        );
        fixture.input.chapterPolicy.sourceSha256 =
          fixture.input.selections.sourceSha256;
      }
      await fixture.persistInputs();
      expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(
        false,
      );
    },
  );
  it("preserves valid raw UTF-8 source digest on disk", async () => {
    const fixture = await localFixture();
    const source = JSON.parse(fixture.input.source.toString("utf8"));
    source.purpose = "synthetic café fixture";
    bindContentSource(
      fixture.input,
      Buffer.from(JSON.stringify(source, null, 2) + "\n"),
    );
    await fixture.persistInputs();
    expect((await inspectContentSetup(fixture.root, {})).codeReady).toBe(true);
  });
  it("redacts data exceptions and unexpected filesystem exceptions", async () => {
    const fixture = await localFixture();
    const sentinel = "fake-secret-exception-sentinel";
    const stdout: unknown[][] = [];
    const stderr: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args);
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(args);
    });
    const environment = {
      CLOUDFLARE_API_TOKEN: sentinel,
      CLOUDFLARE_ACCOUNT_ID: sentinel,
    };
    const runtime = JSON.parse(
      await readFile(
        path.join(
          fixture.root,
          `${ASSET_SOURCES.runtime.source}/manifest.json`,
        ),
        "utf8",
      ),
    );
    runtime.assets.files[0].path = `../${sentinel}`;
    await fixture.putJson(
      `${ASSET_SOURCES.runtime.source}/manifest.json`,
      runtime,
    );
    expect(await runContentSetup(fixture.root, [], environment)).toBe(2);
    const report = await readFile(
      path.join(fixture.root, "generated/content/setup-report.json"),
      "utf8",
    );
    const sourcePath = path.join(
      fixture.root,
      "content/authoring/card-set-source.json",
    );
    await rm(sourcePath);
    await symlink(sentinel, sourcePath);
    await symlink(
      sentinel,
      path.join(fixture.root, "content/authoring", sentinel),
    );
    expect(await runContentSetup(fixture.root, [], environment)).toBe(1);
    expect(stderr).toEqual([
      ["Content setup verification failed unexpectedly."],
    ]);
    expect(JSON.stringify({ stdout, stderr, report })).not.toContain(sentinel);
  });
});
