import type { ChapterId } from "./chapter-id.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { ContentSetRef } from "./content-set-ref.ts";
import type { InstalledContentSet } from "./installed-content-set.ts";
import type { ContentResult } from "./content-result.ts";
import type { DownloadTarget } from "./download-target.ts";
import type { DownloadProgress } from "./download-progress.ts";
import type { DownloadResult } from "./download-result.ts";
import type { ChapterReadiness } from "./chapter-readiness.ts";

export interface ContentManager {
  inspect(chapterId: ChapterId): Promise<ChapterReadiness>;
  download(
    target: DownloadTarget,
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  resume(
    jobId: string,
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  updateInstalled(
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
  verify(chapterId: ChapterId): Promise<ContentResult<ContentSetRef>>;
  remove(chapterId: ChapterId): Promise<ContentResult<InstalledContentSet>>;
  readFile(manifest: ManifestRef, path: string): Promise<ContentResult<Blob>>;
}
