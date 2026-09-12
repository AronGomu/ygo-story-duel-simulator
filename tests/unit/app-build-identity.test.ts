import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appBuildIdentity } from "../../scripts/lib/app-build-identity.ts";

const FILES = [
  "assets/story/chapter-01/city-map-placeholder.svg",
  "index.html",
  "package-lock.json",
  "package.json",
  "vite.config.ts",
  "scripts/lib/app-build-identity.ts",
  "scripts/lib/vite-core-content.ts",
  "scripts/lib/vite-sync-core.ts",
  "src/main.ts",
  "vendor/ocgcore-wasm/0.1.2/manifest.json",
] as const;

async function fixture(prefix: string): Promise<string> {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(path.resolve(".tmp", prefix));
  for (const file of FILES) {
    const absolute = path.join(root, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `fixture:${file}\n`);
  }
  return root;
}

describe("app build identity", () => {
  it("depends on relative paths and bytes, never checkout path or mtime", async () => {
    const first = await fixture("app-id-a-");
    const second = await fixture("app-id-b-");
    const bootstrap = new TextEncoder().encode('{"schemaVersion":1}\n');
    try {
      await utimes(path.join(second, "src/main.ts"), new Date(0), new Date(0));
      expect(appBuildIdentity(first, bootstrap)).toBe(
        appBuildIdentity(second, bootstrap),
      );
      await writeFile(path.join(second, "src/main.ts"), "changed\n");
      expect(appBuildIdentity(first, bootstrap)).not.toBe(
        appBuildIdentity(second, bootstrap),
      );
    } finally {
      await Promise.all([
        rm(first, { recursive: true, force: true }),
        rm(second, { recursive: true, force: true }),
      ]);
    }
  });
});
