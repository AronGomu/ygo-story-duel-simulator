import type { PackId } from "./pack-id.ts";
import type { DownloadPhase } from "./download-phase.ts";

export interface DownloadProgress {
  readonly jobId: string;
  readonly packId: PackId;
  readonly phase: DownloadPhase;
  readonly verifiedDownloadBytes: number;
  readonly totalDownloadBytes: number;
  readonly currentPartReceivedBytes: number;
  readonly currentPartTotalBytes: number;
}
