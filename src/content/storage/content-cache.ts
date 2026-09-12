import type { ManifestRef } from "../contracts/manifest-ref.ts";
import { hash, safePath } from "../parsers/schema.ts";
import { failure } from "../content-verification.ts";

export const STAGING_CACHE_NAME = "ygo-content-staging-v1";
export function applicationBase(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href;
}
export function fileKey(ref: ManifestRef, path: string): string {
  try {
    hash(ref.sha256);
    safePath(path);
  } catch {
    throw failure("CONTENT_INVALID_MANIFEST");
  }
  return `${applicationBase()}__content/files/${ref.sha256}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function partKey(jobId: string, sha256: string): string {
  if (!/^[a-f0-9-]{36}$/.test(jobId) || !/^[a-f0-9]{64}$/.test(sha256))
    throw failure("CONTENT_INVALID_MANIFEST");
  return `${applicationBase()}__content/staging/${jobId}/parts/${sha256}`;
}
