import type { PlayerIndex } from "../../duel/contracts/public-duel-state.ts";
import type { InteractionSessionAction } from "../prompts/interaction-session.ts";
import { sameInteractionKey } from "../prompts/interaction-session.ts";
import {
  endPhaseChoice,
  type ActiveInteractionSpec,
  type InteractionKey,
} from "../prompts/interaction-spec.ts";

export interface EndTurnAutomationState {
  readonly status: "idle" | "armed";
  readonly sessionGeneration: number | null;
  readonly lastDispatchedKey: InteractionKey | null;
}

export interface EndTurnAutomationInput {
  readonly turnPlayer: PlayerIndex;
  readonly duelFinished: boolean;
  readonly responsePending: boolean;
  readonly sessionGeneration: number;
  readonly spec: ActiveInteractionSpec | null;
}

export type EndTurnAutomationEvent =
  | Readonly<{ type: "arm" }>
  | Readonly<{ type: "sync"; input: EndTurnAutomationInput }>
  | Readonly<{ type: "reset" }>;

export interface EndTurnAutomationReduction {
  readonly state: EndTurnAutomationState;
  readonly action: InteractionSessionAction | null;
}

const IDLE_STATE: EndTurnAutomationState = Object.freeze({
  status: "idle",
  sessionGeneration: null,
  lastDispatchedKey: null,
});

export function reduceEndTurnAutomation(
  state: EndTurnAutomationState,
  event: EndTurnAutomationEvent,
): EndTurnAutomationReduction {
  if (event.type === "reset") return reduction(IDLE_STATE);
  if (event.type === "arm") {
    return state.status === "armed"
      ? reduction(state)
      : reduction(
          Object.freeze({
            status: "armed",
            sessionGeneration: null,
            lastDispatchedKey: null,
          }),
        );
  }
  if (state.status === "idle") return reduction(state);

  const { input } = event;
  if (input.duelFinished || input.turnPlayer !== 0)
    return reduction(IDLE_STATE);
  if (
    state.sessionGeneration !== null &&
    state.sessionGeneration !== input.sessionGeneration
  ) {
    return reduction(IDLE_STATE);
  }

  const synchronizedState =
    state.sessionGeneration === null
      ? Object.freeze({
          ...state,
          sessionGeneration: input.sessionGeneration,
        })
      : state;
  if (
    input.responsePending ||
    input.spec === null ||
    input.spec.key.sessionGeneration !== input.sessionGeneration
  ) {
    return reduction(synchronizedState);
  }

  const choice = endPhaseChoice(input.spec);
  if (
    choice === null ||
    sameInteractionKey(synchronizedState.lastDispatchedKey, input.spec.key)
  ) {
    return reduction(synchronizedState);
  }

  const nextState = Object.freeze({
    ...synchronizedState,
    lastDispatchedKey: input.spec.key,
  });
  return reduction(
    nextState,
    Object.freeze({
      type: "chooseChoice",
      choiceId: choice.id,
      key: input.spec.key,
    }),
  );
}

function reduction(
  state: EndTurnAutomationState,
  action: InteractionSessionAction | null = null,
): EndTurnAutomationReduction {
  return Object.freeze({ state, action });
}
