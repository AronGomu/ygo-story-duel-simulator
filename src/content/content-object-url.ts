import type { Sha256 } from "./contracts/sha256.ts";

/** Network only. Cache Storage synthetic keys remain same-origin. */
export function contentObjectUrl(
  baseUrl: string,
  kind: "indexes" | "catalogs" | "manifests" | "parts",
  sha256: Sha256,
  applicationBaseUrl = baseUrl,
): string {
  if (
    typeof baseUrl !== "string" ||
    typeof applicationBaseUrl !== "string" ||
    !baseUrl.endsWith("/") ||
    /[\\%?#\s\p{Cc}]/u.test(baseUrl) ||
    !["indexes", "catalogs", "manifests", "parts"].includes(kind) ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new Error("CONTENT_INVALID_MANIFEST");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new Error("CONTENT_INVALID_MANIFEST");
    throw error;
  }
  let application: URL;
  try {
    application = new URL(applicationBaseUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new Error("CONTENT_INVALID_MANIFEST");
    throw error;
  }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const secure = url.protocol === "https:";
  const local =
    url.protocol === "http:" &&
    application.protocol === "http:" &&
    loopback.has(url.hostname) &&
    loopback.has(application.hostname) &&
    url.origin === application.origin;
  if (
    (!secure && !local) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href !== baseUrl ||
    /[\\%?#\s\p{Cc}]/u.test(baseUrl) ||
    url.pathname
      .slice(1, -1)
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  )
    throw new Error("CONTENT_INVALID_MANIFEST");
  return `${baseUrl}content/${kind}/${sha256}.${kind === "parts" ? "zip" : "json"}`;
}
