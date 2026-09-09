import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { AssetRoot } from "./identity.ts";
import { fail } from "./failure.ts";

export const ASSET_ROOTS = [
  "battle",
  "deck-editor",
  "story",
  "shared",
] as const;

export function parseAssetRoot(value: unknown): AssetRoot {
  if (typeof value !== "string" || !ASSET_ROOTS.includes(value as AssetRoot))
    fail();
  return value as AssetRoot;
}

export function assertSafePath(value: unknown, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  if (
    typeof value !== "string" ||
    /[\uD800-\uDFFF]/u.test(value) ||
    !value ||
    Buffer.byteLength(value, "utf8") > 512 ||
    /[\\:%?#<>"|*\p{Cc}]/u.test(value)
  )
    fail("ASSET_PATH_UNSAFE");
  for (const segment of value.split("/")) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)
    )
      fail("ASSET_PATH_UNSAFE");
  }
  return value;
}

export function assertSourcePath(value: unknown, allowEmpty = false): string {
  const safe = assertSafePath(value, allowEmpty);
  for (const segment of safe.split("/")) {
    if (
      /^(?:\.env(?:\..*)?|\.git|node_modules|id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(
        segment,
      ) ||
      /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(segment)
    )
      fail("ASSET_PATH_UNSAFE");
  }
  return safe;
}

export function assertManagedPath(value: unknown): string {
  const safe = assertSourcePath(value);
  const [prefix, root, ...parts] = safe.split("/");
  if (
    prefix !== "assets" ||
    !ASSET_ROOTS.includes(root as AssetRoot) ||
    !parts.length
  )
    fail("ASSET_PATH_UNSAFE");
  return safe;
}

/** Compare every parent spelling too: A/x and a/y cannot coexist portably. */
export function assertNoPathCollisions(
  paths: readonly string[],
  directories: readonly string[] = [],
): void {
  const spellings = new Map<string, string>();
  const files = new Set<string>();
  const parents = new Set<string>();
  const register = (prefix: string): string => {
    // Lowercase first maps capital sharp-S before uppercase expands sharp-S.
    const folded = prefix
      .normalize("NFD")
      .toLowerCase()
      .toUpperCase()
      .normalize("NFD");
    const existing = spellings.get(folded);
    if (existing !== undefined && existing !== prefix)
      fail("ASSET_PATH_UNSAFE");
    spellings.set(folded, prefix);
    return folded;
  };
  for (const directory of directories) {
    assertSafePath(directory);
    const segments = directory.split("/");
    for (let i = 1; i <= segments.length; i++)
      parents.add(register(segments.slice(0, i).join("/")));
  }
  for (const file of paths) {
    assertSafePath(file);
    const segments = file.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const folded = register(prefix);
      if (i < segments.length) {
        if (files.has(folded)) fail("ASSET_PATH_UNSAFE");
        parents.add(folded);
      } else {
        if (files.has(folded) || parents.has(folded)) fail("ASSET_PATH_UNSAFE");
        files.add(folded);
      }
    }
  }
}

/** Call immediately before I/O; caller still owns revalidation at mutation time. */
export async function assertSafeParents(
  root: string,
  relative: string,
): Promise<string> {
  assertSafePath(relative);
  const absoluteRoot = path.resolve(root);
  // Check ancestors, not only realpath(root), which would silently accept a linked root.
  const target = path.join(absoluteRoot, relative);
  const parsed = path.parse(target);
  let current = parsed.root;
  const segments = target.slice(parsed.root.length).split(path.sep);
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]!);
    try {
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        (i < segments.length - 1
          ? !info.isDirectory()
          : !info.isDirectory() && !info.isFile())
      )
        fail("ASSET_PATH_UNSAFE");
      if (path.resolve(await realpath(current)) !== current)
        fail("ASSET_PATH_UNSAFE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}
