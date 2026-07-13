import { describe, expect, it } from "vitest";
import { pruneRevisionCaches } from "../../src/storage/revision-cache-cleanup.ts";

class NamedCacheStorage {
  readonly names: Set<string>;

  constructor(names: readonly string[]) {
    this.names = new Set(names);
  }

  async keys(): Promise<string[]> {
    return [...this.names];
  }

  async delete(name: string): Promise<boolean> {
    return this.names.delete(name);
  }
}

describe("revision cache cleanup", () => {
  it("retains only the active and fallback runtime/image revisions", async () => {
    const active = "a".repeat(64);
    const fallback = "b".repeat(64);
    const stale = "c".repeat(64);
    const storage = new NamedCacheStorage([
      `ygo-runtime-v1-${active}-runtime`,
      `ygo-card-images-v1-${active}-images`,
      `ygo-runtime-v1-${fallback}-runtime`,
      `ygo-card-images-v1-${stale}-images`,
      `ygo-card-images-v1-${active}-old-images`,
      "unrelated-cache",
    ]);

    await expect(
      pruneRevisionCaches(
        new Set([
          `ygo-runtime-v1-${active}-runtime`,
          `ygo-card-images-v1-${active}-images`,
          `ygo-runtime-v1-${fallback}-runtime`,
        ]),
        storage as unknown as CacheStorage,
      ),
    ).resolves.toBe(2);
    expect([...storage.names].sort()).toEqual(
      [
        `ygo-runtime-v1-${active}-runtime`,
        `ygo-card-images-v1-${active}-images`,
        `ygo-runtime-v1-${fallback}-runtime`,
        "unrelated-cache",
      ].sort(),
    );
  });
});
