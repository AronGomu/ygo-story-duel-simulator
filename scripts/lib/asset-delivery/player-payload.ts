import { createHash } from "node:crypto";
import type { PackId } from "../../../src/content/index.ts";
import type { FileDigest } from "./file-digest.ts";
import type { FrozenInventory } from "./frozen-inventory.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";

interface PayloadFile extends FileDigest {
  readonly sourcePath: string | null;
}
export function chapterPolicyBytes(inventory: FrozenInventory): Uint8Array {
  const chapter = inventory.playerMetadata!.chapters[0]!;
  return canonicalBytes({
    schemaVersion: 1,
    chapterId: "chapter-01",
    setIds: chapter.setIds,
    cardCodes: chapter.cardCodes,
    opponentIds: chapter.opponentIds,
  });
}
/** Producer and verifier share the exact selected source → player payload contract. */
export function playerPayload(
  inventory: FrozenInventory,
  packId: PackId,
): readonly PayloadFile[] {
  const files: PayloadFile[] = inventory.files
    .filter((f) => f.profile === packId)
    .map((f) => ({
      path: f.logicalPath!,
      bytes: f.bytes,
      sha256: f.sha256,
      sourcePath: f.path,
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
      });
  } else {
    const policy = chapterPolicyBytes(inventory);
    files.push({
      path: "story/policy/chapter-01.json",
      bytes: policy.length,
      sha256: createHash("sha256").update(policy).digest("hex"),
      sourcePath: null,
    });
  }
  return files.sort((a, b) => compareCodePoints(a.path, b.path));
}
