import type { ChapterId } from "./chapter-id.ts";
import type { PackId } from "./pack-id.ts";
import type { ContentSetRef } from "./content-set-ref.ts";
import type { ContentFailure } from "./content-failure.ts";

export type ChapterReadiness =
  | { readonly kind: "unreleased"; readonly chapterId: ChapterId }
  | {
      readonly kind: "missing";
      readonly chapterId: ChapterId;
      readonly missingPacks: readonly PackId[];
    }
  | {
      readonly kind: "ready";
      readonly chapterId: ChapterId;
      readonly content: ContentSetRef;
    }
  | ContentFailure;
