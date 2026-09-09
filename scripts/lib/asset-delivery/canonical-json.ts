import { fail } from "./failure.ts";

export const MAX_METADATA_BYTES = 32 * 1024 * 1024;

/** Unicode code-point order, not locale order or UTF-16 code-unit order. */
export function compareCodePoints(left: string, right: string): number {
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left.codePointAt(i)!;
    const b = right.codePointAt(j)!;
    if (a !== b) return a - b;
    i += a > 0xffff ? 2 : 1;
    j += b > 0xffff ? 2 : 1;
  }
  return (i < left.length ? 1 : 0) - (j < right.length ? 1 : 0);
}

/** Arrays retain supplied order; schema parsers enforce explicitly ordered sets. */
export function canonicalBytes(value: unknown): Uint8Array {
  const seen = new Set<object>();
  let remaining = MAX_METADATA_BYTES - 1; // Final LF is part of the byte budget.
  const reserve = (bytes: number): void => {
    if (bytes > remaining) fail("ASSET_LIMIT_EXCEEDED");
    remaining -= bytes;
  };
  const encode = (item: unknown, depth: number): string => {
    if (depth > 64) fail("ASSET_LIMIT_EXCEEDED");
    if (item === null || typeof item === "boolean") {
      const encoded = JSON.stringify(item);
      reserve(encoded.length);
      return encoded;
    }
    if (typeof item === "string") {
      // Count escaped UTF-8 before JSON.stringify can allocate an oversized string.
      if (item.length + 2 > remaining) fail("ASSET_LIMIT_EXCEEDED");
      let bytes = 2;
      for (let i = 0; i < item.length; i++) {
        const code = item.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = item.charCodeAt(++i);
          if (!(low >= 0xdc00 && low <= 0xdfff)) fail();
          bytes += 4;
        } else if (code >= 0xdc00 && code <= 0xdfff) fail();
        else if (
          code === 0x22 ||
          code === 0x5c ||
          code === 8 ||
          code === 9 ||
          code === 10 ||
          code === 12 ||
          code === 13
        )
          bytes += 2;
        else if (code < 0x20) bytes += 6;
        else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
        if (bytes > remaining) fail("ASSET_LIMIT_EXCEEDED");
      }
      reserve(bytes);
      return JSON.stringify(item);
    }
    if (typeof item === "number") {
      if (
        !Number.isFinite(item) ||
        (Number.isInteger(item) && !Number.isSafeInteger(item))
      )
        fail();
      const encoded = JSON.stringify(item);
      reserve(encoded.length);
      return encoded;
    }
    if (typeof item !== "object" || seen.has(item)) fail();
    seen.add(item);
    let encoded: string;
    if (Array.isArray(item)) {
      // Even one-byte entries need delimiters; reject impossible widths before key allocation.
      if (item.length > Math.floor((remaining - 1) / 2))
        fail("ASSET_LIMIT_EXCEEDED");
      reserve(2 + Math.max(0, item.length - 1));
      if (
        Object.keys(item).length !== item.length ||
        Object.getOwnPropertySymbols(item).length
      )
        fail();
      encoded = `[${Array.from(item, (entry) => encode(entry, depth + 1)).join(",")}]`;
    } else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        fail();
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== "string")) fail();
      if (keys.length > Math.floor((remaining - 1) / 5))
        fail("ASSET_LIMIT_EXCEEDED");
      reserve(2 + keys.length + Math.max(0, keys.length - 1));
      encoded = `{${(keys as string[])
        .sort(compareCodePoints)
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!descriptor.enumerable || !("value" in descriptor)) fail();
          return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
        })
        .join(",")}}`;
    }
    seen.delete(item);
    return encoded;
  };
  return new TextEncoder().encode(`${encode(value, 0)}\n`);
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_METADATA_BYTES) fail("ASSET_LIMIT_EXCEEDED");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) fail();
    throw error;
  }
}
