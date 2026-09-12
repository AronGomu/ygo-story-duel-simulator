import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseImageContentLock,
  verifyLockedCardImages,
} from "../../scripts/lib/image-content-lock.ts";
import { isJpeg } from "../../scripts/lib/images.ts";
import { loadChapterOneContentSource } from "../../scripts/lib/chapter-content-source.ts";

const source = await readFile("image-content-lock.json", "utf8");
const lock = parseImageContentLock(JSON.parse(source));
const codes = (await loadChapterOneContentSource(process.cwd())).normalized
  .cardCodes;
const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("Chapter 1 image pins", () => {
  it("locks all 1,627 Chapter 1 codes for full and cropped art", () => {
    expect(codes).toHaveLength(1627);
    expect(lock.cards.map(({ code }) => code)).toEqual(codes);
    expect(lock.crops.map(({ code }) => code)).toEqual(codes);
  });

  it("locks acquired set art without inventing the 19 null images", async () => {
    const manifest = JSON.parse(
      await readFile(`${ASSET_SOURCES.setImages.source}/manifest.json`, "utf8"),
    ) as { readonly files: readonly { readonly setId: string }[] };
    const evidence = JSON.parse(
      await readFile("content/authoring/chapter-one-set-media.json", "utf8"),
    ) as { readonly setsWithoutImage: readonly { readonly id: string }[] };
    expect(lock.sets.map(({ setId }) => setId)).toEqual(
      manifest.files.map(({ setId }) => setId),
    );
    expect(
      evidence.setsWithoutImage.some(({ id }) =>
        lock.sets.some(({ setId }) => setId === id),
      ),
    ).toBe(false);
    expect(lock.schemaVersion).toBe(2);
    expect(lock.provider).toBe("ygoprodeck");
  });

  it.each(["full", "cropped"] as const)(
    "pins bounded JPEG bytes from the actual %s archive",
    async (kind) => {
      const observed = await Promise.all(
        codes.map(async (code) => {
          const bytes = await readFile(
            `${path.posix.dirname(ASSET_SOURCES.fullImages.source)}/${kind}/${code}.jpg`,
          );
          expect(isJpeg(bytes), `${kind}/${code}`).toBe(true);
          expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
          return { code, bytes: bytes.length, sha256: sha256(bytes) };
        }),
      );
      expect(
        verifyLockedCardImages(
          { cards: kind === "full" ? lock.cards : lock.crops },
          observed,
        ),
      ).toEqual([]);
    },
  );
});
