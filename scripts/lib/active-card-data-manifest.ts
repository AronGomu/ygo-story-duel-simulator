import { ASSET_SOURCES } from "./asset-roots.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AssetDeckCardRecord } from "../../src/decks/catalog/ocg-card-mapper.ts";

/**
 * The card data — type, level, attribute, race, scales, markers, scope — for
 * exactly the codes this build packages, read from the same sharded catalog
 * the texts come from (`code % 64`, lowercase hex, two digits).
 *
 * Text and art already reach the browser this way; the masks did not, so the
 * deck editor built from a hand-written fixture and could offer a card the
 * build cannot draw. Deriving the editor's catalog from this manifest is what
 * makes "assemblable" and "playable" the same set by construction.
 *
 * The generated records carry a `category` field the deck editor never reads,
 * so it is dropped here rather than shipped to every browser.
 */
export function buildActiveCardDataManifest(
  projectRoot: string,
  codes: ReadonlySet<number>,
): readonly AssetDeckCardRecord[] {
  const records: AssetDeckCardRecord[] = [];
  const shards = new Map<number, readonly AssetDeckCardRecord[]>();
  for (const code of [...codes].sort((left, right) => left - right)) {
    const shard = code % 64;
    let values = shards.get(shard);
    if (values === undefined) {
      const name = shard.toString(16).padStart(2, "0");
      values = JSON.parse(
        readFileSync(
          path.join(
            projectRoot,
            `${ASSET_SOURCES.data.source}/catalog/cards`,
            `${name}.json`,
          ),
          "utf8",
        ),
      ) as readonly AssetDeckCardRecord[];
      shards.set(shard, values);
    }
    const record = values.find((candidate) => candidate.code === code);
    if (record === undefined)
      throw new Error(`Missing active card data for browser build: ${code}`);
    records.push(
      Object.freeze({
        code: record.code,
        alias: record.alias,
        setcodes: [...record.setcodes],
        type: record.type,
        level: record.level,
        attribute: record.attribute,
        race: record.race,
        attack: record.attack,
        defense: record.defense,
        lscale: record.lscale,
        rscale: record.rscale,
        linkMarker: record.linkMarker,
        ot: record.ot,
      }),
    );
  }
  return Object.freeze(records);
}
