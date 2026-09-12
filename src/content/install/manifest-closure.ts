import type { ContentManifest } from "../contracts/content-manifest.ts";
import type { ManifestRef } from "../contracts/manifest-ref.ts";
import type { ContentSetRef } from "../contracts/content-set-ref.ts";
import type { InstalledContentSet } from "../contracts/installed-content-set.ts";
import { failure, same } from "../content-verification.ts";
import * as schema from "../parsers/schema.ts";

export interface ManifestEntry {
  readonly ref: ManifestRef;
  readonly manifest: ContentManifest;
}
export async function manifestClosure(
  roots: readonly ManifestRef[],
  read: (ref: ManifestRef) => Promise<ContentManifest>,
): Promise<readonly ManifestEntry[]> {
  const done = new Map<string, ManifestEntry>();
  const visiting = new Set<string>();
  const ordered: ManifestEntry[] = [];
  const visit = async (ref: ManifestRef): Promise<void> => {
    if (visiting.has(ref.packId)) throw failure("CONTENT_INCOMPATIBLE");
    const prior = done.get(ref.packId);
    if (prior) {
      if (!same(prior.ref, ref)) throw failure("CONTENT_INCOMPATIBLE");
      return;
    }
    if (done.size + visiting.size >= 100)
      throw failure("CONTENT_INVALID_MANIFEST");
    visiting.add(ref.packId);
    const manifest = await read(ref);
    if (manifest.packId !== ref.packId)
      throw failure("CONTENT_INTEGRITY_FAILED");
    for (const dependency of manifest.dependencies) await visit(dependency);
    visiting.delete(ref.packId);
    const entry = { ref, manifest };
    done.set(ref.packId, entry);
    ordered.push(entry);
  };
  for (const ref of roots) await visit(ref);
  const paths = new Map<string, unknown>();
  let totalFiles = 0;
  for (const { manifest } of ordered)
    for (const file of manifest.files) {
      if (++totalFiles > 50000) throw failure("CONTENT_INVALID_MANIFEST");
      const definition = {
        bytes: file.bytes,
        sha256: file.sha256,
        mediaType: file.mediaType,
      };
      if (paths.has(file.path) && !same(paths.get(file.path), definition))
        throw failure("CONTENT_INCOMPATIBLE");
      paths.set(file.path, definition);
    }
  try {
    schema.paths([...paths.keys()]);
  } catch {
    throw failure("CONTENT_INCOMPATIBLE");
  }
  return ordered;
}
export function validateInstalledState(value: unknown): InstalledContentSet {
  try {
    const state = schema.record(value, ["generation", "current", "previous"]);
    return {
      generation: schema.integer(state.generation),
      current:
        state.current === null ? null : validateContentRef(state.current),
      previous:
        state.previous === null ? null : validateContentRef(state.previous),
    };
  } catch {
    throw failure("CONTENT_INTEGRITY_FAILED");
  }
}
export function validateContentRef(value: unknown): ContentSetRef {
  try {
    const v = schema.record(value, [
      "catalogSha256",
      "snapshot",
      "runtime",
      "chapters",
    ]);
    const s = schema.record(v.snapshot, [
      "activationId",
      "runtimeSnapshotId",
      "runtimeManifestSha256",
      "releaseCatalogSha256",
    ]);
    const ref: ContentSetRef = {
      catalogSha256: schema.hash(v.catalogSha256),
      snapshot: {
        activationId: schema.hash(s.activationId),
        runtimeSnapshotId: schema.hash(s.runtimeSnapshotId),
        runtimeManifestSha256: schema.hash(s.runtimeManifestSha256),
        releaseCatalogSha256: schema.hash(s.releaseCatalogSha256),
      },
      runtime: schema.manifestRef(v.runtime),
      chapters: schema.array(v.chapters, schema.manifestRef, 99),
    };
    if (
      ref.runtime.packId !== "runtime" ||
      ref.chapters.length === 0 ||
      ref.chapters.some((c) => c.packId === "runtime") ||
      ref.catalogSha256 !== ref.snapshot.releaseCatalogSha256
    )
      schema.invalid();
    schema.sorted(ref.chapters, (a, b) => schema.compare(a.packId, b.packId));
    return ref;
  } catch {
    throw failure("CONTENT_INVALID_MANIFEST");
  }
}
