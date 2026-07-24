import {
  PROTOTYPE_SCREENS,
  type BattleResult,
  type ChoiceId,
  type PrototypeScreen,
} from "../model/prototype-state.ts";

export type ReviewMapState =
  | "default"
  | "available"
  | "locked"
  | "hidden"
  | "completed"
  | "available-completed";
export interface ReviewState {
  readonly screen: PrototypeScreen;
  readonly choice: ChoiceId | null;
  readonly map: ReviewMapState;
  readonly outcome: BattleResult | null;
  readonly missingAssets: boolean;
  readonly storageFailure: boolean;
  readonly reducedMotion: boolean;
}

export const DEFAULT_REVIEW_STATE: ReviewState = {
  screen: "launcher",
  choice: null,
  map: "default",
  outcome: null,
  missingAssets: false,
  storageFailure: false,
  reducedMotion: false,
};

const choices = ["trust-rin", "challenge-rin", "observe-first"] as const;
const maps = [
  "default",
  "available",
  "locked",
  "hidden",
  "completed",
  "available-completed",
] as const;
const outcomes = ["win", "loss", "abort", "failure"] as const;

export function serializeReviewLink(state: ReviewState): string {
  const query = new URLSearchParams();
  query.set("screen", state.screen);
  if (state.choice !== null) query.set("choice", state.choice);
  if (state.map !== "default") query.set("map", state.map);
  if (state.outcome !== null) query.set("outcome", state.outcome);
  if (state.missingAssets) query.set("missing", "1");
  if (state.storageFailure) query.set("storage", "1");
  if (state.reducedMotion) query.set("motion", "1");
  return `?${query.toString()}`;
}

export function parseReviewLink(query: string): ReviewState {
  const params = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  const screen = params.get("screen");
  const choice = params.get("choice");
  const map = params.get("map");
  const outcome = params.get("outcome");
  return {
    screen: includes(PROTOTYPE_SCREENS, screen) ? screen : "launcher",
    choice: includes(choices, choice) ? choice : null,
    map: includes(maps, map) ? map : "default",
    outcome: includes(outcomes, outcome) ? outcome : null,
    missingAssets: params.get("missing") === "1",
    storageFailure: params.get("storage") === "1",
    reducedMotion: params.get("motion") === "1",
  };
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: string | null,
): value is Values[number] {
  return value !== null && values.includes(value as Values[number]);
}
