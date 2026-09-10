import type { ChapterId } from "./chapter-id.ts";

export type DownloadTarget =
  | { readonly kind: "chapter"; readonly chapterId: ChapterId }
  | { readonly kind: "all-published" };
