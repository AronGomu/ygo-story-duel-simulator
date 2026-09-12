import type { Sha256 } from "./sha256.ts";
import type { PackId } from "./pack-id.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { ZipPart } from "./zip-part.ts";
import type { PackedFile } from "./packed-file.ts";

export interface ContentManifest {
  readonly schemaVersion: 2;
  readonly packId: PackId;
  readonly runtimeSnapshotId: Sha256;
  readonly storyContentId: "prototype-prologue-v1" | null;
  readonly gameplayPath: string | null;
  readonly dependencies: readonly ManifestRef[];
  readonly cardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly parts: readonly ZipPart[];
  readonly files: readonly PackedFile[];
}
