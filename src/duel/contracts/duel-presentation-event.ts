import type { CardCode, CardInstanceId } from "./ids.ts";
import type {
  CardPosition,
  DuelPhase,
  PlayerIndex,
  PublicLocation,
} from "./public-duel-state.ts";

export type DuelPresentationEvent =
  | { readonly type: "duelStarted" }
  | {
      readonly type: "turnStarted";
      readonly player: PlayerIndex;
      readonly turn: number;
    }
  | { readonly type: "phaseChanged"; readonly phase: DuelPhase }
  | {
      readonly type: "cardDrawn";
      readonly player: PlayerIndex;
      readonly count: number;
    }
  | {
      readonly type: "cardMoved";
      readonly card?: CardCode;
      readonly instanceId?: CardInstanceId;
      readonly from: PublicLocation;
      readonly to: PublicLocation;
    }
  | {
      readonly type: "summon" | "specialSummon" | "flipSummon" | "set";
      readonly player: PlayerIndex;
      readonly card?: CardCode;
    }
  | {
      readonly type: "positionChanged";
      readonly card?: CardCode;
      readonly position: CardPosition;
    }
  | {
      readonly type: "attack";
      readonly player: PlayerIndex;
      readonly direct: boolean;
    }
  | {
      readonly type: "damage" | "recover";
      readonly player: PlayerIndex;
      readonly amount: number;
    }
  | {
      readonly type: "lifePointsChanged";
      readonly player: PlayerIndex;
      readonly lifePoints: number;
    }
  | { readonly type: "chainChanged"; readonly size: number }
  | { readonly type: "hint"; readonly message: string };
