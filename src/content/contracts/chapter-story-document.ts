import type { ChapterFileRef } from "./chapter-file-ref.ts";

export type ChapterChoiceId = "trust-rin" | "challenge-rin" | "observe-first";

export interface ChapterStoryDocument {
  readonly schemaVersion: 1;
  readonly contentId: "prototype-prologue-v1";
  readonly title: string;
  readonly beats: readonly {
    readonly id: string;
    readonly speaker: "Rin" | "Kael" | "Protagonist" | null;
    readonly kind: "dialogue" | "narration" | "thought";
    readonly text: string;
    readonly background: "station" | "concourse" | "arena";
    readonly characters: readonly ("rin-neutral" | "rin-smile" | "kael")[];
  }[];
  readonly choices: readonly {
    readonly id: ChapterChoiceId;
    readonly label: string;
  }[];
  readonly choiceResponses: Readonly<Record<ChapterChoiceId, string>>;
  readonly laterAcknowledgments: Readonly<Record<ChapterChoiceId, string>>;
  readonly mapImage: ChapterFileRef;
}
