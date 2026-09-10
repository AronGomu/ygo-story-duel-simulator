import type { ContentSetRef } from "./content-set-ref.ts";

export interface ContentSessionLease {
  readonly content: ContentSetRef;
  release(): void;
}
