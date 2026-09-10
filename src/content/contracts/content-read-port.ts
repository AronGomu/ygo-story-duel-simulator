import type { Sha256 } from "./sha256.ts";
import type { ManifestRef } from "./manifest-ref.ts";
import type { ContentIndex } from "./content-index.ts";
import type { ContentManifest } from "./content-manifest.ts";
import type { ContentSetRef } from "./content-set-ref.ts";
import type { InstalledContentSet } from "./installed-content-set.ts";
import type { ContentResult } from "./content-result.ts";
import type { ContentSessionLease } from "./content-session-lease.ts";
import type { VerifiedMetadata } from "./verified-metadata.ts";

export interface ContentReadPort {
  readCatalog(
    sha256: Sha256,
  ): Promise<ContentResult<VerifiedMetadata<ContentIndex>>>;
  readManifest(
    ref: ManifestRef,
  ): Promise<ContentResult<VerifiedMetadata<ContentManifest>>>;
  current(): Promise<ContentResult<InstalledContentSet>>;
  subscribeCurrent(
    listener: (state: ContentResult<InstalledContentSet>) => void,
  ): () => void;
  readFile(manifest: ManifestRef, path: string): Promise<ContentResult<Blob>>;
  inspectContent(ref: ContentSetRef): Promise<ContentResult<ContentSetRef>>;
  acquireSession(
    ref: ContentSetRef,
  ): Promise<ContentResult<ContentSessionLease>>;
}
