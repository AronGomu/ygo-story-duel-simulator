import type { ContentReadPort } from "./content-read-port.ts";
import type { ContentManager } from "./content-manager.ts";
import type { ContentResult } from "./content-result.ts";
import type { DownloadJob } from "./download-job.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { ContentFailure } from "./content-failure.ts";
import type { InstalledContentSet } from "./installed-content-set.ts";
export interface ContentInstaller
  extends
    ContentReadPort,
    Pick<ContentManager, "inspect" | "download" | "verify" | "readFile"> {
  listJobs(): Promise<ContentResult<readonly DownloadJob[]>>;
  invalidate(
    manifest: ManifestRef,
    failure: ContentFailure,
  ): Promise<ContentResult<InstalledContentSet>>;
  close(): void;
}
