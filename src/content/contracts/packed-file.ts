import type { Sha256 } from "./sha256.ts";
import type { ContentMediaType } from "./content-media-type.ts";

export interface PackedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
  readonly mediaType: ContentMediaType;
  readonly partSha256: Sha256;
  readonly entry: string;
}
