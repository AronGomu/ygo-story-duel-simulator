import { createHash, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  contentValue,
  historyRefs,
  walkContentClosure,
} from "./content-closure.ts";
import { parseContentIndex } from "../../../src/content/index.ts";
import { compareCodePoints, parseJsonBytes } from "./canonical-json.ts";
import { fail } from "./failure.ts";
import { assertSafeParents } from "./path-guards.ts";
import { parseFrozenInventory } from "./frozen-inventory.ts";
import type { BundleSnapshot } from "./bundle-snapshot.ts";
import type { ObjectRef } from "./object-ref.ts";
import {
  parseRetainedMetadata,
  type RetainedMetadata,
} from "./retained-metadata.ts";
import type { RemoteObjectStore } from "./remote-store.ts";

async function exact(
  store: RemoteObjectStore,
  ref: ObjectRef,
): Promise<Uint8Array> {
  const value = await store.read(ref.key, ref.bytes);
  if (!value || value.bytes.byteLength !== ref.bytes)
    fail("ASSET_REFERENCE_MISSING", ref.key);
  if (createHash("sha256").update(value.bytes).digest("hex") !== ref.sha256)
    fail("ASSET_INTEGRITY_FAILED", ref.key);
  return value.bytes;
}

/** Materialize verified remote history before bundling; caller holds local then remote locks. */
export async function preparePublicationHistory(
  root: string,
  store: RemoteObjectStore,
  advertised: readonly BundleSnapshot[],
  existingRelease: BundleSnapshot | null,
): Promise<{
  readonly history: RetainedMetadata;
  readonly retainedObjects: string;
}> {
  const base = `generated/asset-delivery/runs/${randomUUID()}-history/objects`;
  await mkdir(await assertSafeParents(root, base), { recursive: true });
  const inventories = existingRelease ? [existingRelease] : advertised;
  const catalogs = new Map<
    string,
    { readonly sha256: string; readonly bytes: number }
  >();
  const manifests = new Map<
    string,
    {
      readonly packId: "runtime" | "chapter-01";
      readonly sha256: string;
      readonly bytes: number;
    }
  >();
  for (const snapshot of inventories) {
    const inventory = parseFrozenInventory(
      parseJsonBytes(await exact(store, snapshot.inventory)),
    );
    for (const item of inventory.retainedMetadata.catalogs)
      catalogs.set(item.sha256, item);
    for (const item of inventory.retainedMetadata.manifests)
      manifests.set(`${item.sha256}/${item.packId}`, item);
    if (!existingRelease && snapshot.prod) {
      const index = contentValue(
        parseContentIndex(
          parseJsonBytes(await exact(store, snapshot.prod.index)),
        ),
      );
      catalogs.set(snapshot.prod.index.sha256, {
        sha256: snapshot.prod.index.sha256,
        bytes: snapshot.prod.index.bytes,
      });
      for (const item of [
        index.runtime,
        ...index.retainedManifests,
        ...index.chapters.flatMap((chapter) =>
          chapter.status === "published" ? [chapter.manifest] : [],
        ),
      ])
        manifests.set(`${item.sha256}/${item.packId}`, item);
    }
  }
  const history = parseRetainedMetadata({
    schemaVersion: 1,
    catalogs: [...catalogs.values()].sort((a, b) =>
      compareCodePoints(a.sha256, b.sha256),
    ),
    manifests: [...manifests.values()].sort(
      (a, b) =>
        compareCodePoints(a.sha256, b.sha256) ||
        compareCodePoints(a.packId, b.packId),
    ),
  });
  await walkContentClosure(historyRefs(history), async (ref, json) => {
    const bytes = await exact(store, ref);
    const relative = `${base}/${ref.key}`;
    const target = await assertSafeParents(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(
      await assertSafeParents(root, relative),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return json ? parseJsonBytes(bytes) : null;
  });
  return { history, retainedObjects: base };
}
