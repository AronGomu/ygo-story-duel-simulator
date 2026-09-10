import type { ChapterId } from "./chapter-id.ts";
import type { ContentSetRef } from "./content-set-ref.ts";

export interface StoryContentBinding {
  readonly chapterId: ChapterId;
  readonly content: ContentSetRef;
  readonly completedChapters: readonly ChapterId[];
}
