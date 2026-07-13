import { describe, expect, it } from "vitest";
import type { PromptKind } from "../../src/duel/contracts/player-prompt.ts";
import {
  PROMPT_CONTROL_FAMILIES,
  promptControlFamily,
} from "../../src/app/prompts/prompt-control-family.ts";

const ALL_PROMPT_KINDS = [
  "idleCommand",
  "battleCommand",
  "yesNo",
  "effectYesNo",
  "option",
  "chain",
  "selectCard",
  "selectTribute",
  "selectSum",
  "selectUnselectCard",
  "selectPlace",
  "selectDisabledField",
  "selectPosition",
  "sortCard",
  "sortChain",
  "selectCounter",
  "announceNumber",
  "announceAttribute",
  "announceRace",
  "announceCard",
  "rockPaperScissors",
] as const satisfies readonly PromptKind[];

describe("prompt control classification", () => {
  it("classifies every PlayerPrompt kind exhaustively", () => {
    expect(Object.keys(PROMPT_CONTROL_FAMILIES).sort()).toEqual(
      [...ALL_PROMPT_KINDS].sort(),
    );
    expect(ALL_PROMPT_KINDS.map(promptControlFamily)).toEqual([
      "single",
      "single",
      "single",
      "single",
      "single",
      "single",
      "multiple",
      "multiple",
      "multiple",
      "toggle",
      "multiple",
      "multiple",
      "single",
      "order",
      "order",
      "counter",
      "single",
      "multiple",
      "multiple",
      "single",
      "single",
    ]);
  });
});
