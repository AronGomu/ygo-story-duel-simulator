import { contentObjectUrl } from "../content-object-url.ts";
import { applicationBase } from "../storage/content-cache.ts";
import { failure, verifyBytes } from "../content-verification.ts";

export async function fetchVerified(
  baseUrl: string,
  kind: "indexes" | "manifests" | "parts",
  ref: { readonly sha256: string; readonly bytes: number },
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<Uint8Array> {
  const max =
    kind === "indexes" ? 1048576 : kind === "manifests" ? 4194304 : 20971520;
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > max)
    throw failure("CONTENT_INVALID_MANIFEST");
  const url = contentObjectUrl(baseUrl, kind, ref.sha256, applicationBase());
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    signal.throwIfAborted();
    throw failure("CONTENT_NETWORK_FAILED");
  }
  if (!response.ok || response.redirected || !response.body)
    throw failure("CONTENT_NETWORK_FAILED");
  const body = response.body.getReader();
  const bytes = new Uint8Array(ref.bytes);
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await body.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > bytes.length) throw failure("CONTENT_INTEGRITY_FAILED");
      bytes.set(chunk.value, size - chunk.value.length);
      onBytes(size);
    }
  } catch (error) {
    try {
      await body.cancel();
    } catch {
      console.warn("CONTENT_RESPONSE_CANCEL_FAILED");
    }
    signal.throwIfAborted();
    if (error && typeof error === "object" && "kind" in error) throw error;
    throw failure("CONTENT_NETWORK_FAILED");
  } finally {
    body.releaseLock();
  }
  if (size !== bytes.length) throw failure("CONTENT_INTEGRITY_FAILED");
  await verifyBytes(bytes, ref);
  return bytes;
}
