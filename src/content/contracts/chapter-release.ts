import type { ChapterId } from "./chapter-id.ts";
import type { ManifestRef } from "./manifest-ref.ts";

export type ChapterRelease =
  | {
      readonly id: ChapterId;
      readonly title: string;
      readonly description: string;
      readonly status: "unreleased";
    }
  | {
      readonly id: ChapterId;
      readonly title: string;
      readonly description: string;
      readonly status: "published";
      readonly manifest: ManifestRef;
    };
