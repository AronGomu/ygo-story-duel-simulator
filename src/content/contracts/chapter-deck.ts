export interface ChapterDeck {
  readonly id: string;
  readonly name: string;
  readonly main: readonly number[];
  readonly extra: readonly number[];
  readonly side: readonly number[];
}
