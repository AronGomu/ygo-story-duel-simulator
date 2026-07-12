import { describe, expect, it } from "vitest";
import {
  parseYdk,
  uniqueDeckCodes,
  validateDeck,
} from "../../src/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset.ts";

describe("YDK parsing", () => {
  it("loads the locked MVP matchup", async () => {
    const preset = await loadMvpPreset();
    expect(preset.player.main).toHaveLength(40);
    expect(preset.opponent.main).toHaveLength(40);
    expect(preset.player.extra).toEqual([]);
    expect(preset.opponent.side).toEqual([]);
    expect(
      uniqueDeckCodes(preset.player, preset.opponent).size,
    ).toBeGreaterThan(10);
  });

  it("supports comments and CRLF while preserving duplicates", () => {
    const deck = parseYdk(
      "#created by test\r\n#main\r\n123\r\n123\r\n#extra\r\n456\r\n!side\r\n",
    );
    expect(deck).toEqual({ main: [123, 123], extra: [456], side: [] });
  });

  it("rejects malformed and missing card codes", () => {
    expect(() => parseYdk("#main\nabc\n#extra\n!side")).toThrow(
      /Invalid card code/,
    );
    const deck = parseYdk(
      `#main\n${Array.from({ length: 40 }, () => "123").join("\n")}\n#extra\n!side`,
    );
    expect(() => validateDeck(deck, new Set())).toThrow(/123/);
  });

  it("rejects unsupported Side Deck content", () => {
    const deck = parseYdk(
      `#main\n${Array.from({ length: 40 }, () => "123").join("\n")}\n#extra\n!side\n456`,
    );
    expect(() => validateDeck(deck, new Set([123, 456]))).toThrow(/Side Deck/);
  });
});
