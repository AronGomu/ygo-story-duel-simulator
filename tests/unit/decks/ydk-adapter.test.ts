import { describe, expect, it } from "vitest";
import {
  exportYdk,
  importYdk,
  MAXIMUM_YDK_CARDS,
  MAXIMUM_YDK_SOURCE_LENGTH,
  ydkFilename,
} from "../../../src/decks/ydk-adapter.ts";

describe("YDK adapter", () => {
  it("round-trips Main, Extra, Side, comments, and CRLF", () => {
    const source =
      "#created by test\r\n#main\r\n1\r\n1\r\n#extra\r\n2\r\n!side\r\n3\r\n";
    const imported = importYdk(source);
    expect(imported).toEqual({
      type: "ready",
      cards: { main: [1, 1], extra: [2], side: [3] },
    });
    if (imported.type === "ready")
      expect(importYdk(exportYdk(imported.cards))).toEqual(imported);
  });

  it("reports exact malformed line without silently repairing", () => {
    expect(importYdk("#main\n1\nbad\n#extra\n!side\n")).toMatchObject({
      type: "invalid",
      line: 3,
      message: "Invalid card code at deck line 3: bad",
    });
  });

  it("rejects oversized source and card counts", () => {
    expect(importYdk("x".repeat(MAXIMUM_YDK_SOURCE_LENGTH + 1))).toMatchObject({
      type: "invalid",
      message: expect.stringContaining("characters"),
    });
    const cards = Array.from({ length: MAXIMUM_YDK_CARDS + 1 }, () => "1").join(
      "\n",
    );
    expect(importYdk(`#main\n${cards}\n#extra\n!side`)).toMatchObject({
      type: "invalid",
      message: expect.stringContaining("cards"),
    });
  });

  it("preserves unknown codes and sanitizes export filenames", () => {
    expect(importYdk("#main\n99999999\n#extra\n!side\n")).toMatchObject({
      type: "ready",
      cards: { main: [99999999] },
    });
    expect(ydkFilename("  My / unsafe : deck  ")).toBe("My-unsafe-deck.ydk");
  });
});
