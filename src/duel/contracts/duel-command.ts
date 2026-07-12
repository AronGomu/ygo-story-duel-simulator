import type { ChoiceId, DuelId, PromptId } from "./ids.ts";

export type DuelCommand =
  | { readonly type: "initialize" }
  | { readonly type: "startDuel"; readonly duelId: DuelId }
  | {
      readonly type: "respond";
      readonly promptId: PromptId;
      readonly choiceIds: readonly ChoiceId[];
    }
  | { readonly type: "surrender" }
  | { readonly type: "dispose" };
