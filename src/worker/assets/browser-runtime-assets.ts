import {
  isSafeManifestPath,
  parseRuntimeSnapshotManifest,
  type RuntimeManifestFile,
  type RuntimeSnapshotManifest,
} from "./runtime-manifest.ts";
import type { ActiveDuelAssetReader } from "./active-duel-dependencies.ts";

const WASM_VENDOR_PATH = "lib/ocgcore.sync.wasm";
const MAXIMUM_RUNTIME_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_ASSET_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAXIMUM_VENDOR_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_SNAPSHOT_FILES = 2_048;
const MAXIMUM_SNAPSHOT_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export interface BrowserRuntimeAssets extends ActiveDuelAssetReader {
  readonly manifest: RuntimeSnapshotManifest;
  readonly wasmBinary: ArrayBuffer;
}

export interface BrowserRuntimeAssetOptions {
  readonly expectedManifestSha256: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly cacheStorage?: Pick<CacheStorage, "open">;
  readonly signal?: AbortSignal;
  readonly onProgress?: (stage: string, progress?: number) => void;
  readonly cacheSnapshotId?: string;
  readonly cacheOnlySnapshotId?: string;
}

interface VendorManifest {
  readonly schemaVersion: 1;
  readonly package: "ocgcore-wasm";
  readonly version: "0.1.2";
  readonly integrity: string;
  readonly embeddedCoreRevision: string;
  readonly coreVersion: readonly [number, number];
  readonly files: readonly RuntimeManifestFile[];
}

export function resolveBrowserRuntimeUrl(
  applicationBaseUrl: string,
  runtimePath: string,
): string {
  const base = new URL(applicationBaseUrl);
  const normalizedBase = base.href.endsWith("/") ? base.href : `${base.href}/`;
  const safePath = requireSafeRuntimePath(runtimePath);
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  return new URL(`runtime/${encodedPath}`, normalizedBase).href;
}

