import type { PlayerIndex } from "./public-duel-state.ts";

export type DuelResult =
  | {
      readonly type: "completed";
      readonly winner: PlayerIndex;
      readonly loser: PlayerIndex;
      readonly reason: number;
    }
  | {
      readonly type: "surrendered";
      readonly winner: PlayerIndex;
      readonly loser: PlayerIndex;
    }
  | {
      readonly type: "unsupported";
      readonly messageType: number;
      readonly detail: string;
    }
  | { readonly type: "engineError"; readonly detail: string };
