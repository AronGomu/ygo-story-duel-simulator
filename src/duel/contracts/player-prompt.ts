import type { CardCode, CardInstanceId, ChoiceId, PromptId } from "./ids.ts";
import type {
  CardPosition,
  PlayerIndex,
  PublicLocation,
} from "./public-duel-state.ts";

export type PromptKind =
  | "idleCommand"
  | "battleCommand"
  | "yesNo"
  | "effectYesNo"
  | "option"
  | "chain"
  | "selectCard"
  | "selectTribute"
  | "selectSum"
  | "selectUnselectCard"
  | "selectPlace"
  | "selectDisabledField"
  | "selectPosition"
  | "sortCard"
  | "sortChain"
  | "selectCounter"
  | "announceNumber"
  | "announceAttribute"
  | "announceRace"
  | "announceCard"
  | "rockPaperScissors";

export type ChoiceAction =
  | "summon"
  | "specialSummon"
  | "flipSummon"
  | "setMonster"
  | "setSpellTrap"
  | "activate"
  | "changePosition"
  | "attack"
  | "battlePhase"
  | "mainPhase2"
  | "endPhase"
  | "shuffle"
  | "yes"
  | "no"
  | "pass"
  | "cancel"
  | "finish"
  | "select";

export interface PromptCard {
  readonly instanceId: CardInstanceId;
  readonly code?: CardCode;
  readonly name?: string;
  readonly description?: string;
  readonly controller: PlayerIndex;
  readonly location: PublicLocation;
  readonly sequence: number;
  readonly position?: CardPosition;
  readonly contribution?: number;
  readonly alternativeContribution?: number;
}

export interface PromptContribution {
  readonly contribution: number;
  readonly alternativeContribution?: number;
}

export interface PromptPlace {
  readonly player: PlayerIndex;
  readonly location: "monster" | "spellTrap" | "field" | "pendulum";
  readonly sequence: number;
}

export interface PromptChoice {
  readonly id: ChoiceId;
  readonly label: string;
  readonly action: ChoiceAction;
  readonly card?: PromptCard;
  readonly place?: PromptPlace;
  readonly value?: number | string;
  readonly selected?: boolean;
  readonly allocationMaximum?: number;
}

export interface PlayerPrompt {
  readonly id: PromptId;
  readonly kind: PromptKind;
  readonly player: PlayerIndex;
  readonly title: string;
  readonly message?: string;
  readonly contextCard?: PromptCard;
  readonly choices: readonly PromptChoice[];
  readonly minimum: number;
  readonly maximum: number;
  readonly cancelable: boolean;
  readonly ordered: boolean;
  readonly requiredTotal?: number;
  readonly sumMode?: "exact" | "atLeast";
  readonly mandatoryContributions?: readonly PromptContribution[];
}