export async function loadBrowserRuntimeAssets(
  applicationBaseUrl: string,
  options: BrowserRuntimeAssetOptions,
): Promise<BrowserRuntimeAssets> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (fetchImplementation === undefined)
    throw new Error("Browser fetch is unavailable");
  if (!/^[a-f0-9]{64}$/.test(options.expectedManifestSha256))
    throw new Error("Expected runtime manifest digest is invalid");
  const progress = options.onProgress ?? (() => undefined);
  const cacheStorage = options.cacheStorage ?? globalThis.caches;
  const signal = options.signal;
  signal?.throwIfAborted();

  progress("manifest", 0);
  const runtimeManifestUrl = resolveBrowserRuntimeUrl(
    applicationBaseUrl,
    "current/manifest.json",
  );
  let runtimeCache: Cache | undefined;
  const cacheSnapshotId =
    options.cacheOnlySnapshotId ?? options.cacheSnapshotId;
  if (cacheSnapshotId !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(cacheSnapshotId))
      throw new Error("Cached runtime snapshot ID is invalid");
    try {
      runtimeCache = await cacheStorage?.open(
        `ygo-runtime-v1-${cacheSnapshotId}-${options.expectedManifestSha256}`,
      );
    } catch (error) {
      console.warn({
        event: "duel.worker.runtime_cache.open_failed",
        snapshotId: cacheSnapshotId,
        err: error,
      });
      if (options.cacheOnlySnapshotId !== undefined)
        throw new Error("Unable to open cached fallback runtime", {
          cause: error,
        });
    }
  }
  const cachedRuntimeManifest = await matchRuntimeCache(
    runtimeCache,
    runtimeManifestUrl,
    "runtime manifest",
    options.cacheOnlySnapshotId !== undefined,
  );
  let runtimeManifestBytes: Uint8Array | undefined;
  if (cachedRuntimeManifest !== undefined) {
    try {
      const cachedBytes = await readResponseBytes(
        cachedRuntimeManifest,
        "runtime manifest",
        MAXIMUM_RUNTIME_MANIFEST_BYTES,
      );
      await verifyDigest(
        "runtime manifest",
        cachedBytes,
        options.expectedManifestSha256,
      );
      runtimeManifestBytes = cachedBytes;
    } catch (error) {
      console.warn({
        event: "duel.worker.runtime_cache.manifest_invalid",
        snapshotId: cacheSnapshotId,
        err: error,
      });
      try {
        await runtimeCache?.delete(runtimeManifestUrl);
      } catch (deleteError) {
        console.warn({
          event: "duel.worker.runtime_cache.delete_failed",
          label: "runtime manifest",
          err: deleteError,
        });
      }
      if (options.cacheOnlySnapshotId !== undefined) throw error;
    }
  }
  if (runtimeManifestBytes === undefined) {
    if (options.cacheOnlySnapshotId !== undefined)
      throw new Error("Cached fallback runtime manifest is unavailable");
    runtimeManifestBytes = await fetchBytes(
      fetchImplementation,
      runtimeManifestUrl,
      "runtime manifest",
      MAXIMUM_RUNTIME_MANIFEST_BYTES,
      signal,
    );
    await verifyDigest(
      "runtime manifest",
      runtimeManifestBytes,
      options.expectedManifestSha256,
    );
  }
  const manifest = parseRuntimeSnapshotManifest(
    parseJson(runtimeManifestBytes, "runtime manifest"),
  );
  if (cacheSnapshotId !== undefined && manifest.snapshotId !== cacheSnapshotId)
    throw new Error("Runtime cache snapshot ID mismatch");

  validateSnapshotBounds(manifest.assets.files);

  try {
    runtimeCache ??= await cacheStorage?.open(
      `ygo-runtime-v1-${manifest.snapshotId}-${options.expectedManifestSha256}`,
    );
    await runtimeCache?.put(
      runtimeManifestUrl,
      new Response(runtimeManifestBytes.slice()),
    );
  } catch (error) {
    console.warn({
      event: "duel.worker.runtime_cache.open_failed",
      err: error,
    });
    if (options.cacheOnlySnapshotId === undefined) runtimeCache = undefined;
  }
  const [assetManifestBytes, vendorManifestBytes] = await Promise.all([
    fetchCachedVerifiedBytes(
      fetchImplementation,
      resolveBrowserRuntimeUrl(
        applicationBaseUrl,
        "assets/current/manifest.json",
      ),
      "asset manifest",
      MAXIMUM_ASSET_MANIFEST_BYTES,
      manifest.assets.manifestSha256,
      undefined,
      signal,
      runtimeCache,
      options.cacheOnlySnapshotId !== undefined,
    ),
    fetchCachedVerifiedBytes(
      fetchImplementation,
      resolveBrowserRuntimeUrl(
        applicationBaseUrl,
        "engine/vendor-manifest.json",
      ),
      "vendor manifest",
      MAXIMUM_VENDOR_MANIFEST_BYTES,
      manifest.engine.manifestSha256,
      undefined,
      signal,
      runtimeCache,
      options.cacheOnlySnapshotId !== undefined,
    ),
  ]);
  await verifyDigest(
    "asset manifest",
    assetManifestBytes,
    manifest.assets.manifestSha256,
  );
  await verifyDigest(
    "vendor manifest",
    vendorManifestBytes,
    manifest.engine.manifestSha256,
  );
  const vendorManifest = parseVendorManifest(
    parseJson(vendorManifestBytes, "vendor manifest"),
  );
  if (
    vendorManifest.integrity !== manifest.engine.integrity ||
    vendorManifest.embeddedCoreRevision !==
      manifest.engine.embeddedCoreRevision ||
    vendorManifest.coreVersion[0] !== manifest.engine.coreVersion[0] ||
    vendorManifest.coreVersion[1] !== manifest.engine.coreVersion[1]
  ) {
    throw new Error(
      "Vendored engine metadata does not match the runtime snapshot",
    );
  }

  const fileRecords = new Map(
    manifest.assets.files.map((file) => [file.path, file] as const),
  );
  const verifiedFiles = new Map<string, Uint8Array>();
  const pendingFiles = new Map<string, Promise<Uint8Array>>();

  progress("engine", 0.1);
  const wasmRecord = vendorManifest.files.find(
    (file) => file.path === WASM_VENDOR_PATH,
  );
  if (wasmRecord === undefined)
    throw new Error(
      "Vendored engine manifest does not declare the synchronous WASM",
    );
  const wasmBytes = await fetchCachedVerifiedBytes(
    fetchImplementation,
    resolveBrowserRuntimeUrl(applicationBaseUrl, "engine/ocgcore.sync.wasm"),
    WASM_VENDOR_PATH,
    wasmRecord.bytes,
    wasmRecord.sha256,
    wasmRecord.bytes,
    signal,
    runtimeCache,
    options.cacheOnlySnapshotId !== undefined,
  );
  progress("engine-assets", 1);

  const loadSnapshotFile = (relativePath: string): Promise<Uint8Array> => {
    const safePath = requireSafeRuntimePath(relativePath);
    const cached = verifiedFiles.get(safePath);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = pendingFiles.get(safePath);
    if (pending !== undefined) return pending;
    const record = fileRecords.get(safePath);
    if (record === undefined)
      return Promise.reject(
        new Error(`Runtime snapshot does not declare file: ${safePath}`),
      );
    const operation = (async () => {
      signal?.throwIfAborted();
      const bytes = await fetchCachedVerifiedBytes(
        fetchImplementation,
        resolveBrowserRuntimeUrl(
          applicationBaseUrl,
          `assets/current/${safePath}`,
        ),
        safePath,
        record.bytes,
        record.sha256,
        record.bytes,
        signal,
        runtimeCache,
        options.cacheOnlySnapshotId !== undefined,
      );
      verifiedFiles.set(safePath, bytes);
      progress("active-assets");
      return bytes;
    })().finally(() => pendingFiles.delete(safePath));
    pendingFiles.set(safePath, operation);
    return operation;
  };

  return Object.freeze({
    manifest,
    wasmBinary: toArrayBuffer(wasmBytes),
    async readJson<T>(relativePath: string): Promise<T> {
      const safePath = requireSafeRuntimePath(relativePath);
      return parseJson(await loadSnapshotFile(safePath), safePath) as T;
    },
  });
}

