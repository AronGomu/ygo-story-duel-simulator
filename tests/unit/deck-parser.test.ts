import { describe, expect, it } from "vitest";
import {
  parseYdk,
  uniqueDeckCodes,
  validateDeck,
} from "../../src/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset-node.ts";

describe("YDK parsing", () => {
  it("loads the exact locked MVP matchup", async () => {
    const preset = await loadMvpPreset();
    expect(preset.player.main).toEqual([
      97590747, 97590747, 97590747, 91152256, 91152256, 91152256, 5053103,
      5053103, 5053103, 15025844, 15025844, 15025844, 13039848, 13039848,
      13039848, 70781052, 70781052, 89631139, 89631139, 40640057, 40640057,
      40640057, 83764718, 83764718, 12580477, 12580477, 76103675, 76103675,
      76103675, 84257639, 84257639, 84257639, 5758500, 5758500, 5758500,
      4031928, 4031928, 4206964, 4206964, 44095762,
    ]);
    expect(preset.opponent.main).toEqual([
      97590747, 97590747, 97590747, 5053103, 5053103, 5053103, 91152256,
      91152256, 91152256, 15025844, 15025844, 15025844, 13039848, 13039848,
      13039848, 30113682, 30113682, 30113682, 41762634, 41762634, 41762634,
      32452818, 32452818, 32452818, 32274490, 32274490, 32274490, 75356564,
      75356564, 75356564, 84257639, 84257639, 84257639, 76103675, 76103675,
      76103675, 4206964, 4206964, 17814387, 17814387,
    ]);
    expect(preset.player.extra).toEqual([]);
    expect(preset.player.side).toEqual([]);
    expect(preset.opponent.extra).toEqual([]);
    expect(preset.opponent.side).toEqual([]);
    expect(uniqueDeckCodes(preset.player, preset.opponent).size).toBe(22);
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

  it("rejects cards outside the reviewed preset pool", () => {
    const deck = parseYdk(
      `#main\n${Array.from({ length: 40 }, () => "123").join("\n")}\n#extra\n!side`,
    );
    expect(() =>
      validateDeck(
        deck,
        new Set([123]),
        undefined,
        new Map([[123, { type: 0x40 }]]),
      ),
    ).toThrow(/outside the reviewed MVP pool/);
  });

  it("rejects unsupported Side Deck content", () => {
    const deck = parseYdk(
      `#main\n${Array.from({ length: 40 }, () => "123").join("\n")}\n#extra\n!side\n456`,
    );
    expect(() => validateDeck(deck, new Set([123, 456]))).toThrow(/Side Deck/);
  });
});
