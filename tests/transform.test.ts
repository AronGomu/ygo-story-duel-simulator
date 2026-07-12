import assert from "node:assert/strict";
import test from "node:test";
import { LINK_TYPE } from "../scripts/lib/model.ts";
import {
  catalogShard,
  scriptShard,
  transformCard,
  unpackSetcodes,
} from "../scripts/lib/transform.ts";

test("unpackSetcodes extracts packed 16-bit archetype codes", () => {
  const packed = ((0x5678n << 16n) | 0x1234n).toString();
  assert.deepEqual(unpackSetcodes(packed), [0x1234, 0x5678]);
});

test("unpackSetcodes preserves unsigned high-bit values exposed as signed SQLite integers", () => {
  const unsigned = (0x8001n << 48n) | (0x5678n << 16n) | 0x1234n;
  const signed = BigInt.asIntN(64, unsigned).toString();
  assert.deepEqual(unpackSetcodes(signed), [0x1234, 0x5678, 0x8001]);
});

test("transformCard preserves unsigned 64-bit race flags", () => {
  const card = transformCard({
    id: 123,
    ot: 3,
    alias: 0,
    setcode: "0",
    type: 1,
    atk: 0,
    def: 0,
    level: 0,
    race: BigInt.asIntN(64, 0x8000000000000001n).toString(),
    attribute: 0,
    category: 0,
  });

  assert.equal(card.race, "9223372036854775809");
});

test("transformCard decodes level, pendulum scales and link marker", () => {
  const packedLevel = (9 << 24) | (8 << 16) | 7;
  const card = transformCard({
    id: 123,
    ot: 3,
    alias: 0,
    setcode: "0",
    type: LINK_TYPE,
    atk: 2500,
    def: 0x145,
    level: packedLevel,
    race: "16777216",
    attribute: 0x20,
    category: 1,
  });

  assert.equal(card.level, 7);
  assert.equal(card.lscale, 9);
  assert.equal(card.rscale, 8);
  assert.equal(card.linkMarker, 0x145);
  assert.equal(card.race, "16777216");
});

test("numeric identifiers map to stable shards", () => {
  assert.equal(catalogShard(65), "01");
  assert.equal(scriptShard("c257.lua"), "01");
  assert.throws(() => scriptShard("utility.lua"), /unsupported name/);
});
