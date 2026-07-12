import {
  CATALOG_SHARD_COUNT,
  LINK_TYPE,
  SCRIPT_SHARD_COUNT,
  type EngineCardRecord,
  type RawCardRow,
} from "./model.ts";

export function unpackSetcodes(packedValue: string): number[] {
  let packed = BigInt.asUintN(64, BigInt(packedValue));
  const setcodes: number[] = [];

  while (packed > 0n) {
    const setcode = Number(packed & 0xffffn);
    if (setcode !== 0) {
      setcodes.push(setcode);
    }
    packed >>= 16n;
  }

  return setcodes;
}

export function transformCard(row: RawCardRow): EngineCardRecord {
  const packedLevel = BigInt(row.level >>> 0);
  const isLink = (row.type & LINK_TYPE) !== 0;

  return {
    code: row.id,
    alias: row.alias,
    setcodes: unpackSetcodes(row.setcode),
    type: row.type,
    level: Number(packedLevel & 0xffn),
    attribute: row.attribute,
    race: BigInt.asUintN(64, BigInt(row.race)).toString(),
    attack: row.atk,
    defense: row.def,
    lscale: Number((packedLevel >> 24n) & 0xffn),
    rscale: Number((packedLevel >> 16n) & 0xffn),
    linkMarker: isLink ? row.def : 0,
    ot: row.ot,
    category: row.category,
  };
}

export function catalogShard(code: number): string {
  return (code % CATALOG_SHARD_COUNT).toString(16).padStart(2, "0");
}

export function scriptShard(scriptName: string): string {
  const match = /^c(\d+)\.lua$/.exec(scriptName);
  if (!match?.[1]) {
    throw new Error(`Official script has an unsupported name: ${scriptName}`);
  }
  return (Number(match[1]) % SCRIPT_SHARD_COUNT)
    .toString(16)
    .padStart(2, "0");
}
