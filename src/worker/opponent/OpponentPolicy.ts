import type { ChoiceId } from "../../duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
} from "../../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../duel/contracts/public-duel-state.ts";
import type { ActiveDuelDependencies } from "../assets/active-duel-dependencies.ts";

export type OpponentDecisionReason =
  | "summon_first_legal"
  | "special_summon_first_legal"
  | "activate_first_legal"
  | "set_first_legal"
  | "attack_strongest"
  | "advance_phase"
  | "decline_optional"
  | "answer_mandatory"
  | "select_first_legal"
  | "select_valid_sum"
  | "preserve_order";

export interface OpponentDecision {
  readonly choiceIds: readonly ChoiceId[];
  readonly reason: OpponentDecisionReason;
}

export interface OpponentPolicy {
  choose(prompt: PlayerPrompt, visibleState: PublicDuelState): OpponentDecision;
}

export class BasicOpponentPolicy implements OpponentPolicy {
  readonly #dependencies: ActiveDuelDependencies;

  constructor(dependencies: ActiveDuelDependencies) {
    this.#dependencies = dependencies;
  }

  choose(
    prompt: PlayerPrompt,
    visibleState: PublicDuelState,
  ): OpponentDecision {
    void visibleState;
    if (prompt.choices.length === 0)
      throw new Error(`Prompt ${prompt.kind} has no legal choices`);

    switch (prompt.kind) {
      case "idleCommand":
        return this.#chooseIdle(prompt);
      case "battleCommand": {
        const attacks = prompt.choices.filter(
          (choice) => choice.action === "attack",
        );
        if (attacks.length > 0) {
          const strongest = [...attacks].sort(
            (left, right) => this.#attack(right) - this.#attack(left),
          )[0];
          if (strongest !== undefined) {
            return { choiceIds: [strongest.id], reason: "attack_strongest" };
          }
        }
        return {
          choiceIds: [prefer(prompt.choices, ["mainPhase2", "endPhase"]).id],
          reason: "advance_phase",
        };
      }
      case "chain": {
        const pass = prompt.choices.find((choice) => choice.action === "pass");
        return pass === undefined
          ? { choiceIds: [prompt.choices[0]!.id], reason: "answer_mandatory" }
          : { choiceIds: [pass.id], reason: "decline_optional" };
      }
      case "yesNo":
      case "effectYesNo": {
        const no = prompt.choices.find((choice) => choice.action === "no");
        return no === undefined
          ? { choiceIds: [prompt.choices[0]!.id], reason: "answer_mandatory" }
          : { choiceIds: [no.id], reason: "decline_optional" };
      }
      case "selectSum": {
        const valid = validSum(prompt);
        return { choiceIds: valid, reason: "select_valid_sum" };
      }
      case "sortCard":
      case "sortChain":
        return {
          choiceIds: prompt.choices.map((choice) => choice.id),
          reason: "preserve_order",
        };
      case "selectCounter": {
        const selected = Array.from(
          { length: prompt.minimum },
          (_, index) => prompt.choices[index % prompt.choices.length]!.id,
        );
        return { choiceIds: selected, reason: "select_first_legal" };
      }
      case "selectCard":
      case "selectTribute":
      case "selectPlace":
      case "selectDisabledField":
      case "announceAttribute":
      case "announceRace": {
        return {
          choiceIds: prompt.choices
            .slice(0, prompt.minimum)
            .map((choice) => choice.id),
          reason: "select_first_legal",
        };
      }
      case "selectUnselectCard":
      case "option":
      case "selectPosition":
      case "announceNumber":
      case "announceCard":
      case "rockPaperScissors":
        return {
          choiceIds: [prompt.choices[0]!.id],
          reason: "select_first_legal",
        };
    }
  }

  #chooseIdle(prompt: PlayerPrompt): OpponentDecision {
    const priorities: readonly [
      readonly PromptChoice["action"][],
      OpponentDecisionReason,
    ][] = [
      [["summon"], "summon_first_legal"],
      [["specialSummon"], "special_summon_first_legal"],
      [["activate"], "activate_first_legal"],
      [["setMonster", "setSpellTrap"], "set_first_legal"],
      [["battlePhase", "endPhase"], "advance_phase"],
    ];
    for (const [actions, reason] of priorities) {
      const selected = prompt.choices.find((choice) =>
        actions.includes(choice.action),
      );
      if (selected !== undefined) return { choiceIds: [selected.id], reason };
    }
    return { choiceIds: [prompt.choices[0]!.id], reason: "answer_mandatory" };
  }

  #attack(choice: PromptChoice): number {
    const code = choice.card?.code;
    return code === undefined
      ? 0
      : (this.#dependencies.cards.get(code)?.attack ?? 0);
  }
}

function prefer(
  choices: readonly PromptChoice[],
  actions: readonly PromptChoice["action"][],
): PromptChoice {
  for (const action of actions) {
    const choice = choices.find((candidate) => candidate.action === action);
    if (choice !== undefined) return choice;
  }
  const first = choices[0];
  if (first === undefined) throw new Error("No legal prompt choice");
  return first;
}

function validSum(prompt: PlayerPrompt): readonly ChoiceId[] {
  const target = prompt.requiredTotal;
  if (target === undefined)
    return prompt.choices.slice(0, prompt.minimum).map((choice) => choice.id);

  const candidates = prompt.choices.map((choice) => ({
    id: choice.id,
    amount: choice.card?.contribution ?? 0,
  }));
  const maximumMask = 1 << Math.min(candidates.length, 20);
  for (let mask = 1; mask < maximumMask; mask += 1) {
    const selected = candidates.filter(
      (_, index) => (mask & (1 << index)) !== 0,
    );
    if (
      selected.length >= prompt.minimum &&
      selected.length <= prompt.maximum &&
      selected.reduce((sum, choice) => sum + choice.amount, 0) === target
    ) {
      return selected.map((choice) => choice.id);
    }
  }
  throw new Error(`No legal sum selection reaches ${target}`);
}
