export const CATALOG_SHARD_COUNT = 64;
export const SCRIPT_SHARD_COUNT = 256;
export const LINK_TYPE = 0x04000000;

export interface RawCardRow {
  id: number;
  ot: number;
  alias: number;
  setcode: string;
  type: number;
  atk: number;
  def: number;
  level: number;
  race: string;
  attribute: number;
  category: number;
}

export interface EngineCardRecord {
  code: number;
  alias: number;
  setcodes: number[];
  type: number;
  level: number;
  attribute: number;
  race: string;
  attack: number;
  defense: number;
  lscale: number;
  rscale: number;
  linkMarker: number;
  ot: number;
  category: number;
}

export interface CardTextRecord {
  code: number;
  name: string;
  description: string;
  strings: string[];
}

export interface SystemStrings {
  system: Record<string, string>;
  victory: Record<string, string>;
  counter: Record<string, string>;
  setname: Record<string, string>;
}

export interface ImageRecord {
  code: number;
  full: string;
  cropped: string;
}

export interface SourceRevision {
  repository: string;
  requestedRef: string;
  commit: string;
}

export interface GeneratedFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface AssetManifest {
  schemaVersion: 1;
  generatedAt: string;
  sources: {
    babelCdb: SourceRevision;
    cardScripts: SourceRevision;
    distribution: SourceRevision;
    imageProvider: {
      name: "YGOPRODeck";
      apiGuide: string;
      fullTemplate: string;
      croppedTemplate: string;
      redistributionApproved: false;
    };
  };
  inputs: {
    catalogDatabases: string[];
    scriptDirectories: ["official", "pre-release"];
  };
  counts: {
    cards: number;
    texts: number;
    officialScripts: number;
    preReleaseScripts: number;
    globalScripts: number;
    systemStrings: number;
    victoryStrings: number;
    counterStrings: number;
    setNameStrings: number;
    imageRecords: number;
  };
  sharding: {
    catalog: number;
    scripts: number;
    algorithm: "numeric-id-modulo";
  };
  files: GeneratedFile[];
}
