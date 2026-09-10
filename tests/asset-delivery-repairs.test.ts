import assert from "node:assert/strict";
import test, { mock } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import {
  sha,
  put,
  fixture,
  prepared,
  current,
} from "./fixtures/asset-delivery-bundle.ts";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { verifyBundle } from "../scripts/lib/asset-delivery/verify-bundle.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";
import { freezeFile } from "../scripts/lib/asset-delivery/freeze-file.ts";
import { contentObjectUrl } from "../src/content/index.ts";

test("R6 lint rejects dynamic Node and scripts imports in content", async () => {
  const { ESLint } = await import("eslint");
  const lint = new ESLint();
  for (const source of [
    'import("node:fs")',
    'import("fs")',
    'import("fs/promises")',
    'import("../../scripts/content-catalog.ts")',
    'import("../../scripts/lib/asset-delivery/bundle.ts")',
    'import("@aws-sdk/client-s3")',
    "import(`node:fs`)",
  ]) {
    const [result] = await lint.lintText(source, {
      filePath: "src/content/probe.ts",
    });
    assert(
      result!.messages.some(
        (message) => message.ruleId === "no-restricted-syntax",
      ),
      source,
    );
  }
  const [allowed] = await lint.lintText('import("./index.ts")', {
    filePath: "src/content/probe.ts",
  });
  assert.equal(allowed!.errorCount, 0);
});

test("R5 malformed URL authorities preserve exact content error", () => {
  for (const url of [
    "https:///",
    "https://[bad]/",
    "https://example.test:99999/",
  ])
    assert.throws(() => contentObjectUrl(url, "indexes", "a".repeat(64)), {
      message: "CONTENT_INVALID_MANIFEST",
    });
  for (const [kind, hash] of [
    ["invalid", "a".repeat(64)],
    ["indexes", "A".repeat(64)],
    ["indexes", "short"],
  ])
    assert.throws(
      () => contentObjectUrl("https://example.test/", kind as "indexes", hash!),
      { message: "CONTENT_INVALID_MANIFEST" },
    );
});

test("R7 valid 452 and 512 byte source paths survive private staging prefixes", async () => {
  const root = await fixture();
  for (const length of [452, 512]) {
    const prefix =
      "assets/battle/" + Array(4).fill("a".repeat(105)).join("/") + "/";
    const source = prefix + "x".repeat(length - prefix.length - 6) + ".blend";
    assert.equal(Buffer.byteLength(source), length);
    await put(root, source, "long source bytes");
  }
  const snapshot = await bundleAssets(
    root,
    "all",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  assert.deepEqual(
    await verifyBundle(root, (await current(root)).run),
    snapshot,
  );
});

test("R8 source-open races use stable codes, unexpected I/O retains identity", async (t) => {
  for (const code of ["ENOENT", "ELOOP", "EIO"] as const)
    await t.test(code, async () => {
      const root = await fixture();
      await bundleAssets(
        root,
        "dev",
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        null,
      );
      const previous = await current(root);
      const source = "assets/battle/original.blend";
      const bytes = await fs.readFile(path.join(root, source));
      const failure = Object.assign(
        new Error("injected source-open I/O fault"),
        { code },
      );
      const original = fs.open;
      let observed = false;
      const fault = mock.method(
        fs,
        "open",
        async (...args: Parameters<typeof fs.open>) => {
          if (args[0] === path.join(root, source)) {
            observed = true;
            if (code === "EIO") throw failure;
            await fs.unlink(path.join(root, source));
            if (code === "ELOOP")
              await fs.symlink("original.blend", path.join(root, source));
          }
          return original(...args);
        },
      );
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          freezeFile(
            root,
            { path: source, bytes: bytes.length, sha256: sha(bytes) },
            "staged.bin",
          ),
          code === "EIO"
            ? (error: unknown) => error === failure
            : {
                message:
                  code === "ENOENT"
                    ? "ASSET_SOURCE_CHANGED"
                    : "ASSET_PATH_UNSAFE",
              },
        );
      } finally {
        fault.mock.restore();
        syncBuiltinESMExports();
      }
      assert(observed);
      assert.deepEqual(await current(root), previous);
      await verifyBundle(root, previous.run);
      await assert.rejects(fs.stat(path.join(root, "staged.bin")), {
        code: "ENOENT",
      });
    });
});
