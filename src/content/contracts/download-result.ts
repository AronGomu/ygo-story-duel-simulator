import type { ContentSetRef } from "./content-set-ref.ts";
import type { ContentFailure } from "./content-failure.ts";

export type DownloadResult =
  | { readonly kind: "complete"; readonly content: ContentSetRef }
  | { readonly kind: "paused"; readonly jobId: string }
  | ContentFailure;
