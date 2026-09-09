import { fail } from "./failure.ts";

export type Parser<T> = (value: unknown) => T;

export function object<S extends Record<string, Parser<unknown>>>(
  value: unknown,
  shape: S,
): { readonly [K in keyof S]: ReturnType<S[K]> } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== Object.keys(shape).length ||
    keys.some((key) => typeof key !== "string" || !Object.hasOwn(shape, key))
  )
    fail();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail();
    result[key] = shape[key]!(descriptor.value);
  }
  return result as { readonly [K in keyof S]: ReturnType<S[K]> };
}

export function literal<const T extends string | number | boolean>(
  ...allowed: readonly T[]
): Parser<T> {
  return (value) => {
    if (!allowed.includes(value as T)) fail();
    return value as T;
  };
}
export const version = literal(1);
export function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    /[\uD800-\uDFFF]/u.test(value) ||
    value.length === 0 ||
    value.length > 512 ||
    /[\p{Cc}]/u.test(value)
  )
    fail();
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail();
  return value;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}
export function nullable<T>(parse: Parser<T>): Parser<T | null> {
  return (value) => (value === null ? null : parse(value));
}
export function array<T>(
  parse: Parser<T>,
  key?: (item: T) => string | number,
  cap = 100_000,
): Parser<readonly T[]> {
  return (value) => {
    if (!Array.isArray(value)) fail();
    if (value.length > cap) fail("ASSET_LIMIT_EXCEEDED");
    if (Reflect.ownKeys(value).length !== value.length + 1) fail();
    const result = Array.from(value, (item) => parse(item));
    if (key && new Set(result.map(key)).size !== result.length) fail();
    return result;
  };
}
/** Validate protocol-defined order without rewriting caller metadata. */
export function assertSorted<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): void {
  for (let i = 1; i < values.length; i++) {
    if (compare(values[i - 1]!, values[i]!) > 0) fail();
  }
}

export function releaseVersion(value: unknown): string {
  const parsed = text(value);
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      parsed,
    )
  )
    fail();
  return parsed;
}
export function utcTimestamp(value: unknown): string {
  const parsed = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) ||
    !Number.isFinite(Date.parse(parsed)) ||
    new Date(parsed).toISOString() !== parsed.replace(/(?<=:\d{2})Z$/, ".000Z")
  )
    fail();
  return parsed;
}
