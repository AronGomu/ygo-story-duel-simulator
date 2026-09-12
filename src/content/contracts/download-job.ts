import type { DownloadTarget } from "./download-target.ts";
import type { DownloadProgress } from "./download-progress.ts";
import type { ContentFailure } from "./content-failure.ts";
export interface DownloadJob {
  readonly jobId: string;
  readonly target: DownloadTarget;
  readonly progress: DownloadProgress;
  readonly failure: ContentFailure | null;
}
