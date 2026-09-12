import type { ContentResult } from "./content-result.ts";
import type { ContentSetRef } from "./content-set-ref.ts";
export interface SavedContentRefsPort {
  read(): Promise<ContentResult<readonly ContentSetRef[]>>;
}
