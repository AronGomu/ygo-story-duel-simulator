export type Sha256 = string;
export type AssetRoot = "battle" | "deck-editor" | "story" | "shared";
export type ProfileId = "core" | "runtime" | `chapter-${string}`;
export type BundleTarget = "dev" | "prod";
export type TargetOption = BundleTarget | "all";
export type Channel =
  | { readonly kind: "nightly" }
  | { readonly kind: "release"; readonly version: string };

import { object, literal, releaseVersion } from "./schema.ts";
import { fail } from "./failure.ts";
export function parseChannel(value: unknown): Channel {
  if (typeof value !== "object" || value === null || !("kind" in value)) fail();
  return value.kind === "nightly"
    ? object(value, { kind: literal("nightly") })
    : object(value, { kind: literal("release"), version: releaseVersion });
}
