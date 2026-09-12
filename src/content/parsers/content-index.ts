import type { ContentIndex } from "../contracts/content-index.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import {
  array,
  chapterId,
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
  unique,
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
      schemaVersion: literal(v.schemaVersion, 2),
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
              ? ["id", "title", "description", "status", "manifest"]
              : ["id", "title", "description", "status"],
          );
          const id = chapterId(c.id);
          const title = text(c.title);
          const description = text(c.description);
          if (status === "published") {
            const manifest = manifestRef(c.manifest);
            if (manifest.packId !== id) invalid();
            return {
              id,
              title,
              description,
              status: "published" as const,
              manifest,
            };
          }
          return {
            id,
            title,
            description,
            status: literal(c.status, "unreleased"),
          };
        },
        99,
      ),
      retainedCatalogs: array(v.retainedCatalogs, (value) => {
        const c = record(value, ["sha256", "bytes"]);
        return { sha256: hash(c.sha256), bytes: integer(c.bytes, 1048576, 1) };
      }),
      retainedManifests: array(v.retainedManifests, manifestRef),
    };
    if (index.runtime.packId !== "runtime" || index.chapters.length === 0)
      invalid();
    unique(index.chapters, (chapter) => chapter.id);
    sorted(index.retainedCatalogs, (a, b) => compare(a.sha256, b.sha256));
    sorted(
      index.retainedManifests,
      (a, b) => compare(a.sha256, b.sha256) || compare(a.packId, b.packId),
    );
    return index;
  });
}
