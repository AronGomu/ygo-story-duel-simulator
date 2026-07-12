import { readFile } from "node:fs/promises";
import type { CardCode } from "../../duel/contracts/ids.ts";
import type { EngineCardData } from "../engine/OcgCoreAdapter.ts";
import type {
  ActiveCardText,
  ActiveDuelDependencies,
  ActiveImageRecord,
  ActiveSystemStrings,
} from "./active-duel-dependencies.ts";
import { safeArtifactPath } from "./runtime-snapshot-node.ts";

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

export async function loadActiveDuelDependenciesNode(
  assetRoot: string,
  requestedCodes: ReadonlySet<CardCode>,
): Promise<ActiveDuelDependencies> {
  const pending = new Set<number>(requestedCodes);
  const cardRecords = new Map<number, AssetCardRecord>();
  const loadedCatalogShards = new Map<string, readonly AssetCardRecord[]>();

  while (pending.size > 0) {
    const code = pending.values().next().value as number | undefined;
    if (code === undefined) break;
    pending.delete(code);
    if (cardRecords.has(code)) continue;
    const shard = shardName(code, 64);
    let records = loadedCatalogShards.get(shard);
    if (records === undefined) {
      records = await readJson<AssetCardRecord[]>(
        safeArtifactPath(assetRoot, `catalog/cards/${shard}.json`),
      );
      loadedCatalogShards.set(shard, records);
    }
    const record = records.find((candidate) => candidate.code === code);
    if (record === undefined)
      throw new Error(`Missing active card record: ${code}`);
    cardRecords.set(code, record);
    if (record.alias > 0 && !cardRecords.has(record.alias))
      pending.add(record.alias);
  }

  const allCodes = new Set(cardRecords.keys());
  const [texts, images, scriptIndex, globalScripts, strings] =
    await Promise.all([
      loadRecords<ActiveCardText>(assetRoot, "catalog/texts/en", allCodes, 64),
      loadRecords<ActiveImageRecord>(assetRoot, "images", allCodes, 64),
      readJson<{
        official: string[];
        preRelease: string[];
        globals: string[];
        shardCount: number;
      }>(safeArtifactPath(assetRoot, "scripts/index.json")),
      readJson<Record<string, string>>(
        safeArtifactPath(assetRoot, "scripts/globals.json"),
      ),
      readJson<ActiveSystemStrings>(
        safeArtifactPath(assetRoot, "strings/en.json"),
      ),
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
  for (const code of allCodes) {
    const scriptName = `c${code}.lua`;
    if (!indexedScripts.has(scriptName)) continue;
    const shard = shardName(code, 256);
    let records = loadedScriptShards.get(shard);
    if (records === undefined) {
      records = await readJson<Record<string, string>>(
        safeArtifactPath(assetRoot, `scripts/cards/${shard}.json`),
      );
      loadedScriptShards.set(shard, records);
    }
    const script = records[scriptName];
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

async function loadRecords<T extends { readonly code: number }>(
  root: string,
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
  for (const [shard, shardCodes] of byShard) {
    const records = await readJson<T[]>(
      safeArtifactPath(root, `${directory}/${shard}.json`),
    );
    const requested = new Set(shardCodes);
    for (const record of records)
      if (requested.has(record.code)) result.set(record.code, record);
  }
  return result;
}

function shardName(code: number, count: number): string {
  return (code % count).toString(16).padStart(2, "0");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