async function fetchCachedVerifiedBytes(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  label: string,
  maximumBytes: number,
  expectedSha256: string,
  expectedBytes: number | undefined,
  signal: AbortSignal | undefined,
  cache: Cache | undefined,
  cacheOnly: boolean,
): Promise<Uint8Array> {
  const cached = await matchRuntimeCache(cache, url, label, cacheOnly);
  if (cached !== undefined) {
    try {
      const bytes = await readResponseBytes(cached, label, maximumBytes);
      if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
        throw new Error(`${label}: cached byte length mismatch`);
      await verifyDigest(label, bytes, expectedSha256);
      return bytes;
    } catch (error) {
      console.warn({
        event: "duel.worker.runtime_cache.entry_invalid",
        label,
        err: error,
      });
      try {
        await cache?.delete(url);
      } catch (deleteError) {
        console.warn({
          event: "duel.worker.runtime_cache.delete_failed",
          label,
          err: deleteError,
        });
      }
    }
  }
  if (cacheOnly)
    throw new Error(`Cached fallback is missing verified ${label}`);
  const bytes = await fetchBytes(
    fetchImplementation,
    url,
    label,
    maximumBytes,
    signal,
  );
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
    throw new Error(
      `${label}: expected ${expectedBytes} bytes, found ${bytes.byteLength}`,
    );
  await verifyDigest(label, bytes, expectedSha256);
  try {
    await cache?.put(url, new Response(bytes.slice()));
  } catch (error) {
    console.warn({
      event: "duel.worker.runtime_cache.write_failed",
      label,
      err: error,
    });
  }
  return bytes;
}

async function matchRuntimeCache(
  cache: Cache | undefined,
  url: string,
  label: string,
  cacheOnly: boolean,
): Promise<Response | undefined> {
  try {
    return await cache?.match(url);
  } catch (error) {
    console.warn({
      event: "duel.worker.runtime_cache.read_failed",
      label,
      err: error,
    });
    if (cacheOnly)
      throw new Error(`Unable to read cached fallback ${label}`, {
        cause: error,
      });
    return undefined;
  }
}

async function fetchBytes(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  label: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchImplementation(url, {
    cache: "no-cache",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok)
    throw new Error(
      `Unable to load ${label}: HTTP ${response.status} ${response.statusText}`,
    );
  return readResponseBytes(response, label, maximumBytes);
}

async function readResponseBytes(
  response: Response,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`${label}: response exceeds ${maximumBytes} bytes`);
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes)
      throw new Error(`${label}: response exceeds ${maximumBytes} bytes`);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`${label}: response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function verifyDigest(
  label: string,
  bytes: Uint8Array,
  expected: string,
): Promise<void> {
  const actual = await sha256(bytes);
  if (actual !== expected) throw new Error(`${label}: SHA-256 mismatch`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`${label}: invalid JSON`, { cause: error });
  }
}

function parseVendorManifest(value: unknown): VendorManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Vendor manifest must be an object");
  const manifest = value as Readonly<Record<string, unknown>>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.package !== "ocgcore-wasm" ||
    manifest.version !== "0.1.2" ||
    typeof manifest.integrity !== "string" ||
    typeof manifest.embeddedCoreRevision !== "string" ||
    !Array.isArray(manifest.coreVersion) ||
    manifest.coreVersion.length !== 2 ||
    !manifest.coreVersion.every((part) => Number.isSafeInteger(part)) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Vendor manifest is invalid");
  }
  for (const file of manifest.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      Array.isArray(file) ||
      typeof file.path !== "string" ||
      !Number.isSafeInteger(file.bytes) ||
      typeof file.sha256 !== "string"
    ) {
      throw new Error("Vendor manifest contains an invalid file record");
    }
  }
  return manifest as unknown as VendorManifest;
}

function validateSnapshotBounds(files: readonly RuntimeManifestFile[]): void {
  if (files.length > MAXIMUM_SNAPSHOT_FILES)
    throw new Error(
      `Runtime snapshot declares too many files: ${files.length}`,
    );
  let total = 0;
  for (const file of files) {
    if (file.bytes > MAXIMUM_SNAPSHOT_FILE_BYTES)
      throw new Error(`Runtime snapshot file is too large: ${file.path}`);
    total += file.bytes;
    if (total > MAXIMUM_SNAPSHOT_BYTES)
      throw new Error("Runtime snapshot exceeds the maximum aggregate size");
  }
}

function requireSafeRuntimePath(value: string): string {
  if (!isSafeManifestPath(value))
    throw new Error(`Invalid browser runtime path: ${value}`);
  return value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
