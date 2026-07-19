import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRuntimeSnapshotManifest } from "../../src/worker/assets/runtime-manifest.ts";
import {
  runtimeAssetContentSha256,
  safeArtifactPath,
  verifyRuntimeSnapshotFiles,
} from "../../src/worker/assets/runtime-snapshot-node.ts";

const digest = "a".repeat(64);

function validManifest() {
  return parseRuntimeSnapshotManifest({
    schemaVersion: 1,
    generatedAt: "2026-07-13T00:00:00.000Z",
    snapshotId: digest,
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: "sha512-example",
      coreVersion: [11, 0],
      embeddedCoreRevision: "revision",
      manifestSha256: digest,
    },
    assets: {
      manifestSha256: digest,
      babelCdbRevision: "a",
      cardScriptsRevision: "b",
      distributionRevision: "c",
      files: [],
    },
  });
}

describe("runtime snapshot manifest", () => {
  it("accepts the supported immutable schema", () => {
    expect(validManifest().snapshotId).toBe(digest);
  });

  it("derives immutable asset identity without the generation timestamp", () => {
    const assets = {
      schemaVersion: 1,
      generatedAt: "2026-07-13T00:00:00.000Z",
      sources: {
        babelCdb: { commit: "a" },
        cardScripts: { commit: "b" },
        distribution: { commit: "c" },
      },
      files: [{ path: "catalog/cards/01.json", bytes: 1, sha256: digest }],
    };
    expect(
      runtimeAssetContentSha256({
        ...assets,
        generatedAt: "2026-07-14T00:00:00.000Z",
      }),
    ).toBe(runtimeAssetContentSha256(assets));
  });

  it("rejects malformed, unsupported, and unsafe manifests", () => {
    expect(() => parseRuntimeSnapshotManifest(null)).toThrow(/object/);
    expect(() =>
      parseRuntimeSnapshotManifest({ ...validManifest(), schemaVersion: 2 }),
    ).toThrow(/Unsupported/);
    expect(() =>
      parseRuntimeSnapshotManifest({
        ...validManifest(),
        assets: {
          ...validManifest().assets,
          files: [{ path: "../escape", bytes: 0, sha256: digest }],
        },
      }),
    ).toThrow(/invalid file/);
    expect(() =>
      parseRuntimeSnapshotManifest({ ...validManifest(), privateField: true }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      parseRuntimeSnapshotManifest({
        ...validManifest(),
        assets: {
          ...validManifest().assets,
          files: [
            { path: "same.json", bytes: 0, sha256: digest },
            { path: "same.json", bytes: 0, sha256: digest },
          ],
        },
      }),
    ).toThrow(/duplicate path/);
    expect(() => safeArtifactPath("/tmp/snapshot", "../escape")).toThrow(
      /escapes/,
    );
  });

  it("detects artifact hash mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ygo-runtime-manifest-"));
    try {
      const bytes = new TextEncoder().encode("actual");
      await writeFile(path.join(root, "artifact.json"), bytes);
      const manifest = validManifest();
      const mismatched = {
        ...manifest,
        assets: {
          ...manifest.assets,
          files: [
            {
              path: "artifact.json",
              bytes: bytes.byteLength,
              sha256: createHash("sha256").update("expected").digest("hex"),
            },
          ],
        },
      };
      await expect(
        verifyRuntimeSnapshotFiles(mismatched, root),
      ).rejects.toThrow(/SHA-256 mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
