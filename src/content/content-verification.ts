import type { ContentFailure } from "./contracts/content-failure.ts";
import type { ContentFailureCode } from "./contracts/content-failure-code.ts";
import type { ContentResult } from "./contracts/content-result.ts";
import { parseContentFailure } from "./parsers/content-failure.ts";

export function failure(code: ContentFailureCode): ContentFailure {
  return { kind: "failed", code, packId: null, path: null };
}
export function unwrap<T>(result: ContentResult<T>): T {
  if (result.kind === "failed") throw result;
  return result.value;
}
export function contentError(error: unknown): ContentFailure {
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    error.kind === "failed"
  )
    return parseContentFailure(error);
  return failure(
    error instanceof DOMException && error.name === "QuotaExceededError"
      ? "CONTENT_QUOTA_EXCEEDED"
      : "CONTENT_STORAGE_UNAVAILABLE",
  );
}
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifyBytes(
  bytes: Uint8Array,
  ref: { readonly sha256: string; readonly bytes: number },
): Promise<void> {
  if (bytes.byteLength !== ref.bytes || (await digest(bytes)) !== ref.sha256)
    throw failure("CONTENT_INTEGRITY_FAILED");
}
export async function readCachedBytes(
  response: Response,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 0 ||
    expectedBytes > 16777216 ||
    !response.body
  )
    throw failure("CONTENT_INTEGRITY_FAILED");
  const bytes = new Uint8Array(expectedBytes);
  const body = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await body.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > expectedBytes) throw failure("CONTENT_INTEGRITY_FAILED");
      bytes.set(chunk.value, size - chunk.value.length);
    }
    if (size !== expectedBytes) throw failure("CONTENT_INTEGRITY_FAILED");
    return bytes;
  } catch (error) {
    try {
      await body.cancel();
    } catch {
      console.warn("CONTENT_RESPONSE_CANCEL_FAILED");
    }
    throw error;
  } finally {
    body.releaseLock();
  }
}
export function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw failure("CONTENT_INVALID_MANIFEST");
  }
}
export function same(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)]),
      );
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
export async function activationId(
  runtimeSnapshotId: string,
  releaseCatalogSha256: string,
): Promise<string> {
  return digest(
    new TextEncoder().encode(
      JSON.stringify({ runtimeSnapshotId, releaseCatalogSha256 }),
    ),
  );
}
