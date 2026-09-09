import { assertManagedPath, assertSourcePath } from "./path-guards.ts";
import { fail } from "./failure.ts";

/** Legacy source → managed source. No files moved by these declarations. */
export const SOURCE_MAPPING = [
  ["generated/assets/current", "assets/shared/data/current"],
  ["generated/runtime/current", "assets/shared/runtime/current"],
  ["generated/card-images/archive/full", "assets/shared/card-images/full"],
  [
    "generated/card-images/archive/cropped",
    "assets/shared/card-images/cropped",
  ],
  ["generated/card-images/card-back.jpg", "assets/shared/card-back.jpg"],
  ["generated/set-images", "assets/shared/set-images"],
  ["generated/engine/current", "assets/battle/engine/current"],
  ["public/fonts", "assets/shared/fonts"],
  ["src/story/assets", "assets/story"],
] as const;

export function mappedLegacyPath(value: unknown): string {
  const from = assertSourcePath(value);
  for (const [oldRoot, newRoot] of SOURCE_MAPPING) {
    if (
      oldRoot.endsWith(".jpg")
        ? from === oldRoot
        : from.startsWith(`${oldRoot}/`)
    )
      return assertManagedPath(newRoot + from.slice(oldRoot.length));
  }
  fail("ASSET_PATH_UNSAFE");
}
