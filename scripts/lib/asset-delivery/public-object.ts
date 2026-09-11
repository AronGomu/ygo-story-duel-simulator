import { createHash } from "node:crypto";
import type { AssetDeliveryConfig } from "./config.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import type { ObjectRef } from "./object-ref.ts";
import { parseSetupOrigin } from "./setup-options.ts";

const IMMUTABLE_CACHE_DIRECTIVES = new Set([
  "public",
  "max-age=31536000",
  "immutable",
]);

function hasImmutableCacheControl(value: string | null): boolean {
  if (value === null) return false;
  const directives = value
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  return (
    directives.length === IMMUTABLE_CACHE_DIRECTIVES.size &&
    directives.every((directive) => IMMUTABLE_CACHE_DIRECTIVES.has(directive))
  );
}

/** Browser-equivalent anonymous GET integrity/CORS/cache check before commit. */
export async function verifyPublicObject(
  config: AssetDeliveryConfig,
  ref: ObjectRef,
  expectedOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
    const origin = parseSetupOrigin(expectedOrigin);
    const response = await fetcher(`${config.publicBaseUrl}${ref.key}`, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { "cache-control": "no-store", origin },
      signal: AbortSignal.timeout(120_000),
    });
    if (
      !response.ok ||
      response.url !== `${config.publicBaseUrl}${ref.key}` ||
      response.headers.get("access-control-allow-origin") !== origin
    ) {
      await response.body?.cancel();
      fail("ASSET_NETWORK_FAILED", ref.key);
    }
    if (!hasImmutableCacheControl(response.headers.get("cache-control"))) {
      await response.body?.cancel();
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    }
    const declared = response.headers.get("content-length");
    if (
      declared === null ||
      !/^\d+$/.test(declared) ||
      Number(declared) !== ref.bytes
    ) {
      await response.body?.cancel();
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    }
    if (!response.body) fail("ASSET_NETWORK_FAILED", ref.key);
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > ref.bytes) {
          await reader.cancel();
          fail("ASSET_INTEGRITY_FAILED", ref.key);
        }
        digest.update(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (bytes !== ref.bytes || digest.digest("hex") !== ref.sha256)
      fail("ASSET_INTEGRITY_FAILED", ref.key);
  } catch (error) {
    if (error instanceof AssetDeliveryError) throw error;
    fail("ASSET_NETWORK_FAILED", ref.key);
  }
}
