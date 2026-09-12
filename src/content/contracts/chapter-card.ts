import type { ChapterFileRef } from "./chapter-file-ref.ts";

export interface ChapterCard {
  readonly code: number;
  readonly record: {
    readonly code: number;
    readonly alias: number;
    readonly setcodes: readonly number[];
    readonly type: number;
    readonly level: number;
    readonly attribute: number;
    readonly race: string;
    readonly attack: number;
    readonly defense: number;
    readonly lscale: number;
    readonly rscale: number;
    readonly linkMarker: number;
    readonly ot: number;
  };
  readonly text: {
    readonly code: number;
    readonly name: string;
    readonly description: string;
    readonly strings: readonly string[];
  };
  readonly fullImage: ChapterFileRef;
  readonly croppedImage: ChapterFileRef;
}
