import type { CardCode } from "../../src/duel/contracts/ids.ts";
import type {
  ChoiceAction,
  PromptKind,
} from "../../src/duel/contracts/player-prompt.ts";
import type { PlayerIndex } from "../../src/duel/contracts/public-duel-state.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset.ts";

export interface ProgrammedChoice {
  readonly prompt: PromptKind;
  readonly action?: ChoiceAction;
  readonly card?: number;
  readonly value?: number | string;
  readonly occurrence?: number;
}

export interface ProgrammedScenario {
  readonly id: string;
  readonly seed: readonly [bigint, bigint, bigint, bigint];
  readonly deckOrder: readonly [readonly CardCode[], readonly CardCode[]];
  readonly startingHands: readonly [readonly CardCode[], readonly CardCode[]];
  readonly choices: readonly ProgrammedChoice[];
  readonly expectedWinner: PlayerIndex;
  readonly expectedFinishReason: "lp_zero" | "deck_out" | "surrender";
}

export async function loadProgrammedScenarios(): Promise<
  readonly ProgrammedScenario[]
> {
  const preset = await loadMvpPreset();
  return [
    {
      id: "battle-and-chain",
      seed: [1n, 2n, 3n, 4n],
      deckOrder: [preset.player.main, preset.opponent.main],
      startingHands: [
        preset.player.main.slice(0, 5),
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "idleCommand", action: "summon", card: 97590747 },
        { prompt: "idleCommand", action: "setSpellTrap", card: 4206964 },
        { prompt: "idleCommand", action: "battlePhase" },
        { prompt: "battleCommand", action: "attack" },
        { prompt: "chain", action: "pass" },
        { prompt: "battleCommand", action: "endPhase" },
      ],
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "tribute-special-and-target",
      seed: [5n, 6n, 7n, 8n],
      deckOrder: [
        rotateToFront(preset.player.main, [89631139, 83764718, 5758500]),
        preset.opponent.main,
      ],
      startingHands: [
        [89631139, 83764718, 5758500] as CardCode[],
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "idleCommand", action: "setMonster" },
        { prompt: "idleCommand", action: "summon", card: 89631139 },
        { prompt: "selectTribute", action: "select" },
        { prompt: "idleCommand", action: "activate", card: 83764718 },
        { prompt: "selectCard", action: "select" },
        { prompt: "idleCommand", action: "activate", card: 5758500 },
        { prompt: "selectCard", action: "select" },
      ],
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "effects-recovery-and-position",
      seed: [9n, 10n, 11n, 12n],
      deckOrder: [
        rotateToFront(preset.player.main, [76103675, 84257639, 15025844]),
        preset.opponent.main,
      ],
      startingHands: [
        [76103675, 84257639, 15025844] as CardCode[],
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "idleCommand", action: "activate", card: 76103675 },
        { prompt: "idleCommand", action: "activate", card: 84257639 },
        { prompt: "idleCommand", action: "setMonster", card: 15025844 },
        { prompt: "idleCommand", action: "flipSummon", card: 15025844 },
        { prompt: "idleCommand", action: "changePosition", card: 15025844 },
      ],
      expectedWinner: 1,
      expectedFinishReason: "lp_zero",
    },
  ];
}

function rotateToFront(
  deck: readonly CardCode[],
  requested: readonly number[],
): readonly CardCode[] {
  const remaining = [...deck];
  const front = requested.map((requestedCode) => {
    const index = remaining.findIndex((code) => code === requestedCode);
    if (index < 0)
      throw new Error(
        `Programmed card ${requestedCode} is not in the preset deck`,
      );
    const [code] = remaining.splice(index, 1);
    if (code === undefined)
      throw new Error(`Programmed card ${requestedCode} could not be selected`);
    return code;
  });
  return [...front, ...remaining];
}
