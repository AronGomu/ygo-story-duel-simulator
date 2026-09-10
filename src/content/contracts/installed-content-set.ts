import type { ContentSetRef } from "./content-set-ref.ts";

export interface InstalledContentSet {
  readonly generation: number;
  readonly current: ContentSetRef | null;
  readonly previous: ContentSetRef | null;
}
