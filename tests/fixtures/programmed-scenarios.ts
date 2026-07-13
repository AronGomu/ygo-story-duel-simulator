import { readFile } from "node:fs/promises";
import type { CardCode } from "../../src/duel/contracts/ids.ts";
import type { CoreStartupScript } from "../../src/worker/engine/DuelSession.ts";
import type {
  ChoiceAction,
  PromptKind,
} from "../../src/duel/contracts/player-prompt.ts";
import type { PlayerIndex } from "../../src/duel/contracts/public-duel-state.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset.ts";
import type { ProgrammedTranscriptId } from "./programmed-transcript.ts";

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
  readonly transcript?: ProgrammedTranscriptId;
  readonly startupScripts?: readonly CoreStartupScript[];
  readonly allowFirstTurnAttack?: boolean;
  readonly expectedWinner: PlayerIndex;
  readonly expectedFinishReason: "lp_zero" | "deck_out" | "surrender";
}

export async function loadProgrammedScenarios(): Promise<
  readonly ProgrammedScenario[]
> {
  const [preset, promptMatrixSource, sortChainSource] = await Promise.all([
    loadMvpPreset(),
    readFixtureScript("prompt-matrix.lua"),
    readFixtureScript("sort-chain.lua"),
  ]);
  const battlePlayerOrder = preset.player.main;
  const tributePlayerOrder = rotateToFront(
    preset.player.main,
    [
      15025844, 70781052, 83764718, 5758500, 4031928, 12580477, 84257639,
      76103675,
    ],
  );
  const effectsPlayerOrder = rotateToFront(
    preset.player.main,
    [
      76103675, 84257639, 15025844, 4206964, 44095762, 97590747, 91152256,
      5053103,
    ],
  );
  return [
    {
      id: "battle-and-chain",
      seed: [1n, 2n, 3n, 4n],
      deckOrder: [battlePlayerOrder, preset.opponent.main],
      startingHands: [
        battlePlayerOrder.slice(0, 5),
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
      transcript: "basic-duel-v1",
      expectedWinner: 1,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "tribute-special-and-target",
      seed: [5n, 6n, 7n, 8n],
      deckOrder: [tributePlayerOrder, preset.opponent.main],
      startingHands: [
        tributePlayerOrder.slice(0, 5),
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
      transcript: "tribute-special-v1",
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "effects-recovery-and-position",
      seed: [9n, 10n, 11n, 12n],
      deckOrder: [effectsPlayerOrder, preset.opponent.main],
      startingHands: [
        effectsPlayerOrder.slice(0, 5),
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "idleCommand", action: "activate", card: 76103675 },
        { prompt: "idleCommand", action: "activate", card: 84257639 },
        { prompt: "idleCommand", action: "setMonster", card: 15025844 },
        { prompt: "idleCommand", action: "flipSummon", card: 15025844 },
        { prompt: "idleCommand", action: "changePosition", card: 15025844 },
      ],
      transcript: "effects-recovery-v1",
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "real-wasm-prompt-matrix",
      seed: [13n, 14n, 15n, 16n],
      deckOrder: [preset.player.main, preset.opponent.main],
      startingHands: [
        preset.player.main.slice(0, 5),
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "selectCounter", action: "select" },
        { prompt: "yesNo", action: "no" },
        { prompt: "effectYesNo", action: "no" },
        { prompt: "option", action: "select" },
        { prompt: "selectSum", action: "select" },
        { prompt: "selectUnselectCard", action: "select" },
        { prompt: "selectDisabledField", action: "select" },
        { prompt: "sortCard", action: "select" },
        { prompt: "announceNumber", action: "select" },
        { prompt: "announceAttribute", action: "select" },
        { prompt: "announceRace", action: "select" },
        { prompt: "announceCard", action: "select" },
        { prompt: "rockPaperScissors", action: "select" },
      ],
      transcript: "prompt-matrix-v1",
      startupScripts: [
        { name: "mvp_prompt_matrix.lua", source: promptMatrixSource },
      ],
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "shuffle-and-sort-chain",
      seed: [17n, 18n, 19n, 20n],
      deckOrder: [preset.player.main, preset.opponent.main],
      startingHands: [
        preset.player.main.slice(0, 5),
        preset.opponent.main.slice(0, 5),
      ],
      choices: [
        { prompt: "idleCommand", action: "shuffle" },
        { prompt: "idleCommand", action: "battlePhase" },
        { prompt: "battleCommand", action: "attack" },
        { prompt: "sortChain", action: "select" },
      ],
      transcript: "sort-chain-v1",
      startupScripts: [{ name: "mvp_sort_chain.lua", source: sortChainSource }],
      allowFirstTurnAttack: true,
      expectedWinner: 0,
      expectedFinishReason: "lp_zero",
    },
    {
      id: "surrender-at-opening",
      seed: [21n, 22n, 23n, 24n],
      deckOrder: [preset.player.main, preset.opponent.main],
      startingHands: [
        preset.player.main.slice(0, 5),
        preset.opponent.main.slice(0, 5),
      ],
      choices: [],
      transcript: "surrender-v1",
      expectedWinner: 1,
      expectedFinishReason: "surrender",
    },
  ];
}

async function readFixtureScript(name: string): Promise<string> {
  return readFile(new URL(`./core-scripts/${name}`, import.meta.url), "utf8");
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
