import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { ASSET_SOURCES } from "../scripts/lib/asset-roots.ts";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("canonical source relocation retains browser asset URLs and exact bytes", async ({
  page,
  request,
}) => {
  await page.goto("./");
  for (const [source, logical] of [
    [
      `${ASSET_SOURCES.fonts.source}/forum-latin.woff2`,
      "fonts/forum-latin.woff2",
    ],
    [
      `${ASSET_SOURCES.fonts.source}/source-serif-4-latin.woff2`,
      "fonts/source-serif-4-latin.woff2",
    ],
    [
      `${ASSET_SOURCES.runtime.source}/manifest.json`,
      "runtime/current/manifest.json",
    ],
    [
      `${ASSET_SOURCES.data.source}/manifest.json`,
      "runtime/assets/current/manifest.json",
    ],
    [
      `${ASSET_SOURCES.fullImages.source}/97590747.jpg`,
      "runtime/images/97590747.jpg",
    ],
    [
      `${ASSET_SOURCES.croppedImages.source}/97590747.jpg`,
      "runtime/images-cropped/97590747.jpg",
    ],
    [ASSET_SOURCES.cardBack.source, "runtime/images/card-back.jpg"],
    [
      "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
      "runtime/engine/ocgcore.sync.wasm",
    ],
  ]) {
    const response = await request.get(logical!);
    expect(response.status(), logical).toBe(200);
    expect(hash(await response.body()), logical).toBe(
      hash(await readFile(source!)),
    );
  }
  expect(
    await page.evaluate(async () => {
      const fonts = await document.fonts.load('16px "Forum"');
      return fonts.some((font) => font.status === "loaded");
    }),
  ).toBe(true);
  const provenance = await request.get("assets/story/PROVENANCE.md");
  expect(await provenance.text()).not.toBe(
    await readFile("assets/story/PROVENANCE.md", "utf8"),
  );
});
