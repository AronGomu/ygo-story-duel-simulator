import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseImageContentLock,
  verifyLockedCardImages,
} from "../../scripts/lib/image-content-lock.ts";
import { isJpeg } from "../../scripts/lib/images.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../../src/battle/duel/presets/reviewed-card-pool.ts";

const source = await readFile("image-content-lock.json", "utf8");
const lock = parseImageContentLock(JSON.parse(source));
const codes = [
  4206964, 5053103, 5318639, 12580477, 12607053, 13039848, 15025844, 17814387,
  23771716, 46986414, 50930991, 51482758, 66788016, 70781052, 89631139,
  97590747,
];
const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("Chapter 1 active image pins", () => {
  it("locks exactly the 16 active codes for both full and cropped art", async () => {
    expect(lock.cards.map(({ code }) => code)).toEqual(codes);
    expect(lock.crops.map(({ code }) => code)).toEqual(codes);
    expect(
      [...reviewedCardPool(await loadDeckSources())].sort((a, b) => a - b),
    ).toEqual(codes);
  });

  it("preserves the existing set-art section byte for byte", () => {
    expect(sha256(source.slice(source.indexOf('  "sets":')))).toBe(
      "c0051257959b1992a4959352980f2c2be19ec66e6635747945a7f2ac34cdd4b2",
    );
    expect(lock.schemaVersion).toBe(2);
    expect(lock.provider).toBe("ygoprodeck");
  });

  it.each(["full", "cropped"] as const)(
    "pins bounded JPEG bytes from the actual %s archive",
    async (kind) => {
      const observed = await Promise.all(
        codes.map(async (code) => {
          const bytes = await readFile(
            `generated/card-images/archive/${kind}/${code}.jpg`,
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
