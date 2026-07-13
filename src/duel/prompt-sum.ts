import type { PromptContribution } from "./contracts/player-prompt.ts";

export type SumSelectionMode = "exact" | "atLeast";

export function contributionOptions(
  value?: PromptContribution,
): readonly number[] {
  const contribution = value?.contribution ?? 0;
  const alternative = value?.alternativeContribution;
  return alternative === undefined
    ? [contribution]
    : [contribution, alternative];
}

export function isValidContributionTotal(
  options: readonly (readonly number[])[],
  target: number,
  mode: SumSelectionMode,
): boolean {
  if (
    options.length === 0 ||
    options.some((values) => values.every((value) => value <= 0))
  )
    return false;
  if (mode === "atLeast") {
    const minimums = options.map((values) => Math.min(...values));
    const maximum = options.reduce(
      (total, values) => total + Math.max(...values),
      0,
    );
    const minimum = minimums.reduce((total, value) => total + value, 0);
    return maximum >= target && minimum - Math.min(...minimums) < target;
  }

  let totals = new Set([0]);
  for (const values of options) {
    totals = new Set(
      [...totals].flatMap((total) =>
        values
          .map((value) => total + value)
          .filter((candidate) => candidate <= target),
      ),
    );
  }
  return totals.has(target);
}

export function findValidContributionSelection(
  candidates: readonly PromptContribution[],
  mandatory: readonly PromptContribution[],
  target: number,
  mode: SumSelectionMode,
  minimum: number,
  maximum: number,
): readonly number[] | null {
  return mode === "exact"
    ? findExactSelection(candidates, mandatory, target, minimum, maximum)
    : findAtLeastSelection(candidates, mandatory, target, minimum, maximum);
}

interface ExactState {
  readonly total: number;
  readonly selected: readonly number[];
}

function findExactSelection(
  candidates: readonly PromptContribution[],
  mandatory: readonly PromptContribution[],
  target: number,
  minimum: number,
  maximum: number,
): readonly number[] | null {
  let states = new Map<string, ExactState>();
  for (const total of possibleMandatoryTotals(mandatory, target)) {
    states.set(exactStateKey(0, total), { total, selected: [] });
  }

  candidates.forEach((candidate, index) => {
    const next = new Map(states);
    for (const state of states.values()) {
      if (state.selected.length >= maximum) continue;
      for (const contribution of contributionOptions(candidate)) {
        const total = state.total + contribution;
        if (contribution <= 0 || total > target) continue;
        const selected = [...state.selected, index];
        const key = exactStateKey(selected.length, total);
        if (!next.has(key)) next.set(key, { total, selected });
      }
    }
    states = next;
  });

  for (let count = minimum; count <= maximum; count += 1) {
    const state = states.get(exactStateKey(count, target));
    if (state !== undefined) return state.selected;
  }
  return null;
}

function possibleMandatoryTotals(
  mandatory: readonly PromptContribution[],
  target: number,
): ReadonlySet<number> {
  let totals = new Set([0]);
  for (const contribution of mandatory) {
    totals = new Set(
      [...totals].flatMap((total) =>
        contributionOptions(contribution)
          .map((value) => total + value)
          .filter((candidate) => candidate <= target),
      ),
    );
  }
  return totals;
}

function exactStateKey(count: number, total: number): string {
  return `${count}:${total}`;
}

interface AtLeastState {
  readonly selected: readonly number[];
  readonly minimum: number;
  readonly maximum: number;
  readonly smallest: number;
}

function findAtLeastSelection(
  candidates: readonly PromptContribution[],
  mandatory: readonly PromptContribution[],
  target: number,
  minimumCount: number,
  maximumCount: number,
): readonly number[] | null {
  const initial = mandatory.reduce<AtLeastState>(
    (state, contribution) => addAtLeastContribution(state, contribution),
    { selected: [], minimum: 0, maximum: 0, smallest: Infinity },
  );
  let states = new Map([[atLeastStateKey(initial, target), initial]]);
  if (minimumCount === 0 && isValidAtLeastState(initial, target)) return [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const next = new Map(states);
    for (const state of states.values()) {
      if (state.selected.length >= maximumCount) continue;
      const withCandidate = addAtLeastContribution(state, candidate, index);
      if (!canStillSatisfyAtLeast(withCandidate, target)) continue;
      const key = atLeastStateKey(withCandidate, target);
      if (!next.has(key)) next.set(key, withCandidate);
    }
    states = next;

    for (const state of states.values()) {
      if (
        state.selected.length >= minimumCount &&
        state.selected.length <= maximumCount &&
        isValidAtLeastState(state, target)
      ) {
        return state.selected;
      }
    }
  }
  return null;
}

function addAtLeastContribution(
  state: AtLeastState,
  contribution: PromptContribution,
  selectedIndex?: number,
): AtLeastState {
  const values = contributionOptions(contribution);
  const minimum = Math.min(...values);
  return {
    selected:
      selectedIndex === undefined
        ? state.selected
        : [...state.selected, selectedIndex],
    minimum: state.minimum + minimum,
    maximum: state.maximum + Math.max(...values),
    smallest: Math.min(state.smallest, minimum),
  };
}

function canStillSatisfyAtLeast(state: AtLeastState, target: number): boolean {
  return state.smallest === Infinity || state.minimum - state.smallest < target;
}

function isValidAtLeastState(state: AtLeastState, target: number): boolean {
  return (
    state.smallest !== Infinity &&
    state.maximum >= target &&
    state.minimum - state.smallest < target
  );
}

function atLeastStateKey(state: AtLeastState, target: number): string {
  return `${state.selected.length}:${state.minimum}:${Math.min(state.maximum, target)}:${state.smallest}`;
}
