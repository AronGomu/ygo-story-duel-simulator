import type { ContentFailureCode } from "../../content/index.ts";

export function contentErrorCopy(code: ContentFailureCode): string {
  switch (code) {
    case "CONTENT_INVALID_MANIFEST":
    case "CONTENT_INTEGRITY_FAILED":
    case "CONTENT_ARCHIVE_REJECTED":
    case "CONTENT_INCOMPATIBLE":
      return "Content verification failed. Retry installation.";
    case "CONTENT_NETWORK_FAILED":
      return "Download failed. Check connection, then retry.";
    case "CONTENT_QUOTA_EXCEEDED":
      return "Not enough storage. Free space, then retry.";
    case "CONTENT_NOT_PUBLISHED":
      return "Content is not available for this release.";
    case "CONTENT_BUSY":
    case "CONTENT_ACTIVATION_CONFLICT":
      return "Content changed in another tab. Refresh status.";
    case "CONTENT_IN_USE":
    case "CONTENT_DEPENDANTS_INSTALLED":
      return "Content is still required. Close sessions or remove dependent content first.";
    case "CONTENT_STORAGE_UNAVAILABLE":
      return "Browser storage is unavailable. CORE remains usable.";
    case "CONTENT_MISSING":
    case "CONTENT_REVISION_UNAVAILABLE":
      return "Required content is missing. Reinstall this revision.";
    default:
      return "Content verification failed. Retry installation.";
  }
}
