import {
  snapshotId,
  type CardCode,
  type SnapshotId,
} from "../../duel/contracts/ids.ts";
import { resolveBrowserRuntimeUrl } from "../../worker/assets/browser-runtime-assets.ts";

const CACHE_PREFIX = "ygo-card-images-v1-";
const MAXIMUM_IMAGE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_IMAGE_DIMENSION = 4_096;
const MAXIMUM_IMAGE_PIXELS = 12_000_000;
const MAXIMUM_ACTIVE_IMAGES = 500;
const MAXIMUM_ACTIVE_MANIFEST_BYTES = 256 * 1024;
const PRELOAD_CONCURRENCY = 6;
const DEFAULT_IMAGE_TIMEOUT_MS = 10_000;

export interface ActiveImageManifestRecord {
  readonly code: number;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ActiveImageManifest {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly provider: "bundled-archive";
  readonly redistributionApproved: false;
  readonly files: readonly ActiveImageManifestRecord[];
  readonly missing: readonly number[];
}

export type CardImageDiagnosticStatus =
  "cache-hit" | "cache-miss" | "missing" | "invalid";

export interface CardImageDiagnostic {
  readonly code: number;
  readonly status: CardImageDiagnosticStatus;
  readonly source: string;
  readonly detail?: string;
}

export interface CardImageLibrary {
  readonly snapshotId: SnapshotId;
  readonly imageManifestSha256: string;
  readonly provider: "bundled-archive";
  readonly urls: ReadonlyMap<number, string>;
  readonly cardBackUrl: string;
  readonly placeholderUrl: string;
  readonly diagnostics: readonly CardImageDiagnostic[];
  urlFor(code: CardCode | number | undefined, hidden?: boolean): string;
  dispose(): void;
}

export interface CardImageCacheOptions {
  readonly applicationBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly cacheStorage?: CacheStorage;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly decodeImage?: (blob: Blob) => Promise<void>;
  readonly imageTimeoutMs?: number;
}

export function createPlaceholderCardImageLibrary(
  manifest: ActiveImageManifest,
  expectedManifestSha256: string,
  detail: string,
): CardImageLibrary {
  const cardBackUrl = svgDataUrl("Card back", "#241037", "#d9a441", "#6f2d62");
  const placeholderUrl = svgDataUrl(
    "Image unavailable",
    "#172033",
    "#76839a",
    "#27344d",
  );
  const diagnostics: CardImageDiagnostic[] = [
    ...manifest.files.map(({ code, path }) => ({
      code,
      status: "missing" as const,
      source: path,
      detail,
    })),
    ...manifest.missing.map((code) => ({
      code,
      status: "missing" as const,
      source: "active-image-manifest",
      detail,
    })),
  ];
  return Object.freeze({
    snapshotId: snapshotId(manifest.snapshotId),
    imageManifestSha256: expectedManifestSha256,
    provider: "bundled-archive" as const,
    urls: new Map<number, string>(),
    cardBackUrl,
    placeholderUrl,
    diagnostics: Object.freeze(diagnostics),
    urlFor(_code: CardCode | number | undefined, hidden = false): string {
      return hidden ? cardBackUrl : placeholderUrl;
    },
    dispose(): void {
      // Data-URL placeholders do not retain external resources.
    },
  });
}

export class CardImageCache {
  readonly #applicationBaseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #cacheStorage?: CacheStorage;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #decodeImage: (blob: Blob) => Promise<void>;
  readonly #imageTimeoutMs: number;
  readonly #pending = new Map<string, Promise<Uint8Array>>();

  constructor(options: CardImageCacheOptions) {
    this.#applicationBaseUrl = options.applicationBaseUrl;
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (fetchImplementation === undefined)
      throw new Error("Browser fetch is unavailable");
    this.#fetch = (...arguments_) => fetchImplementation(...arguments_);
    this.#cacheStorage = options.cacheStorage ?? globalThis.caches;
    this.#createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.#decodeImage = options.decodeImage ?? defaultDecodeImage;
    this.#imageTimeoutMs = options.imageTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#imageTimeoutMs) ||
      this.#imageTimeoutMs <= 0
    )
      throw new Error("Card image timeout must be a positive integer");
  }

