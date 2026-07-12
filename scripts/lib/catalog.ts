import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MAX_CATALOG_RECORDS, MAX_DATABASE_BYTES } from "./limits.ts";
import type { CardTextRecord, EngineCardRecord, RawCardRow } from "./model.ts";
import { transformCard } from "./transform.ts";

interface TextRow {
  id: number;
  name: string;
  desc: string;
  [key: `str${number}`]: string;
}

export interface Catalog {
  cards: EngineCardRecord[];
  texts: CardTextRecord[];
}

export function readCatalog(databasePaths: string | string[]): Catalog {
  const paths = typeof databasePaths === "string" ? [databasePaths] : databasePaths;
  const rawCards: RawCardRow[] = [];
  const rawTexts: TextRow[] = [];

  for (const databasePath of paths) {
    const databaseBytes = statSync(databasePath).size;
    if (databaseBytes > MAX_DATABASE_BYTES) {
      throw new Error(
        `BabelCDB database exceeds ${MAX_DATABASE_BYTES} bytes: ${databasePath}`,
      );
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      rawCards.push(
        ...(database
          .prepare(`
            SELECT
              id,
              ot,
              alias,
              CAST(setcode AS TEXT) AS setcode,
              type,
              atk,
              def,
              level,
              CAST(race AS TEXT) AS race,
              attribute,
              category
            FROM datas
            ORDER BY id
          `)
          .all() as unknown as RawCardRow[]),
      );
      rawTexts.push(
        ...(database
          .prepare("SELECT * FROM texts ORDER BY id")
          .all() as unknown as TextRow[]),
      );
    } finally {
      database.close();
    }
  }

  if (rawCards.length > MAX_CATALOG_RECORDS || rawTexts.length > MAX_CATALOG_RECORDS) {
    throw new Error(
      `BabelCDB catalog exceeds ${MAX_CATALOG_RECORDS} records: ${rawCards.length} cards, ${rawTexts.length} texts`,
    );
  }

  rawCards.sort((left, right) => left.id - right.id);
  rawTexts.sort((left, right) => left.id - right.id);
  const cards = rawCards.map(transformCard);
  const texts = rawTexts.map((row) => ({
    code: row.id,
    name: row.name,
    description: row.desc,
    strings: Array.from({ length: 16 }, (_, index) => row[`str${index + 1}`] ?? ""),
  }));

  assertUniqueCodes(cards.map((card) => card.code), "datas");
  assertUniqueCodes(texts.map((text) => text.code), "texts");

  const cardCodes = new Set(cards.map((card) => card.code));
  const textCodes = new Set(texts.map((text) => text.code));
  const missingTexts = cards.filter((card) => !textCodes.has(card.code));
  const missingCards = texts.filter((text) => !cardCodes.has(text.code));

  if (missingTexts.length || missingCards.length) {
    throw new Error(
      `BabelCDB catalog mismatch: ${missingTexts.length} cards without text, ${missingCards.length} texts without card data`,
    );
  }

  return { cards, texts };
}

function assertUniqueCodes(codes: number[], table: string): void {
  const uniqueCodes = new Set(codes);
  if (uniqueCodes.size !== codes.length) {
    throw new Error(`${table} contains duplicate card IDs`);
  }
}
