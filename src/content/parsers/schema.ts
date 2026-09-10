import type { ContentResult } from "../contracts/content-result.ts";
import type { ManifestRef } from "../contracts/manifest-ref.ts";

class InvalidContent extends Error {}
export function invalid(): never {
  throw new InvalidContent("CONTENT_INVALID_MANIFEST");
}
export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    invalid();
  const entries = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !entries[key]?.enumerable || !("value" in entries[key]!))
  )
    invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    /[\p{Cc}\uD800-\uDFFF]/u.test(value)
  )
    invalid();
  return value;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
export function integer(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
  min = 0,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    invalid();
  return value;
}
export function literal<T extends string | number | boolean | null>(
  value: unknown,
  ...allowed: readonly T[]
): T {
  if (!allowed.includes(value as T)) invalid();
  return value as T;
}
export function array<T>(
  value: unknown,
  parse: (v: unknown) => T,
  max = 50000,
): T[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return Array.from(value, parse);
}
export function compare(left: string, right: string): number {
  const a = Array.from(left, (c) => c.codePointAt(0)!);
  const b = Array.from(right, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
export function unique<T>(
  items: readonly T[],
  key: (item: T) => string | number,
): void {
  if (new Set(items.map(key)).size !== items.length) invalid();
}
export function sorted<T>(
  items: readonly T[],
  order: (a: T, b: T) => number,
): void {
  for (let i = 1; i < items.length; i++)
    if (order(items[i - 1]!, items[i]!) >= 0) invalid();
}
export function codes(value: unknown): number[] {
  const result = array(value, (v) => integer(v, 0xffffffff, 1));
  sorted(result, (a, b) => a - b);
  return result;
}
export function strings(value: unknown, max = 50000): string[] {
  const result = array(value, text, max);
  sorted(result, compare);
  return result;
}
export function safePath(value: unknown): string {
  const result = text(value);
  if (
    new TextEncoder().encode(result).length > 512 ||
    /[\\:%?#<>"|*]/.test(result) ||
    result
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
      )
  )
    invalid();
  return result;
}
export function paths(paths: readonly string[]): void {
  const spellings = new Map<string, string>();
  const files = new Set(paths);
  unique(paths, (p) => p);
  for (const file of paths) {
    const segments = file.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const key = prefix
        .normalize("NFD")
        .toLowerCase()
        .toUpperCase()
        .normalize("NFD");
      if (
        (spellings.has(key) && spellings.get(key) !== prefix) ||
        (i < segments.length && files.has(prefix))
      )
        invalid();
      spellings.set(key, prefix);
    }
  }
}
export function manifestRef(value: unknown): ManifestRef {
  const v = record(value, ["packId", "sha256", "bytes"]);
  return {
    packId: literal(v.packId, "runtime", "chapter-01"),
    sha256: hash(v.sha256),
    bytes: integer(v.bytes, 4194304, 1),
  };
}
/** Count bounded compact JSON before any whole-body encoding; rejects cycles/accessors. */
export function budget(value: unknown, max: number): void {
  let remaining = max - 1;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > 32 || remaining < 0) invalid();
    if (
      v === null ||
      typeof v === "boolean" ||
      typeof v === "number" ||
      typeof v === "string"
    ) {
      if (typeof v === "number") integer(v);
      if (typeof v === "string" && v.length > remaining) invalid();
      remaining -= new TextEncoder().encode(JSON.stringify(v)).length;
    } else if (typeof v === "object") {
      if (seen.has(v)) invalid();
      seen.add(v);
      if (Array.isArray(v)) {
        if (v.length > remaining / 2) invalid();
        remaining -= 2 + Math.max(0, v.length - 1);
        for (const child of v) visit(child, depth + 1);
      } else {
        const keys = Reflect.ownKeys(v);
        if (keys.length > remaining / 4) invalid();
        remaining -= 2 + Math.max(0, keys.length - 1) + keys.length;
        for (const key of keys) {
          const d = Object.getOwnPropertyDescriptor(v, key)!;
          if (typeof key !== "string" || !d.enumerable || !("value" in d))
            invalid();
          visit(key, depth + 1);
          visit(d.value, depth + 1);
        }
      }
      seen.delete(v);
    } else invalid();
    if (remaining < 0) invalid();
  };
  visit(value, 0);
}
export function result<T>(
  value: unknown,
  max: number,
  parse: (value: unknown) => T,
): ContentResult<T> {
  try {
    budget(value, max);
    return { kind: "ok", value: parse(value) };
  } catch (error) {
    if (!(error instanceof InvalidContent)) throw error;
    return {
      kind: "failed",
      code: "CONTENT_INVALID_MANIFEST",
      packId: null,
      path: null,
    };
  }
}
