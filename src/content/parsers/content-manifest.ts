import type { ContentManifest } from "../contracts/content-manifest.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import {
  ZIP_PART_MAX_BYTES,
  ZIP_PART_MAX_UNPACKED_BYTES,
  CONTENT_FILE_MAX_BYTES,
} from "../content-constants.ts";
import {
  array,
  codes,
  compare,
  hash,
  integer,
  invalid,
  literal,
  manifestRef,
  paths,
  record,
  result,
  safePath,
  sorted,
  strings,
  unique,
} from "./schema.ts";

export function parseContentManifest(
  value: unknown,
): ContentResult<ContentManifest> {
  return result(value, 4194304, (value) => {
    const v = record(value, [
      "schemaVersion",
      "packId",
      "runtimeSnapshotId",
      "storyContentId",
      "dependencies",
      "cardCodes",
      "opponentIds",
      "parts",
      "files",
    ]);
    const manifest: ContentManifest = {
      schemaVersion: literal(v.schemaVersion, 1),
      packId: literal(v.packId, "runtime", "chapter-01"),
      runtimeSnapshotId: hash(v.runtimeSnapshotId),
      storyContentId: literal(v.storyContentId, "prototype-prologue-v1", null),
      dependencies: array(v.dependencies, manifestRef, 1),
      cardCodes: codes(v.cardCodes),
      opponentIds: strings(v.opponentIds),
      parts: array(v.parts, (value) => {
        const p = record(value, ["sha256", "bytes", "unpackedBytes"]);
        return {
          sha256: hash(p.sha256),
          bytes: integer(p.bytes, ZIP_PART_MAX_BYTES, 1),
          unpackedBytes: integer(p.unpackedBytes, ZIP_PART_MAX_UNPACKED_BYTES),
        };
      }),
      files: array(v.files, (value) => {
        const f = record(value, [
          "path",
          "bytes",
          "sha256",
          "mediaType",
          "partSha256",
          "entry",
        ]);
        const path = safePath(f.path);
        if (/\.(?:js|mjs|cjs|html?|xhtml)$/i.test(path)) invalid();
        return {
          path,
          bytes: integer(f.bytes, CONTENT_FILE_MAX_BYTES),
          sha256: hash(f.sha256),
          mediaType: literal(
            f.mediaType,
            "application/json",
            "application/wasm",
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/svg+xml",
            "audio/ogg",
            "audio/mpeg",
            "video/mp4",
            "video/webm",
          ),
          partSha256: hash(f.partSha256),
          entry: safePath(f.entry),
        };
      }),
    };
    if (
      manifest.packId === "runtime"
        ? manifest.dependencies.length !== 0 || manifest.storyContentId !== null
        : manifest.dependencies.length !== 1 ||
          manifest.dependencies[0]!.packId !== "runtime"
    )
      invalid();
    sorted(manifest.files, (a, b) => compare(a.path, b.path));
    unique(manifest.parts, (p) => p.sha256);
    paths(manifest.files.map((f) => f.path));
    const parts = new Map(
      manifest.parts.map((p) => [
        p.sha256,
        { part: p, files: 0, bytes: 0, entries: [] as string[] },
      ]),
    );
    for (const file of manifest.files) {
      const part = parts.get(file.partSha256);
      if (!part) invalid();
      part.files++;
      part.bytes += file.bytes;
      part.entries.push(file.entry);
    }
    for (const { part, files, bytes, entries } of parts.values()) {
      if (!files || files > 2048 || bytes !== part.unpackedBytes) invalid();
      paths(entries);
    }
    return manifest;
  });
}
