export interface AssetDeliveryConfig {
  readonly schemaVersion: 1;
  readonly publicBaseUrl: string;
  readonly bucket: string;
  readonly keyPrefix: "ascencio-assets/v1/";
}

import { object, text, version, literal } from "./schema.ts";
import { fail } from "./failure.ts";

export function parseAssetDeliveryConfig(value: unknown): AssetDeliveryConfig {
  const config = object(value, {
    schemaVersion: version,
    publicBaseUrl: text,
    bucket: text,
    keyPrefix: literal("ascencio-assets/v1/"),
  });
  let url: URL;
  try {
    url = new URL(config.publicBaseUrl);
  } catch (error) {
    if (error instanceof TypeError) fail();
    throw error;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    url.pathname !== `/${config.keyPrefix}` ||
    url.href !== config.publicBaseUrl ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(
      url.hostname,
    ) ||
    /\.(?:r2\.dev|r2\.cloudflarestorage\.com)$/.test(url.hostname)
  )
    fail();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)) fail();
  return config;
}
