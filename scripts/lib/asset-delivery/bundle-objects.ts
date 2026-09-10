import { randomUUID } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import { assertSafeParents } from "./path-guards.ts";
import { parseObjectRef, type ObjectRef } from "./object-ref.ts";
import type { FileDigest } from "./file-digest.ts";
import { sameDigest } from "./source-files.ts";
import { fail } from "./failure.ts";

export function objectRef(
  prefix: string,
  digest: Pick<FileDigest, "bytes" | "sha256">,
): ObjectRef {
  return parseObjectRef({
    key: `${prefix}/${digest.sha256}.${/archives$|parts$/.test(prefix) ? "zip" : "json"}`,
    bytes: digest.bytes,
    sha256: digest.sha256,
  });
}
export class BundleObjects {
  readonly root: string;
  readonly run: string;
  private readonly refs = new Map<string, ObjectRef>();
  constructor(root: string, run: string) {
    this.root = root;
    this.run = run;
  }
  path(ref: ObjectRef): string {
    return `${this.run}/objects/${ref.key}`;
  }
  get objects(): readonly ObjectRef[] {
    return [...this.refs.values()].sort((a, b) =>
      compareCodePoints(a.key, b.key),
    );
  }
  include(ref: ObjectRef): boolean {
    parseObjectRef(ref);
    const old = this.refs.get(ref.key);
    if (old && !sameDigest(old, ref)) fail("ASSET_INTEGRITY_FAILED");
    this.refs.set(ref.key, ref);
    return !old;
  }
  async json(
    prefix: string,
    value: unknown,
    cap = 32 * 1024 * 1024,
  ): Promise<ObjectRef> {
    const bytes = canonicalBytes(value);
    if (bytes.length > cap) fail("ASSET_LIMIT_EXCEEDED");
    const ref = objectRef(prefix, {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (this.include(ref)) await this.bytes(this.path(ref), bytes);
    return ref;
  }
  async bytes(relative: string, bytes: Uint8Array): Promise<void> {
    const target = await assertSafeParents(this.root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(
      await assertSafeParents(this.root, relative),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async archive(prefix: string, digest: FileDigest): Promise<ObjectRef> {
    const ref = objectRef(prefix, {
      bytes: digest.bytes,
      sha256: digest.sha256,
    });
    if (this.include(ref)) {
      const target = await assertSafeParents(this.root, this.path(ref));
      await mkdir(path.dirname(target), { recursive: true });
      await assertSafeParents(this.root, this.path(ref));
      await rename(await assertSafeParents(this.root, digest.path), target);
    }
    return ref;
  }
}
export async function createBundleObjects(
  root: string,
): Promise<BundleObjects> {
  const base = "generated/asset-delivery/runs";
  await mkdir(await assertSafeParents(root, base), { recursive: true });
  const run = `${base}/${randomUUID()}`;
  await mkdir(await assertSafeParents(root, run), { mode: 0o700 });
  return new BundleObjects(root, run);
}
