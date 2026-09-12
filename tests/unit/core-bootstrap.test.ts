import { describe, expect, it } from "vitest";
import {
  contentObjectUrl,
  parseCoreBootstrap,
  type CoreBootstrap,
} from "../../src/content/index.ts";

const HASH = "a".repeat(64);
const bootstrap = (delivery: CoreBootstrap["delivery"] = null): unknown => ({
  schemaVersion: 1,
  appSchemaVersion: 1,
  contentSchemaVersion: 2,
  hashAlgorithm: "SHA-256",
  delivery,
  chapters: [
    {
      id: "chapter-01",
      title: "DM",
      description: "Current Chapter 1 prototype.",
    },
  ],
});

describe("parseCoreBootstrap", () => {
  it("accepts an unavailable tracked delivery without inventing a digest", () => {
    expect(
      parseCoreBootstrap(bootstrap(), "https://example.test/game/"),
    ).toStrictEqual(bootstrap());
  });

  it("resolves the generated relative delivery against a loopback app subpath", () => {
    const parsed = parseCoreBootstrap(
      bootstrap({
        baseUrl: "./",
        index: { sha256: HASH, bytes: 321 },
      }),
      "http://127.0.0.1:4202/ygo/",
    );

    expect(parsed.delivery).toStrictEqual({
      baseUrl: "http://127.0.0.1:4202/ygo/",
      index: { sha256: HASH, bytes: 321 },
    });
    expect(
      contentObjectUrl(
        parsed.delivery!.baseUrl,
        "indexes",
        parsed.delivery!.index.sha256,
      ),
    ).toBe(`http://127.0.0.1:4202/ygo/content/indexes/${HASH}.json`);
  });

  it("accepts an absolute HTTPS delivery", () => {
    const parsed = parseCoreBootstrap(
      bootstrap({
        baseUrl: "https://cdn.example.test/releases/",
        index: { sha256: HASH, bytes: 321 },
      }),
      "https://game.example.test/app/",
    );

    expect(parsed.delivery?.baseUrl).toBe("https://cdn.example.test/releases/");
  });

  it.each(["chapter-00", "chapter-1", "chapter-100", "chapter-01/extra"])(
    "rejects chapter id %s",
    (id) => {
      const value = bootstrap() as {
        chapters: Array<{ id: string; title: string; description: string }>;
      };
      value.chapters[0]!.id = id;
      expect(() =>
        parseCoreBootstrap(value, "https://example.test/game/"),
      ).toThrow("CONTENT_INVALID_MANIFEST");
    },
  );

  it.each([
    "http://example.test/content/",
    "http://localhost:4300/content/",
    "https://user:pass@example.test/content/",
    "https://example.test/content/?run=1",
    "https://example.test/content/#run",
    "https://example.test/content/%2e%2e/escape/",
  ])("rejects unsafe delivery base %s", (baseUrl) => {
    expect(() =>
      parseCoreBootstrap(
        bootstrap({ baseUrl, index: { sha256: HASH, bytes: 321 } }),
        "http://localhost:4202/game/",
      ),
    ).toThrow("CONTENT_INVALID_MANIFEST");
  });

  it("rejects extra bootstrap fields", () => {
    expect(() =>
      parseCoreBootstrap(
        { ...(bootstrap() as object), runtimeDigest: HASH },
        "https://example.test/game/",
      ),
    ).toThrow("CONTENT_INVALID_MANIFEST");
  });
});
