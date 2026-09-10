import type { ChapterId } from "./chapter-id.ts";

export interface ChapterContentPolicy {
  readonly schemaVersion: 1;
  readonly chapterId: ChapterId;
  readonly setIds: readonly string[];
  readonly cardCodes: readonly number[];
  readonly opponentIds: readonly string[];
}
