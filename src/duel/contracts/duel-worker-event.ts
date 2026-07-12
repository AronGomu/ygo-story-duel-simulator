import type { DuelError } from "./duel-error.ts";
import type { DuelPresentationEvent } from "./duel-presentation-event.ts";
import type { DuelResult } from "./duel-result.ts";
import type { PlayerPrompt } from "./player-prompt.ts";
import type { PublicDuelState } from "./public-duel-state.ts";

export type DuelWorkerEvent =
  | { readonly type: "ready"; readonly coreVersion: readonly [number, number] }
  | {
      readonly type: "loading";
      readonly stage: string;
      readonly progress?: number;
    }
  | { readonly type: "state"; readonly state: PublicDuelState }
  | { readonly type: "event"; readonly event: DuelPresentationEvent }
  | { readonly type: "prompt"; readonly prompt: PlayerPrompt }
  | { readonly type: "result"; readonly result: DuelResult }
  | { readonly type: "error"; readonly error: DuelError };
