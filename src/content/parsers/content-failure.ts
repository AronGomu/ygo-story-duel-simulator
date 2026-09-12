import type { ContentFailure } from "../contracts/content-failure.ts";
import type { ContentFailureCode } from "../contracts/content-failure-code.ts";
import { literal, packId, record, result, safePath } from "./schema.ts";

const codes: Readonly<Record<ContentFailureCode, true>> = {
  CONTENT_INVALID_MANIFEST: true,
  CONTENT_INCOMPATIBLE: true,
  CONTENT_NOT_PUBLISHED: true,
  CONTENT_NETWORK_FAILED: true,
  CONTENT_REVISION_UNAVAILABLE: true,
  CONTENT_INTEGRITY_FAILED: true,
  CONTENT_ARCHIVE_REJECTED: true,
  CONTENT_QUOTA_EXCEEDED: true,
  CONTENT_STORAGE_UNAVAILABLE: true,
  CONTENT_BUSY: true,
  CONTENT_ACTIVATION_CONFLICT: true,
  CONTENT_DEPENDANTS_INSTALLED: true,
  CONTENT_IN_USE: true,
  CONTENT_MISSING: true,
};

/** Persisted failures are untrusted records, not exceptions or display copy. */
export function parseContentFailure(value: unknown): ContentFailure {
  const parsed = result(value, 2048, (value): ContentFailure => {
    const v = record(value, ["kind", "code", "packId", "path"]);
    return {
      kind: literal(v.kind, "failed"),
      code: literal(v.code, ...(Object.keys(codes) as ContentFailureCode[])),
      packId: v.packId === null ? null : packId(v.packId),
      path: v.path === null ? null : safePath(v.path),
    };
  });
  return parsed.kind === "ok"
    ? parsed.value
    : {
        kind: "failed",
        code: "CONTENT_INTEGRITY_FAILED",
        packId: null,
        path: null,
      };
}
