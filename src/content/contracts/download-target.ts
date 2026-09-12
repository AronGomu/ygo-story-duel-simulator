import type { ChapterId } from "./chapter-id.ts";
import type { ContentSetRef } from "./content-set-ref.ts";

export type DownloadTarget =
  | { readonly kind: "chapter"; readonly chapterId: ChapterId }
  | { readonly kind: "all-published" }
  | { readonly kind: "revision"; readonly content: ContentSetRef };
