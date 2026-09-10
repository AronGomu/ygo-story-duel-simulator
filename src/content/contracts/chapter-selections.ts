import type { Sha256 } from "./sha256.ts";
import type { ChapterSelection } from "./chapter-selection.ts";

export interface ChapterSelections {
  readonly schemaVersion: 1;
  readonly sourceSha256: Sha256;
  readonly chapters: readonly ChapterSelection[];
}
