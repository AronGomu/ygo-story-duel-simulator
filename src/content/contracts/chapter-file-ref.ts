import type { PackId } from "./pack-id.ts";

export interface ChapterFileRef {
  readonly packId: PackId;
  readonly path: string;
}
