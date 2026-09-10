import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalBytes } from "../../scripts/lib/asset-delivery/canonical-json.ts";
import type { BundleSnapshot } from "../../scripts/lib/asset-delivery/bundle-snapshot.ts";
import type { ObjectRef } from "../../scripts/lib/asset-delivery/object-ref.ts";
import { put, sha } from "./asset-delivery-bundle.ts";

/** Fixture-only adversary: rewrite every reference, preserving untouched ZIP bytes. */
export async function rehashGraph(
  root: string,
  run: string,
  snapshot: BundleSnapshot,
  change: (prefix: string, value: Record<string, unknown>) => void,
): Promise<ObjectRef> {
  const json = new Map(
    snapshot.objects
      .filter((ref) => ref.key.endsWith(".json"))
      .map((ref) => [ref.sha256, ref]),
  );
  const replaced = new Map<string, ObjectRef>();
  const rewrite = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) result.push(await rewrite(item));
      return result;
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      typeof record.sha256 === "string" &&
      !Object.hasOwn(record, "path") &&
      json.has(record.sha256)
    ) {
      const ref = await visit(json.get(record.sha256)!);
      return {
        ...record,
        sha256: ref.sha256,
        bytes: ref.bytes,
        ...(typeof record.key === "string"
          ? { key: record.key.replace(record.sha256, ref.sha256) }
          : {}),
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record))
      result[key] = await rewrite(item);
    return result;
  };
  const write = async (prefix: string, value: unknown) => {
    const bytes = canonicalBytes(value);
    const ref = {
      key: `${prefix}/${sha(bytes)}.json`,
      bytes: bytes.length,
      sha256: sha(bytes),
    };
    await put(root, `${run}/objects/${ref.key}`, bytes);
    return ref;
  };
  const visit = async (ref: ObjectRef): Promise<ObjectRef> => {
    const prior = replaced.get(ref.sha256);
    if (prior) return prior;
    const prefix = ref.key.slice(0, ref.key.lastIndexOf("/"));
    const value = (await rewrite(
      JSON.parse(
        await readFile(path.join(root, run, "objects", ref.key), "utf8"),
      ),
    )) as Record<string, unknown>;
    if (typeof value.releaseId === "string") {
      let releaseId = value.releaseId;
      for (const [old, next] of replaced)
        releaseId = releaseId.replace(old, next.sha256);
      value.releaseId = releaseId;
    }
    change(prefix, value);
    const next = await write(prefix, value);
    if (prefix === "content/indexes" || prefix === "content/catalogs")
      await write(
        prefix === "content/indexes" ? "content/catalogs" : "content/indexes",
        value,
      );
    replaced.set(ref.sha256, next);
    return next;
  };
  const value = (await rewrite(snapshot)) as BundleSnapshot;
  change("snapshots", value as unknown as Record<string, unknown>);
  const objects = [...value.objects].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const ref = await write("snapshots", { ...value, objects });
  await put(
    root,
    `${run}/candidate.json`,
    canonicalBytes({ schemaVersion: 1, snapshot: ref }),
  );
  return ref;
}