  async preloadCachedSnapshot(
    expectedSnapshotId: string,
    expectedManifestSha256: string,
    onProgress: (completed: number, total: number) => void = () => undefined,
    signal?: AbortSignal,
  ): Promise<CardImageLibrary> {
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshotId))
      throw new Error("Cached image snapshot ID is invalid");
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256))
      throw new Error("Cached image manifest digest is invalid");
    const cache = await this.#cacheStorage?.open(
      `${CACHE_PREFIX}${expectedSnapshotId}-${expectedManifestSha256}`,
    );
    const source = resolveBrowserRuntimeUrl(
      this.#applicationBaseUrl,
      "images/active-manifest.json",
    );
    const response = await cache?.match(source);
    if (response === undefined)
      throw new Error("Cached fallback image manifest is unavailable");
    const bytes = await responseBytes(
      response,
      MAXIMUM_ACTIVE_MANIFEST_BYTES,
      signal,
    );
    if ((await sha256(bytes)) !== expectedManifestSha256)
      throw new Error("Cached fallback image manifest digest mismatch");
    const manifest = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as ActiveImageManifest;
    validateActiveImageManifest(manifest);
    if (manifest.snapshotId !== expectedSnapshotId)
      throw new Error("Cached fallback image snapshot ID mismatch");
    return this.preload(
      manifest,
      expectedManifestSha256,
      onProgress,
      signal,
      true,
    );
  }

  async preload(
    manifest: ActiveImageManifest,
    expectedManifestSha256: string,
    onProgress: (completed: number, total: number) => void = () => undefined,
    signal?: AbortSignal,
    cacheOnly = false,
  ): Promise<CardImageLibrary> {
    validateActiveImageManifest(manifest);
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256))
      throw new Error("Active image manifest digest is invalid");
    const manifestBytes = new TextEncoder().encode(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if ((await sha256(manifestBytes)) !== expectedManifestSha256)
      throw new Error("Active image manifest digest mismatch");
    signal?.throwIfAborted();

    const cacheName = `${CACHE_PREFIX}${manifest.snapshotId}-${expectedManifestSha256}`;
    let cache: Cache | undefined;
    let cacheDetail: string | undefined;
    try {
      cache = await this.#cacheStorage?.open(cacheName);
      if (!cacheOnly)
        await cache?.put(
          resolveBrowserRuntimeUrl(
            this.#applicationBaseUrl,
            "images/active-manifest.json",
          ),
          new Response(copyArrayBuffer(manifestBytes), {
            headers: { "content-type": "application/json" },
          }),
        );
    } catch (error) {
      cacheDetail = describeError("Image cache is unavailable", error);
    }
    const orderedRecords = [...manifest.files].sort(
      (left, right) => left.code - right.code,
    );
    const urls = new Map<number, string>();
    const objectUrls: string[] = [];
    const diagnostics: CardImageDiagnostic[] = manifest.missing.map((code) => ({
      code,
      status: "missing",
      source: "active-image-manifest",
      detail: "No approved active image is packaged for this card",
    }));
    let nextIndex = 0;
    let completed = manifest.missing.length;
    const total = orderedRecords.length + manifest.missing.length;
    if (completed > 0) onProgress(completed, total);

    const workers = Array.from(
      {
        length: Math.min(
          PRELOAD_CONCURRENCY,
          Math.max(orderedRecords.length, 1),
        ),
      },
      async () => {
        while (nextIndex < orderedRecords.length) {
          signal?.throwIfAborted();
          const index = nextIndex;
          nextIndex += 1;
          const record = orderedRecords[index];
          if (record === undefined) continue;
          const source = resolveBrowserRuntimeUrl(
            this.#applicationBaseUrl,
            `images/${record.path}`,
          );
          try {
            const { bytes, status } = await this.#loadVerifiedBytes(
              source,
              record,
              expectedManifestSha256,
              cache,
              signal,
              cacheOnly,
            );
            const blob = new Blob([copyArrayBuffer(bytes)], {
              type: "image/jpeg",
            });
            try {
              await this.#decodeImage(blob);
            } catch (error) {
              if (status === "cache-hit") {
                try {
                  await cache?.delete(source);
                } catch (deleteError) {
                  console.warn({
                    event: "duel.image_cache.decode_evict_failed",
                    source,
                    err: deleteError,
                  });
                }
              }
              throw error;
            }
            signal?.throwIfAborted();
            let detail: string | undefined;
            if (status === "cache-miss") {
              try {
                await cache?.put(
                  source,
                  new Response(bytes.slice(), {
                    headers: { "content-type": "image/jpeg" },
                  }),
                );
              } catch (error) {
                detail = describeError("Image cache write failed", error);
              }
            }
            const objectUrl = this.#createObjectUrl(blob);
            objectUrls.push(objectUrl);
            urls.set(record.code, objectUrl);
            diagnostics.push({
              code: record.code,
              status,
              source,
              ...(detail === undefined && cacheDetail === undefined
                ? {}
                : { detail: [cacheDetail, detail].filter(Boolean).join("; ") }),
            });
          } catch (error) {
            if (signal?.aborted) throw signal.reason;
            diagnostics.push({
              code: record.code,
              status:
                error instanceof InvalidCardImageError ? "invalid" : "missing",
              source,
              detail: error instanceof Error ? error.message : String(error),
            });
          }
          completed += 1;
          onProgress(completed, total);
        }
      },
    );
    try {
      await Promise.all(workers);
      signal?.throwIfAborted();
    } catch (error) {
      objectUrls.forEach(this.#revokeObjectUrl);
      throw error;
    }

    const cardBackUrl = svgDataUrl(
      "Card back",
      "#241037",
      "#d9a441",
      "#6f2d62",
    );
    const placeholderUrl = svgDataUrl(
      "Image unavailable",
      "#172033",
      "#76839a",
      "#27344d",
    );
    let disposed = false;
    return Object.freeze({
      snapshotId: snapshotId(manifest.snapshotId),
      imageManifestSha256: expectedManifestSha256,
      provider: "bundled-archive" as const,
      urls,
      cardBackUrl,
      placeholderUrl,
      diagnostics: Object.freeze(diagnostics),
      urlFor(code: CardCode | number | undefined, hidden = false): string {
        if (hidden || code === undefined) return cardBackUrl;
        return urls.get(Number(code)) ?? placeholderUrl;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        objectUrls.forEach(this.#revokeObjectUrl);
        objectUrls.length = 0;
        urls.clear();
      },
    });
  }

  async #loadVerifiedBytes(
    source: string,
    record: ActiveImageManifestRecord,
    manifestSha256: string,
    cache: Cache | undefined,
    signal: AbortSignal | undefined,
    cacheOnly: boolean,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly status: "cache-hit" | "cache-miss";
  }> {
    let cached: Response | undefined;
    try {
      cached = await cache?.match(source);
    } catch (error) {
      console.warn({
        event: "duel.image_cache.read_failed",
        source,
        err: error,
      });
    }
    if (cached !== undefined) {
      try {
        const bytes = await responseBytes(cached, record.bytes, signal);
        await verifyImageBytes(bytes, record);
        return { bytes, status: "cache-hit" };
      } catch (error) {
        console.warn({
          event: "duel.image_cache.entry_invalid",
          source,
          err: error,
        });
        try {
          await cache?.delete(source);
        } catch (deleteError) {
          console.warn({
            event: "duel.image_cache.delete_failed",
            source,
            err: deleteError,
          });
        }
      }
    }

    if (cacheOnly)
      throw new Error(`Cached fallback image is unavailable: ${record.code}`);

    const pendingKey = `${manifestSha256}:${source}`;
    let pending = this.#pending.get(pendingKey);
    if (pending === undefined) {
      pending = this.#fetchAndVerify(source, record, undefined);
      this.#pending.set(pendingKey, pending);
      void pending.then(
        () => this.#pending.delete(pendingKey),
        () => this.#pending.delete(pendingKey),
      );
    }
    return {
      bytes: (await withAbortSignal(pending, signal)).slice(),
      status: "cache-miss",
    };
  }

  async #fetchAndVerify(
    source: string,
    record: ActiveImageManifestRecord,
    parentSignal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const abortController = new AbortController();
    const abort = (): void => abortController.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        abortController.abort(
          new DOMException("Image request timed out", "TimeoutError"),
        ),
      this.#imageTimeoutMs,
    );
    try {
      const response = await this.#fetch(source, {
        cache: "no-store",
        signal: abortController.signal,
      });
      if (!response.ok)
        throw new Error(`Image request failed with HTTP ${response.status}`);
      const bytes = await responseBytes(
        response,
        Math.min(record.bytes, MAXIMUM_IMAGE_BYTES),
        abortController.signal,
      );
      await verifyImageBytes(bytes, record);
      return bytes;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
  }
}

