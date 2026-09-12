import type { ChapterFileRef } from "./chapter-file-ref.ts";
import type { ChapterRarity } from "./chapter-rarity.ts";

export interface ChapterSet {
  readonly id: string;
  readonly name: string;
  readonly releaseYear: number;
  readonly image: ChapterFileRef | null;
  readonly cards: readonly {
    readonly code: number;
    readonly name: string;
    readonly rarity: ChapterRarity;
    readonly printingCode: string;
    readonly sourceRarity: string;
    readonly sourceRarityCode: string;
  }[];
}
