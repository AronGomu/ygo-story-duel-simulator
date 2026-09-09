import { HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { parseSetupOrigin } from "./setup-options.ts";
import type { AssetDeliveryConfig } from "./config.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import { MAX_METADATA_BYTES, parseJsonBytes } from "./canonical-json.ts";
import { parsePublicationInventory } from "./publication-inventory.ts";

export type SetupReadCommand = HeadBucketCommand | ListObjectsV2Command;
export type SetupReadSender = (command: SetupReadCommand) => Promise<unknown>;
const EXPOSED = ["content-length", "etag", "content-range", "accept-ranges"];

async function boundedBody(response: Response): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_METADATA_BYTES)
  ) {
    await response.body?.cancel();
    fail("ASSET_LIMIT_EXCEEDED");
  }
  if (!response.body) fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_METADATA_BYTES) {
        await reader.cancel();
        fail("ASSET_LIMIT_EXCEEDED");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

/** No mutation commands accepted; injectable third-party boundaries for offline tests. */
export async function probeAssetSetup(
  config: AssetDeliveryConfig,
  origins: readonly string[],
  fetcher: typeof fetch,
  send: SetupReadSender,
): Promise<void> {
  const parsed = parseAssetDeliveryConfig(config);
  if (!origins.length || origins.length > 10) fail("ASSET_ARGUMENT_INVALID");
  const checkedOrigins = origins.map(parseSetupOrigin);
  if (new Set(checkedOrigins).size !== checkedOrigins.length)
    fail("ASSET_ARGUMENT_INVALID");
  try {
    await send(new HeadBucketCommand({ Bucket: parsed.bucket }));
    await send(
      new ListObjectsV2Command({
        Bucket: parsed.bucket,
        Prefix: parsed.keyPrefix,
        MaxKeys: 1,
      }),
    );
    const url = `${parsed.publicBaseUrl}channels/index.json`;
    for (const origin of [null, ...checkedOrigins]) {
      for (const method of ["HEAD", "GET"]) {
        const response = await fetcher(url, {
          method,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          headers: {
            "cache-control": "no-store",
            ...(origin === null ? {} : { origin }),
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          fail(
            response.status === 404
              ? "ASSET_REFERENCE_MISSING"
              : "ASSET_NETWORK_FAILED",
            "channels/index.json",
          );
        }
        if (
          origin !== null &&
          (response.headers.get("access-control-allow-origin") !== origin ||
            !EXPOSED.every((h) =>
              (response.headers.get("access-control-expose-headers") ?? "")
                .toLowerCase()
                .split(",")
                .map((s) => s.trim())
                .includes(h),
            ))
        ) {
          await response.body?.cancel();
          fail();
        }
        if (method === "GET")
          parsePublicationInventory(
            parseJsonBytes(await boundedBody(response)),
          );
        else await response.body?.cancel();
      }
    }
  } catch (error) {
    if (error instanceof AssetDeliveryError) throw error;
    // SDK/fetch exceptions can contain credentials, URLs, or provider response bodies.
    fail("ASSET_NETWORK_FAILED");
  }
}
