import type { PackId } from "./pack-id.ts";
import type { ContentFailureCode } from "./content-failure-code.ts";

export interface ContentFailure {
  readonly kind: "failed";
  readonly code: ContentFailureCode;
  readonly packId: PackId | null;
  readonly path: string | null;
}
