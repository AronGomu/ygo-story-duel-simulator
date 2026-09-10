export type DownloadPhase =
  | "queued"
  | "downloading"
  | "verifying"
  | "extracting"
  | "activating"
  | "paused"
  | "failed"
  | "complete";
