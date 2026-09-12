import type { Sha256 } from "./sha256.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { ChapterRelease } from "./chapter-release.ts";

export interface ContentIndex {
  readonly schemaVersion: 2;
  readonly releaseId: string;
  readonly runtimeSnapshotId: Sha256;
  readonly runtime: ManifestRef;
  readonly chapters: readonly ChapterRelease[];
  readonly retainedCatalogs: readonly {
    readonly sha256: Sha256;
    readonly bytes: number;
  }[];
  readonly retainedManifests: readonly ManifestRef[];
}
