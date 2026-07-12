import assert from "node:assert/strict";
import test from "node:test";
import { parseStringsConf } from "../scripts/lib/strings.ts";

test("parseStringsConf imports supported Project Ignis string sections", () => {
  const parsed = parseStringsConf(`
# comment
#!system documentation
!system 1 Normal Summon
!victory 0x1 LP reached zero
!counter 0x10 Spell Counter
!setname 0x1234 Example Archetype
!ignored 2 Not imported
`);

  assert.deepEqual(parsed.system, { "1": "Normal Summon" });
  assert.deepEqual(parsed.victory, { "0x1": "LP reached zero" });
  assert.deepEqual(parsed.counter, { "0x10": "Spell Counter" });
  assert.deepEqual(parsed.setname, { "0x1234": "Example Archetype" });
});
