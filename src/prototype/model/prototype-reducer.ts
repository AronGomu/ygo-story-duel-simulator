import {
  CHOICE_RESPONSES,
  LATER_ACKNOWLEDGMENTS,
} from "../content/prologue.ts";
import {
  createInitialPrototypeState,
  type BattleResult,
  type ChoiceId,
  type LocationId,
  type PrototypeState,
} from "./prototype-state.ts";

export type PrototypeCommand =
  | { readonly type: "new-game" }
  | { readonly type: "continue" }
  | { readonly type: "load"; readonly slot: "manual" | "autosave" | "empty" }
  | { readonly type: "advance"; readonly inputId: number }
  | { readonly type: "choose"; readonly choice: ChoiceId }
  | { readonly type: "go-to-map" }
  | { readonly type: "select-location"; readonly locationId: LocationId }
  | { readonly type: "start-battle" }
  | { readonly type: "battle-result"; readonly result: BattleResult }
  | { readonly type: "continue-outcome" }
  | { readonly type: "acknowledge-reward" }
  | { readonly type: "reset" };

export function reducePrototype(
  state: PrototypeState,
  command: PrototypeCommand,
): PrototypeState {
  switch (command.type) {
    case "new-game":
      return {
        ...createInitialPrototypeState(),
        screen: "narrative",
        savedScreen: "narrative",
        progressExists: true,
      };
    case "continue":
      return state.progressExists
        ? { ...state, screen: state.savedScreen }
        : state;
    case "load":
      if (command.slot === "empty") return state;
      return {
        ...state,
        progressExists: true,
        screen: command.slot === "manual" ? "narrative" : "map",
        savedScreen: command.slot === "manual" ? "narrative" : "map",
        narrativeIndex: command.slot === "manual" ? 18 : state.narrativeIndex,
      };
    case "advance":
      if (state.screen !== "narrative" || state.lastInputId === command.inputId)
        return state;
      return {
        ...state,
        narrativeIndex: state.narrativeIndex + 1,
        lastInputId: command.inputId,
      };
    case "choose":
      if (state.screen !== "narrative" || state.choice !== null) return state;
      return {
        ...state,
        choice: command.choice,
        choiceResponse: CHOICE_RESPONSES[command.choice],
      };
    case "go-to-map":
      return {
        ...state,
        screen: "map",
        savedScreen: "map",
        laterAcknowledgment:
          state.choice === null ? null : LATER_ACKNOWLEDGMENTS[state.choice],
      };
    case "select-location": {
      if (state.screen !== "map") return state;
      const location = state.locations.find(
        ({ id }) => id === command.locationId,
      );
      return location?.access === "available"
        ? { ...state, screen: "pre-battle" }
        : state;
    }
    case "start-battle":
      return state.screen === "pre-battle"
        ? { ...state, screen: "battle-mock" }
        : state;
    case "battle-result":
      if (state.screen !== "battle-mock") return state;
      return {
        ...state,
        screen: "outcome",
        outcome: command.result,
        outcomeScene: outcomeScene(command.result),
      };
    case "continue-outcome":
      if (state.screen !== "outcome") return state;
      if (state.outcome === "abort" || state.outcome === "failure")
        return { ...state, screen: "map", outcome: null, outcomeScene: null };
      if (state.outcome !== "win" && state.outcome !== "loss") return state;
      return state.rewardGranted
        ? {
            ...state,
            screen: "map",
            outcome: null,
            outcomeScene: null,
            savedScreen: "map",
          }
        : { ...state, screen: "reward", rewardGranted: true };
    case "acknowledge-reward":
      if (state.screen !== "reward" || state.rewardAcknowledged) return state;
      return {
        ...state,
        screen: "map",
        savedScreen: "map",
        rewardAcknowledged: true,
        objective: "Signal decoded — inspect the newly opened Archive route",
        locations: state.locations.map((location) =>
          location.id === "old-arena"
            ? { ...location, completed: true }
            : location.id === "archive"
              ? { ...location, access: "available" }
              : location,
        ),
      };
    case "reset":
      return createInitialPrototypeState();
  }
}

function outcomeScene(result: BattleResult): string {
  switch (result) {
    case "win":
      return "The arena signal fractures beneath your final attack.";
    case "loss":
      return "Your field fades, but the signal opens a channel instead of closing one.";
    case "abort":
      return "The duel pauses safely. Retry or return when ready.";
    case "failure":
      return "Technical failure interrupted the simulation; no story defeat occurred.";
  }
}
