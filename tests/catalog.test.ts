import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readCatalog } from "../scripts/lib/catalog.ts";

test("readCatalog converts a YGOPro-compatible CDB", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ygo-catalog-test-"));
  const databasePath = path.join(directory, "cards.cdb");
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE datas (
        id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
        type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER,
        attribute INTEGER, category INTEGER
      );
      CREATE TABLE texts (
        id INTEGER PRIMARY KEY, name TEXT, desc TEXT,
        str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT,
        str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT,
        str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT,
        str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
      );
      INSERT INTO datas VALUES (42, 3, 0, 4660, 1, 1000, 1000, 4, 1, 16, 0);
      INSERT INTO texts VALUES (
        42, 'Test Card', 'Test description', 'Option A', '', '', '',
        '', '', '', '', '', '', '', '', '', '', '', ''
      );
    `);
  } finally {
    database.close();
  }

  try {
    const catalog = readCatalog(databasePath);
    assert.equal(catalog.cards.length, 1);
    assert.equal(catalog.cards[0]?.code, 42);
    assert.deepEqual(catalog.cards[0]?.setcodes, [0x1234]);
    assert.equal(catalog.texts[0]?.name, "Test Card");
    assert.equal(catalog.texts[0]?.strings[0], "Option A");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
