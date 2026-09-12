import type { DownloadJob } from "./download-job.ts";
import type { ContentSetRef } from "./content-set-ref.ts";
import type { Sha256 } from "./sha256.ts";
export interface PersistedDownloadJob extends DownloadJob {
  readonly expectedGeneration: number;
  readonly content: ContentSetRef | null;
  readonly verifiedParts: readonly Sha256[];
}
