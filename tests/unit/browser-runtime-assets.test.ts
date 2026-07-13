import { describe, expect, it } from "vitest";
import {
  loadBrowserRuntimeAssets,
  resolveBrowserRuntimeUrl,
} from "../../src/worker/assets/browser-runtime-assets.ts";

const encoder = new TextEncoder();

class MemoryCache {
  readonly entries = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const response = this.entries.get(String(request));
    return response?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(String(request), response.clone());
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(String(request));
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();
  failOpen = false;

  async open(name: string): Promise<MemoryCache> {
    if (this.failOpen) throw new Error("cache unavailable");
    let cache = this.caches.get(name);
    if (cache === undefined) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fixture(): Promise<{
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly dataPath: string;
  readonly runtimeManifestSha256: string;
}> {
  const base = "https://example.test/game/";
  const dataPath = "catalog/cards/00.json";
  const dataBytes = encoder.encode('[{"code":64}]');
  const assetManifestBytes = encoder.encode('{"schemaVersion":1}');
  const wasmBytes = new Uint8Array([0, 97, 115, 109]);
  const vendorManifest = {
    schemaVersion: 1,
    package: "ocgcore-wasm",
    version: "0.1.2",
    integrity: "fixture-integrity",
    embeddedCoreRevision: "fixture-revision",
    coreVersion: [11, 0],
    files: [
      {
        path: "lib/ocgcore.sync.wasm",
        bytes: wasmBytes.byteLength,
        sha256: await sha256(wasmBytes),
      },
    ],
  };
  const vendorManifestBytes = encoder.encode(JSON.stringify(vendorManifest));
  const runtimeManifest = {
    schemaVersion: 1,
    generatedAt: "2026-07-13T00:00:00.000Z",
    snapshotId: "a".repeat(64),
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: "fixture-integrity",
      coreVersion: [11, 0],
      embeddedCoreRevision: "fixture-revision",
      manifestSha256: await sha256(vendorManifestBytes),
    },
    assets: {
      manifestSha256: await sha256(assetManifestBytes),
      babelCdbRevision: "babel",
      cardScriptsRevision: "scripts",
      distributionRevision: "distribution",
      files: [
        {
          path: dataPath,
          bytes: dataBytes.byteLength,
          sha256: await sha256(dataBytes),
        },
      ],
    },
  };
  const runtimeManifestBytes = encoder.encode(JSON.stringify(runtimeManifest));

  return {
    dataPath,
    runtimeManifestSha256: await sha256(runtimeManifestBytes),
    files: new Map([
      [
        resolveBrowserRuntimeUrl(base, "current/manifest.json"),
        runtimeManifestBytes,
      ],
      [
        resolveBrowserRuntimeUrl(base, "assets/current/manifest.json"),
        assetManifestBytes,
      ],
      [resolveBrowserRuntimeUrl(base, `assets/current/${dataPath}`), dataBytes],
      [
        resolveBrowserRuntimeUrl(base, "engine/vendor-manifest.json"),
        vendorManifestBytes,
      ],
      [resolveBrowserRuntimeUrl(base, "engine/ocgcore.sync.wasm"), wasmBytes],
    ]),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function fetchFrom(files: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const bytes = files.get(url);
    return bytes === undefined
      ? new Response("missing", { status: 404 })
      : new Response(toArrayBuffer(bytes), { status: 200 });
  }) as typeof fetch;
}

describe("browser runtime assets", () => {
  it("resolves immutable runtime files beneath a non-root base URL", () => {
    expect(
      resolveBrowserRuntimeUrl(
        "https://example.test/apps/duel/",
        "engine/ocgcore.sync.wasm",
      ),
    ).toBe("https://example.test/apps/duel/runtime/engine/ocgcore.sync.wasm");
  });

  it("verifies manifests, every declared artifact, and the vendored WASM", async () => {
    const { files, dataPath, runtimeManifestSha256 } = await fixture();
    const progress: number[] = [];
    const loaded = await loadBrowserRuntimeAssets(
      "https://example.test/game/",
      {
        expectedManifestSha256: runtimeManifestSha256,
        fetch: fetchFrom(files),
        onProgress: (_stage, value) => {
          if (value !== undefined) progress.push(value);
        },
      },
    );

    expect(loaded.manifest.snapshotId).toBe("a".repeat(64));
    expect(new Uint8Array(loaded.wasmBinary)).toEqual(
      new Uint8Array([0, 97, 115, 109]),
    );
    await expect(
      loaded.readJson<{ code: number }[]>(dataPath),
    ).resolves.toEqual([{ code: 64 }]);
    expect(progress.at(-1)).toBe(1);
  });

  it("reopens a fully verified runtime from its revision cache without network access", async () => {
    const { files, dataPath, runtimeManifestSha256 } = await fixture();
    const cacheStorage = new MemoryCacheStorage();
    const first = await loadBrowserRuntimeAssets("https://example.test/game/", {
      expectedManifestSha256: runtimeManifestSha256,
      fetch: fetchFrom(files),
      cacheStorage: cacheStorage as unknown as CacheStorage,
    });
    await first.readJson(dataPath);

    const cached = await loadBrowserRuntimeAssets(
      "https://example.test/game/",
      {
        expectedManifestSha256: runtimeManifestSha256,
        cacheOnlySnapshotId: "a".repeat(64),
        fetch: (async () => {
          throw new Error("network must not be used");
        }) as typeof fetch,
        cacheStorage: cacheStorage as unknown as CacheStorage,
      },
    );

    await expect(cached.readJson(dataPath)).resolves.toEqual([{ code: 64 }]);
    expect(new Uint8Array(cached.wasmBinary)).toEqual(
      new Uint8Array([0, 97, 115, 109]),
    );
  });

  it("uses the healthy network when Cache Storage or a cached root fails", async () => {
    const { files, dataPath, runtimeManifestSha256 } = await fixture();
    const unavailable = new MemoryCacheStorage();
    unavailable.failOpen = true;
    const networkOnly = await loadBrowserRuntimeAssets(
      "https://example.test/game/",
      {
        expectedManifestSha256: runtimeManifestSha256,
        cacheSnapshotId: "a".repeat(64),
        fetch: fetchFrom(files),
        cacheStorage: unavailable as unknown as CacheStorage,
      },
    );
    await expect(networkOnly.readJson(dataPath)).resolves.toEqual([
      { code: 64 },
    ]);

    const storage = new MemoryCacheStorage();
    const first = await loadBrowserRuntimeAssets("https://example.test/game/", {
      expectedManifestSha256: runtimeManifestSha256,
      cacheSnapshotId: "a".repeat(64),
      fetch: fetchFrom(files),
      cacheStorage: storage as unknown as CacheStorage,
    });
    await first.readJson(dataPath);
    const cacheName = `ygo-runtime-v1-${"a".repeat(64)}-${runtimeManifestSha256}`;
    const cache = storage.caches.get(cacheName)!;
    cache.entries.set(
      resolveBrowserRuntimeUrl(
        "https://example.test/game/",
        "current/manifest.json",
      ),
      new Response("corrupt"),
    );
    const recovered = await loadBrowserRuntimeAssets(
      "https://example.test/game/",
      {
        expectedManifestSha256: runtimeManifestSha256,
        cacheSnapshotId: "a".repeat(64),
        fetch: fetchFrom(files),
        cacheStorage: storage as unknown as CacheStorage,
      },
    );
    await expect(recovered.readJson(dataPath)).resolves.toEqual([{ code: 64 }]);
  });

  it("rejects a runtime manifest that does not match the digest pinned in the Worker", async () => {
    const { files } = await fixture();
    await expect(
      loadBrowserRuntimeAssets("https://example.test/game/", {
        expectedManifestSha256: "f".repeat(64),
        fetch: fetchFrom(files),
      }),
    ).rejects.toThrow("runtime manifest: SHA-256 mismatch");
  });

  it("rejects encoded traversal and drive-qualified paths before constructing a runtime URL", () => {
    expect(() =>
      resolveBrowserRuntimeUrl(
        "https://example.test/game/",
        "%2e%2e/private.json",
      ),
    ).toThrow("Invalid browser runtime path");
    expect(() =>
      resolveBrowserRuntimeUrl(
        "https://example.test/game/",
        "C:/outside/private.json",
      ),
    ).toThrow("Invalid browser runtime path");
  });

  it("rejects a byte-length or digest mismatch when a lazy asset is requested", async () => {
    const { files, dataPath, runtimeManifestSha256 } = await fixture();
    const corrupted = new Map(files);
    corrupted.set(
      resolveBrowserRuntimeUrl(
        "https://example.test/game/",
        `assets/current/${dataPath}`,
      ),
      encoder.encode("corrupt"),
    );

    const loaded = await loadBrowserRuntimeAssets(
      "https://example.test/game/",
      {
        expectedManifestSha256: runtimeManifestSha256,
        fetch: fetchFrom(corrupted),
      },
    );
    await expect(loaded.readJson(dataPath)).rejects.toThrow(
      /catalog\/cards\/00\.json/,
    );
  });
});