class InvalidCardImageError extends Error {}

function validateActiveImageManifest(manifest: ActiveImageManifest): void {
  requireExactKeys(
    manifest,
    [
      "schemaVersion",
      "snapshotId",
      "provider",
      "redistributionApproved",
      "files",
      "missing",
    ],
    "Active image manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.snapshotId) ||
    manifest.provider !== "bundled-archive" ||
    manifest.redistributionApproved !== false ||
    !isDenseArray(manifest.files) ||
    !isDenseArray(manifest.missing) ||
    manifest.files.length + manifest.missing.length > MAXIMUM_ACTIVE_IMAGES
  )
    throw new Error("Active image manifest is invalid");
  const codes = new Set<number>();
  const paths = new Set<string>();
  for (const record of manifest.files) {
    requireExactKeys(
      record,
      ["code", "path", "bytes", "sha256"],
      "Active image record",
    );
    if (
      !Number.isSafeInteger(record.code) ||
      record.code <= 0 ||
      record.path !== `${record.code}.jpg` ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes <= 0 ||
      record.bytes > MAXIMUM_IMAGE_BYTES ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      record.path.length > 128 ||
      codes.has(record.code) ||
      paths.has(record.path)
    )
      throw new Error("Active image manifest contains an invalid file record");
    codes.add(record.code);
    paths.add(record.path);
  }
  for (const code of manifest.missing) {
    if (!Number.isSafeInteger(code) || code <= 0 || codes.has(code))
      throw new Error("Active image manifest contains an invalid missing code");
    codes.add(code);
  }
}

function requireExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.join("\n") !== sortedExpected.join("\n"))
    throw new Error(`${label} has unknown or missing fields`);
}

function isDenseArray(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) &&
    Object.keys(value).length === value.length &&
    value.every((_entry, index) => Object.hasOwn(value, index))
  );
}

function withAbortSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function responseBytes(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw new InvalidCardImageError("Card image exceeds its declared size");
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted();
  if (bytes.byteLength > maximumBytes)
    throw new InvalidCardImageError("Card image exceeds its declared size");
  return bytes;
}

async function verifyImageBytes(
  bytes: Uint8Array,
  record: ActiveImageManifestRecord,
): Promise<void> {
  if (bytes.byteLength !== record.bytes)
    throw new InvalidCardImageError(
      `Card ${record.code} image length does not match its manifest`,
    );
  if ((await sha256(bytes)) !== record.sha256)
    throw new InvalidCardImageError(
      `Card ${record.code} image digest does not match its manifest`,
    );
  const { width, height } = jpegDimensions(bytes, record.code);
  if (
    width > MAXIMUM_IMAGE_DIMENSION ||
    height > MAXIMUM_IMAGE_DIMENSION ||
    width * height > MAXIMUM_IMAGE_PIXELS
  )
    throw new InvalidCardImageError(
      `Card ${record.code} image dimensions are unsafe`,
    );
}

function jpegDimensions(
  bytes: Uint8Array,
  code: number,
): { readonly width: number; readonly height: number } {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new InvalidCardImageError(`Card ${code} image is not a JPEG`);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) break;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width > 0 && height > 0) return { width, height };
      break;
    }
    offset += length;
  }
  throw new InvalidCardImageError(`Card ${code} JPEG dimensions are invalid`);
}

async function defaultDecodeImage(blob: Blob): Promise<void> {
  if (typeof globalThis.createImageBitmap !== "function") return;
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > MAXIMUM_IMAGE_DIMENSION ||
      bitmap.height > MAXIMUM_IMAGE_DIMENSION ||
      bitmap.width * bitmap.height > MAXIMUM_IMAGE_PIXELS
    )
      throw new InvalidCardImageError(
        "Decoded card image dimensions are unsafe",
      );
  } finally {
    bitmap.close();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyArrayBuffer(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function describeError(prefix: string, error: unknown): string {
  return error instanceof Error ? `${prefix}: ${error.message}` : prefix;
}

function svgDataUrl(
  label: string,
  background: string,
  foreground: string,
  accent: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260" viewBox="0 0 180 260"><rect width="180" height="260" rx="10" fill="${background}"/><rect x="10" y="10" width="160" height="240" rx="7" fill="none" stroke="${foreground}" stroke-width="5"/><path d="M30 130c30-70 90-70 120 0-30 70-90 70-120 0Z" fill="${accent}" stroke="${foreground}" stroke-width="4"/><text x="90" y="226" fill="${foreground}" text-anchor="middle" font-family="sans-serif" font-size="12">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
