import type { ChoiceId } from "../../duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptContribution,
} from "../../duel/contracts/player-prompt.ts";
import {
  contributionOptions,
  isValidContributionTotal,
} from "../../duel/prompt-sum.ts";
import { promptControlFamily } from "./prompt-control-family.ts";

export type PromptSelectionValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly message: string };

export function validatePromptSelection(
  prompt: PlayerPrompt,
  choiceIds: readonly ChoiceId[],
): PromptSelectionValidation {
  const choicesById = new Map(
    prompt.choices.map((choice) => [choice.id, choice] as const),
  );
  if (choiceIds.some((id) => !choicesById.has(id))) {
    return invalid("Unknown choice");
  }

  const family = promptControlFamily(prompt.kind);
  if (family === "counter") {
    if (choiceIds.length !== prompt.minimum) {
      return invalid(`Allocate exactly ${prompt.minimum} counters`);
    }
    const allocations = countChoices(choiceIds);
    for (const [id, amount] of allocations) {
      const maximum = choicesById.get(id)?.allocationMaximum ?? 0;
      if (amount > maximum) {
        return invalid("Counter allocation exceeds the available amount");
      }
    }
    return { valid: true };
  }

  if (new Set(choiceIds).size !== choiceIds.length) {
    return invalid(
      family === "order"
        ? "Include every choice exactly once"
        : "Select each choice at most once",
    );
  }

  if (family === "single" || family === "toggle") {
    return choiceIds.length === 1
      ? { valid: true }
      : invalid("Select exactly one choice");
  }

  if (family === "order") {
    if (choiceIds.length === 0 && prompt.cancelable) return { valid: true };
    return choiceIds.length === prompt.choices.length
      ? { valid: true }
      : invalid("Include every choice exactly once");
  }

  if (choiceIds.length === 0 && prompt.cancelable) return { valid: true };
  if (choiceIds.length < prompt.minimum || choiceIds.length > prompt.maximum) {
    return invalid(
      `Select between ${prompt.minimum} and ${prompt.maximum} choices`,
    );
  }

  if (prompt.kind === "selectSum" && prompt.requiredTotal !== undefined) {
    const selected = choiceIds.map((id) => {
      const card = choicesById.get(id)?.card;
      return contributionOptions({
        contribution: card?.contribution ?? 0,
        ...(card?.alternativeContribution === undefined
          ? {}
          : { alternativeContribution: card.alternativeContribution }),
      });
    });
    const mandatory = (prompt.mandatoryContributions ?? []).map(
      contributionOptions,
    );
    const mode = prompt.sumMode ?? "exact";
    if (
      !isValidContributionTotal(
        [...mandatory, ...selected],
        prompt.requiredTotal,
        mode,
      )
    ) {
      return invalid(
        mode === "exact"
          ? `Selection must total exactly ${prompt.requiredTotal}`
          : `Selection must reach at least ${prompt.requiredTotal}`,
      );
    }
  }

  return { valid: true };
}

export function describePromptConstraints(prompt: PlayerPrompt): string {
  const parts: string[] = [];
  const family = promptControlFamily(prompt.kind);
  if (family === "single" || family === "toggle") {
    parts.push("Choose one option.");
  } else if (family === "counter") {
    parts.push(`Allocate exactly ${prompt.minimum} counters.`);
  } else if (family === "order") {
    parts.push("Put every option in order.");
  } else if (prompt.minimum === prompt.maximum) {
    parts.push(`Choose exactly ${prompt.minimum}.`);
  } else {
    parts.push(`Choose ${prompt.minimum} to ${prompt.maximum}.`);
  }

  if (prompt.requiredTotal !== undefined) {
    parts.push(
      prompt.sumMode === "atLeast"
        ? `Selected contributions must reach at least ${prompt.requiredTotal}.`
        : `Selected contributions must total exactly ${prompt.requiredTotal}.`,
    );
  }
  const mandatory = prompt.mandatoryContributions ?? [];
  if (mandatory.length > 0) {
    parts.push(
      `Mandatory contributions: ${mandatory.map(formatContribution).join(" and ")}.`,
    );
  }
  if (prompt.cancelable) parts.push("Cancellation is allowed.");
  return parts.join(" ");
}

function formatContribution(value: PromptContribution): string {
  return value.alternativeContribution === undefined
    ? String(value.contribution)
    : `${value.contribution} or ${value.alternativeContribution}`;
}

function countChoices(
  values: readonly ChoiceId[],
): ReadonlyMap<ChoiceId, number> {
  const counts = new Map<ChoiceId, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function invalid(message: string): PromptSelectionValidation {
  return { valid: false, message };
}
