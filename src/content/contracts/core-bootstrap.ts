import type { Sha256 } from "./sha256.ts";

export type CoreChapterId = `chapter-${string}`;

export interface CoreBootstrap {
  readonly schemaVersion: 1;
  readonly appSchemaVersion: 1;
  readonly contentSchemaVersion: 2;
  readonly hashAlgorithm: "SHA-256";
  readonly delivery: null | {
    readonly baseUrl: string;
    readonly index: { readonly sha256: Sha256; readonly bytes: number };
  };
  readonly chapters: readonly {
    readonly id: CoreChapterId;
    readonly title: string;
    readonly description: string;
  }[];
}
