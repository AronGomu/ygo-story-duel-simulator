import type { PromptKind } from "../../duel/contracts/player-prompt.ts";

export type PromptControlFamily =
  "single" | "multiple" | "toggle" | "order" | "counter";

export const PROMPT_CONTROL_FAMILIES = {
  idleCommand: "single",
  battleCommand: "single",
  yesNo: "single",
  effectYesNo: "single",
  option: "single",
  chain: "single",
  selectCard: "multiple",
  selectTribute: "multiple",
  selectSum: "multiple",
  selectUnselectCard: "toggle",
  selectPlace: "multiple",
  selectDisabledField: "multiple",
  selectPosition: "single",
  sortCard: "order",
  sortChain: "order",
  selectCounter: "counter",
  announceNumber: "single",
  announceAttribute: "multiple",
  announceRace: "multiple",
  announceCard: "single",
  rockPaperScissors: "single",
} as const satisfies Readonly<Record<PromptKind, PromptControlFamily>>;

export function promptControlFamily(kind: PromptKind): PromptControlFamily {
  return PROMPT_CONTROL_FAMILIES[kind];
}
