import type { Sha256 } from "./contracts/sha256.ts";

/** Network only. Cache Storage synthetic keys remain same-origin. */
export function contentObjectUrl(
  baseUrl: string,
  kind: "indexes" | "catalogs" | "manifests" | "parts",
  sha256: Sha256,
): string {
  if (
    typeof baseUrl !== "string" ||
    !/^https:\/\//.test(baseUrl) ||
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
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href !== baseUrl ||
    url.pathname
      .slice(1, -1)
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  )
    throw new Error("CONTENT_INVALID_MANIFEST");
  return `${baseUrl}content/${kind}/${sha256}.${kind === "parts" ? "zip" : "json"}`;
}
