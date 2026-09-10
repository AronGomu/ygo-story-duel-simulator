import type { ContentIndex } from "../contracts/content-index.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import {
  array,
  compare,
  hash,
  integer,
  invalid,
  literal,
  manifestRef,
  record,
  result,
  sorted,
  text,
} from "./schema.ts";

export function parseContentIndex(value: unknown): ContentResult<ContentIndex> {
  return result(value, 1048576, (value) => {
    const v = record(value, [
      "schemaVersion",
      "releaseId",
      "runtimeSnapshotId",
      "runtime",
      "chapters",
      "retainedCatalogs",
      "retainedManifests",
    ]);
    const index: ContentIndex = {
      schemaVersion: literal(v.schemaVersion, 1),
      releaseId: text(v.releaseId),
      runtimeSnapshotId: hash(v.runtimeSnapshotId),
      runtime: manifestRef(v.runtime),
      chapters: array(
        v.chapters,
        (value) => {
          const status =
            value && typeof value === "object" && "status" in value
              ? value.status
              : undefined;
          const c = record(
            value,
            status === "published"
              ? ["id", "title", "status", "manifest"]
              : ["id", "title", "status"],
          );
          const id = literal(c.id, "chapter-01");
          const title = text(c.title);
          if (status === "published") {
            const manifest = manifestRef(c.manifest);
            if (manifest.packId !== id) invalid();
            return { id, title, status: "published" as const, manifest };
          }
          return { id, title, status: literal(c.status, "unreleased") };
        },
        1,
      ),
      retainedCatalogs: array(v.retainedCatalogs, (value) => {
        const c = record(value, ["sha256", "bytes"]);
        return { sha256: hash(c.sha256), bytes: integer(c.bytes, 1048576, 1) };
      }),
      retainedManifests: array(v.retainedManifests, manifestRef),
    };
    if (index.runtime.packId !== "runtime" || index.chapters.length !== 1)
      invalid();
    sorted(index.retainedCatalogs, (a, b) => compare(a.sha256, b.sha256));
    sorted(
      index.retainedManifests,
      (a, b) => compare(a.sha256, b.sha256) || compare(a.packId, b.packId),
    );
    return index;
  });
}
