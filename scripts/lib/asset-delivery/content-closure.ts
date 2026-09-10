import {
  parseContentIndex,
  parseContentManifest,
  type ContentIndex,
  type ContentManifest,
  type ContentResult,
} from "../../../src/content/index.ts";
import type { ObjectRef } from "./object-ref.ts";
import type { RetainedMetadata } from "./retained-metadata.ts";
import { objectRef } from "./bundle-objects.ts";
import { fail } from "./failure.ts";

export function contentValue<T>(result: ContentResult<T>): T {
  if (result.kind !== "ok") fail("ASSET_INTEGRITY_FAILED");
  return result.value;
}
export function indexRefs(index: ContentIndex): ObjectRef[] {
  return [
    objectRef("content/manifests", index.runtime),
    ...index.chapters.flatMap((c) =>
      c.status === "published"
        ? [objectRef("content/manifests", c.manifest)]
        : [],
    ),
    ...historyRefs({
      schemaVersion: 1,
      catalogs: index.retainedCatalogs,
      manifests: index.retainedManifests,
    }),
  ];
}
export function manifestRefs(manifest: ContentManifest): ObjectRef[] {
  return [
    ...manifest.dependencies.map((r) => objectRef("content/manifests", r)),
    ...manifest.parts.map((r) => objectRef("content/parts", r)),
  ];
}
export function historyRefs(history: RetainedMetadata): ObjectRef[] {
  return [
    ...history.catalogs.flatMap((r) => [
      objectRef("content/catalogs", r),
      objectRef("content/indexes", r),
    ]),
    ...history.manifests.map((r) => objectRef("content/manifests", r)),
  ];
}
/** Loader verifies exact bytes/hash before parse. No remote calls or inferred history. */
export async function walkContentClosure(
  refs: readonly ObjectRef[],
  load: (ref: ObjectRef, json: boolean) => Promise<unknown>,
): Promise<readonly ObjectRef[]> {
  const visited = new Map<string, ObjectRef>();
  const pending = [...refs];
  while (pending.length) {
    const ref = pending.pop()!;
    const previous = visited.get(ref.key);
    if (previous) {
      if (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)
        fail("ASSET_INTEGRITY_FAILED");
      continue;
    }
    if (visited.size >= 100000) fail("ASSET_LIMIT_EXCEEDED");
    visited.set(ref.key, ref);
    const json = !ref.key.startsWith("content/parts/");
    const value = await load(ref, json);
    if (ref.key.startsWith("content/manifests/"))
      pending.push(...manifestRefs(contentValue(parseContentManifest(value))));
    else if (json) {
      const index = contentValue(parseContentIndex(value));
      pending.push(...indexRefs(index));
      pending.push(
        objectRef(
          ref.key.startsWith("content/indexes/")
            ? "content/catalogs"
            : "content/indexes",
          ref,
        ),
      );
    }
  }
  return [...visited.values()];
}
