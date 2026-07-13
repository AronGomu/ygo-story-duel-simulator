import type { PromptContribution } from "../../duel/contracts/player-prompt.ts";

export {
  contributionOptions,
  findValidContributionSelection,
  isValidContributionTotal,
  type SumSelectionMode,
} from "../../duel/prompt-sum.ts";

export function decodeSumContribution(amount: number): PromptContribution {
  const contribution = amount & 0xffff;
  const alternative = amount >>> 16;
  return {
    contribution,
    ...(alternative === 0 || alternative === contribution
      ? {}
      : { alternativeContribution: alternative }),
  };
}
