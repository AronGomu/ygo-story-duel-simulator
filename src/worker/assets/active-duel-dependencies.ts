import type { EngineCardData } from "../engine/OcgCoreAdapter.ts";

export interface ActiveCardText {
  readonly code: number;
  readonly name: string;
  readonly description: string;
  readonly strings: readonly string[];
}

export interface ActiveImageRecord {
  readonly code: number;
  readonly full: string;
  readonly cropped: string;
}

export interface ActiveSystemStrings {
  readonly system: Readonly<Record<string, string>>;
  readonly victory: Readonly<Record<string, string>>;
  readonly counter: Readonly<Record<string, string>>;
  readonly setname: Readonly<Record<string, string>>;
}

export interface ActiveDuelDependencies {
  readonly cards: ReadonlyMap<number, EngineCardData>;
  readonly texts: ReadonlyMap<number, ActiveCardText>;
  readonly scripts: ReadonlyMap<string, string>;
  readonly strings: ActiveSystemStrings;
  readonly images: ReadonlyMap<number, ActiveImageRecord>;
  readonly counts: {
    readonly cards: number;
    readonly texts: number;
    readonly scripts: number;
    readonly globals: number;
    readonly images: number;
  };
}

export function normalizeRequestedScriptName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? "";
  if (!/^(?:c\d+|[a-z0-9_]+)\.lua$/i.test(basename)) {
    throw new Error(`Unsupported engine script request: ${name}`);
  }
  return basename;
}
