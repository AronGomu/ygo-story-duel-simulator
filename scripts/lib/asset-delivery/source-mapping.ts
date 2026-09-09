import { assertManagedPath, assertSourcePath } from "./path-guards.ts";
import { fail } from "./failure.ts";

import { ASSET_SOURCES } from "../asset-roots.ts";

export const SOURCE_MAPPING = Object.values(ASSET_SOURCES).map(
  ({ legacy, source }) => [legacy, source] as const,
);

export function mappedLegacyPath(value: unknown): string {
  const from = assertSourcePath(value);
  for (const { legacy, source, kind } of Object.values(ASSET_SOURCES)) {
    if (kind === "file" ? from === legacy : from.startsWith(`${legacy}/`))
      return assertManagedPath(source + from.slice(legacy.length));
  }
  fail("ASSET_PATH_UNSAFE");
}

/** Longest segment prefix, never a blind assets/ strip. Null means explicit mapping needed. */
export function mappedLogicalPath(value: string): string | null {
  const from = assertSourcePath(value);
  const matches = Object.values(ASSET_SOURCES)
    .filter(
      ({ source, kind, logical }) =>
        logical !== null &&
        (from === source || (kind === "tree" && from.startsWith(`${source}/`))),
    )
    .sort((a, b) => b.source.length - a.source.length);
  const match = matches[0];
  return match ? match.logical + from.slice(match.source.length) : null;
}
