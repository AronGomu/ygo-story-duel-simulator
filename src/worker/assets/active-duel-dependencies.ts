import type { CardCode } from "../../duel/contracts/ids.ts";
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

export interface ActiveDuelAssetReader {
  readJson<T>(relativePath: string): Promise<T>;
}

interface AssetCardRecord {
  readonly code: number;
  readonly alias: number;
  readonly setcodes: number[];
  readonly type: number;
  readonly level: number;
  readonly attribute: number;
  readonly race: string;
  readonly attack: number;
  readonly defense: number;
  readonly lscale: number;
  readonly rscale: number;
  readonly linkMarker: number;
}

export async function loadActiveDuelDependencies(
  reader: ActiveDuelAssetReader,
  requestedCodes: ReadonlySet<CardCode>,
): Promise<ActiveDuelDependencies> {
  const pending = new Set<number>(requestedCodes);
  const cardRecords = new Map<number, AssetCardRecord>();
  const loadedCatalogShards = new Map<string, readonly AssetCardRecord[]>();

  while (pending.size > 0) {
    const batch = [...pending].filter((code) => !cardRecords.has(code));
    pending.clear();
    const shards = [
      ...new Set(
        batch
          .map((code) => shardName(code, 64))
          .filter((shard) => !loadedCatalogShards.has(shard)),
      ),
    ];
    await Promise.all(
      shards.map(async (shard) => {
        const records = await reader.readJson<AssetCardRecord[]>(
          `catalog/cards/${shard}.json`,
        );
        loadedCatalogShards.set(shard, records);
      }),
    );
    for (const code of batch) {
      const records = loadedCatalogShards.get(shardName(code, 64));
      const record = records?.find((candidate) => candidate.code === code);
      if (record === undefined)
        throw new Error(`Missing active card record: ${code}`);
      cardRecords.set(code, record);
      if (record.alias > 0 && !cardRecords.has(record.alias))
        pending.add(record.alias);
    }
  }

  const allCodes = new Set(cardRecords.keys());
  const [texts, images, scriptIndex, globalScripts, strings] =
    await Promise.all([
      loadRecords<ActiveCardText>(reader, "catalog/texts/en", allCodes, 64),
      loadRecords<ActiveImageRecord>(reader, "images", allCodes, 64),
      reader.readJson<{
        official: string[];
        preRelease: string[];
        globals: string[];
        shardCount: number;
      }>("scripts/index.json"),
      reader.readJson<Record<string, string>>("scripts/globals.json"),
      reader.readJson<ActiveSystemStrings>("strings/en.json"),
    ]);
  if (scriptIndex.shardCount !== 256)
    throw new Error(
      `Unsupported script shard count: ${scriptIndex.shardCount}`,
    );

  const indexedScripts = new Set([
    ...scriptIndex.official,
    ...scriptIndex.preRelease,
  ]);
  const scripts = new Map<string, string>(Object.entries(globalScripts));
  const loadedScriptShards = new Map<
    string,
    Readonly<Record<string, string>>
  >();
  const scriptCodes = [...allCodes].filter((code) =>
    indexedScripts.has(`c${code}.lua`),
  );
  await Promise.all(
    [...new Set(scriptCodes.map((code) => shardName(code, 256)))].map(
      async (shard) => {
        const records = await reader.readJson<Record<string, string>>(
          `scripts/cards/${shard}.json`,
        );
        loadedScriptShards.set(shard, records);
      },
    ),
  );
  for (const code of scriptCodes) {
    const scriptName = `c${code}.lua`;
    const records = loadedScriptShards.get(shardName(code, 256));
    const script = records?.[scriptName];
    if (script === undefined)
      throw new Error(`Indexed active card script is missing: ${scriptName}`);
    scripts.set(scriptName, script);
  }

  for (const globalName of scriptIndex.globals) {
    if (!scripts.has(globalName))
      throw new Error(`Required global script is missing: ${globalName}`);
  }
  for (const code of allCodes) {
    if (!texts.has(code)) throw new Error(`Missing active card text: ${code}`);
    if (!images.has(code))
      throw new Error(`Missing active card image record: ${code}`);
  }

  const cards = new Map<number, EngineCardData>();
  for (const record of cardRecords.values()) {
    cards.set(record.code, {
      code: record.code,
      alias: record.alias,
      setcodes: [...record.setcodes],
      type: record.type,
      level: record.level,
      attribute: record.attribute,
      race: BigInt(record.race),
      attack: record.attack,
      defense: record.defense,
      lscale: record.lscale,
      rscale: record.rscale,
      link_marker: record.linkMarker,
    });
  }

  return Object.freeze({
    cards,
    texts,
    scripts,
    strings,
    images,
    counts: Object.freeze({
      cards: cards.size,
      texts: texts.size,
      scripts: scripts.size,
      globals: scriptIndex.globals.length,
      images: images.size,
    }),
  });
}

export function normalizeRequestedScriptName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? "";
  if (!/^(?:c\d+|[a-z0-9_]+)\.lua$/i.test(basename)) {
    throw new Error(`Unsupported engine script request: ${name}`);
  }
  return basename;
}

async function loadRecords<T extends { readonly code: number }>(
  reader: ActiveDuelAssetReader,
  directory: string,
  codes: ReadonlySet<number>,
  shardCount: number,
): Promise<Map<number, T>> {
  const result = new Map<number, T>();
  const byShard = new Map<string, number[]>();
  for (const code of codes) {
    const shard = shardName(code, shardCount);
    const shardCodes = byShard.get(shard) ?? [];
    shardCodes.push(code);
    byShard.set(shard, shardCodes);
  }
  await Promise.all(
    [...byShard].map(async ([shard, shardCodes]) => {
      const records = await reader.readJson<T[]>(`${directory}/${shard}.json`);
      const requested = new Set(shardCodes);
      for (const record of records)
        if (requested.has(record.code)) result.set(record.code, record);
    }),
  );
  return result;
}

function shardName(code: number, count: number): string {
  return (code % count).toString(16).padStart(2, "0");
}
