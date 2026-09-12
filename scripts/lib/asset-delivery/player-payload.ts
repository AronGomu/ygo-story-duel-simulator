import { createHash } from "node:crypto";
import type { PackId } from "../../../src/content/index.ts";
import type { FileDigest } from "./file-digest.ts";
import type { FrozenInventory } from "./frozen-inventory.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";

export interface PayloadFile extends FileDigest {
  readonly sourcePath: string | null;
  readonly derivedBytes: Uint8Array | null;
}

function derived(path: string, value: unknown): PayloadFile {
  const bytes = canonicalBytes(value);
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourcePath: null,
    derivedBytes: bytes,
  };
}

/** Producer and verifier share exact selected source → player payload contract. */
export function playerPayload(
  inventory: FrozenInventory,
  packId: PackId,
): readonly PayloadFile[] {
  const files: PayloadFile[] = inventory.files
    .filter((file) => file.profile === packId)
    .map((file) => ({
      path: file.logicalPath!,
      bytes: file.bytes,
      sha256: file.sha256,
      sourcePath: file.path,
      derivedBytes: null,
    }));
  if (packId === "runtime") {
    for (const file of inventory.vendorFiles)
      files.push({
        path: file.path.endsWith(".wasm")
          ? "runtime/engine/ocgcore.sync.wasm"
          : "runtime/engine/vendor-manifest.json",
        bytes: file.bytes,
        sha256: file.sha256,
        sourcePath: file.path,
        derivedBytes: null,
      });
  } else {
    const chapter = inventory.playerMetadata?.chapters.find(
      ({ id }) => id === packId,
    );
    if (chapter) {
      files.push(
        derived(`chapters/${packId}/gameplay.json`, chapter.gameplay),
        derived(`chapters/${packId}/story.json`, chapter.story),
      );
    }
  }
  return files.sort((left, right) => compareCodePoints(left.path, right.path));
}
