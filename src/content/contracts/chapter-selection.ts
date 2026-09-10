import type { ChapterId } from "./chapter-id.ts";

export interface ChapterSelection {
  readonly id: ChapterId;
  readonly title: string;
  readonly published: boolean;
  readonly setNames: readonly string[];
  readonly additionalCardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly storyContentId: "prototype-prologue-v1" | null;
}
