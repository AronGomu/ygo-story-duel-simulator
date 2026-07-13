import { createHash } from "node:crypto";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/duel/presets/deck-parser.ts";
import type { MvpPreset } from "../../src/duel/presets/mvp-preset.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset-node.ts";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTrace } from "../../src/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/worker/engine/DuelSession.ts";
import { EngineMessageType } from "../../src/worker/engine/engine-constants.ts";
import type { OcgCoreAdapter } from "../../src/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/worker/engine/load-vendored-core-node.ts";
import {
  HeadlessDuelController,
  type DuelAdvance,
} from "../../src/worker/HeadlessDuelController.ts";
import {
  EXECUTED_PROGRAMMED_COVERAGE,
  actionCoverageKey,
  promptCoverageKey,
  type MvpCoverageKey,
} from "../fixtures/action-coverage.ts";
import {
  expandProgrammedResponses,
  loadProgrammedTranscript,
  resolveProgrammedResponse,
  type ProgrammedResponse,
  type ProgrammedSelectionFingerprint,
} from "../fixtures/programmed-transcript.ts";
import {
  loadProgrammedScenarios,
  type ProgrammedScenario,
} from "../fixtures/programmed-scenarios.ts";

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: MvpPreset;
let scenarios: readonly ProgrammedScenario[];

const TARGETING_CARD_CODES = new Set([4031928, 5758500, 83764718]);
const DESTRUCTION_CARD_CODES = new Set([4206964, 44095762, 12580477]);

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  preset = await loadMvpPreset();
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve("generated/assets/current"),
    uniqueDeckCodes(preset.player, preset.opponent),
  );
  scenarios = await loadProgrammedScenarios();
});

describe("programmed real-WASM duels", () => {
  it("replays every persisted human response without policy fallback twice", async () => {
    const executable = scenarios.filter(
      (
        scenario,
      ): scenario is ProgrammedScenario & {
        transcript: NonNullable<ProgrammedScenario["transcript"]>;
      } => scenario.transcript !== undefined,
    );
    expect(executable.length).toBeGreaterThan(0);

    const completed = new Map<string, ProgrammedDuelRun>();
    for (const scenario of executable) {
      const transcript = await loadProgrammedTranscript(scenario.transcript);
      expect(transcript.scenarioId).toBe(scenario.id);
      const responses = expandProgrammedResponses(transcript);
      const first = playProgrammedDuel(scenario, responses);
      const second = playProgrammedDuel(scenario, responses);

      expect(first.result).toEqual(expectedResult(scenario));
      expect(second.result).toEqual(first.result);
      const firstDigest = traceDigest(first.trace);
      expect(traceDigest(second.trace)).toBe(firstDigest);
      expect(firstDigest).toBe(transcript.expectedTraceSha256);
      expect(first.humanResponses).toBe(transcript.responseCount);
      expect(first.engineDiagnostics).toEqual([]);
      expect(second.engineDiagnostics).toEqual([]);
      expect(first.sessionDisposed).toBe(true);
      expect(second.sessionDisposed).toBe(true);
      expect(first.coverage).toEqual(EXECUTED_PROGRAMMED_COVERAGE[scenario.id]);
      expect(second.coverage).toEqual(first.coverage);
      completed.set(scenario.id, first);
    }

    const basic = completed.get("battle-and-chain");
    if (basic === undefined) throw new Error("Basic scenario did not execute");
    const messageTypes = messageTypesIn(basic.trace);
    for (const required of [
      EngineMessageType.DRAW,
      EngineMessageType.NEW_TURN,
      EngineMessageType.NEW_PHASE,
      EngineMessageType.SELECT_IDLE_COMMAND,
      EngineMessageType.SELECT_PLACE,
      EngineMessageType.SELECT_CHAIN,
      EngineMessageType.SELECT_BATTLE_COMMAND,
      EngineMessageType.MOVE,
      EngineMessageType.SUMMONING,
      EngineMessageType.ATTACK,
      EngineMessageType.DAMAGE,
      EngineMessageType.WIN,
    ]) {
      expect(messageTypes.has(required), `message type ${required}`).toBe(true);
    }

    const promptMatrix = completed.get("real-wasm-prompt-matrix");
    if (promptMatrix === undefined)
      throw new Error("Prompt-matrix scenario did not execute");
    const promptMessageTypes = messageTypesIn(promptMatrix.trace);
    for (const required of [
      EngineMessageType.SELECT_YES_NO,
      EngineMessageType.SELECT_EFFECT_YES_NO,
      EngineMessageType.SELECT_OPTION,
      EngineMessageType.SELECT_SUM,
      EngineMessageType.SELECT_UNSELECT_CARD,
      EngineMessageType.SELECT_DISABLED_FIELD,
      EngineMessageType.SELECT_POSITION,
      EngineMessageType.SORT_CARD,
      EngineMessageType.SELECT_COUNTER,
      EngineMessageType.ANNOUNCE_NUMBER,
      EngineMessageType.ANNOUNCE_ATTRIBUTE,
      EngineMessageType.ANNOUNCE_RACE,
      EngineMessageType.ANNOUNCE_CARD,
      EngineMessageType.ROCK_PAPER_SCISSORS,
      EngineMessageType.WIN,
    ]) {
      expect(promptMessageTypes.has(required), `message type ${required}`).toBe(
        true,
      );
    }

    const sortChain = completed.get("shuffle-and-sort-chain");
    if (sortChain === undefined)
      throw new Error("Sort-chain scenario did not execute");
    const sortChainMessageTypes = messageTypesIn(sortChain.trace);
    expect(sortChainMessageTypes.has(EngineMessageType.SHUFFLE_DECK)).toBe(
      true,
    );
    expect(sortChainMessageTypes.has(EngineMessageType.SORT_CHAIN)).toBe(true);
  });
});

interface ProgrammedDuelRun {
  readonly result: DuelAdvance["result"];
  readonly trace: DuelTrace;
  readonly humanResponses: number;
  readonly engineDiagnostics: readonly string[];
  readonly sessionDisposed: boolean;
  readonly coverage: readonly MvpCoverageKey[];
}

function playProgrammedDuel(
  scenario: ProgrammedScenario,
  responses: readonly ProgrammedResponse[],
): ProgrammedDuelRun {
  const engineDiagnostics: string[] = [];
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: preset.player,
    opponentDeck: preset.opponent,
    configuration: {
      mode: "programmed",
      seed: scenario.seed,
      playerDeckOrder: scenario.deckOrder[0],
      opponentDeckOrder: scenario.deckOrder[1],
      ...(scenario.startupScripts === undefined
        ? {}
        : { startupScripts: scenario.startupScripts }),
      ...(scenario.allowFirstTurnAttack === undefined
        ? {}
        : { allowFirstTurnAttack: scenario.allowFirstTurnAttack }),
    },
    onEngineDiagnostic: ({ type, message }) =>
      engineDiagnostics.push(`${type}:${message}`),
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("a".repeat(64)),
    presetId: preset.id,
    deckCounts: [40, 40],
    extraDeckCounts: [0, 0],
    maximumAutomaticResponses: 5_000,
  });
  let humanResponses = 0;
  const coverage = new Set<MvpCoverageKey>();
  let attackPending = false;
  let activationPending = false;
  let tributePending = false;
  let advance: DuelAdvance;
  try {
    advance = controller.advance();
  } catch (error) {
    throw scenarioFailure(error, "initial advance");
  }
  observeAdvance();

  try {
    if (scenario.expectedFinishReason === "surrender") {
      if (responses.length !== 0)
        throw new Error("A surrender transcript cannot contain responses");
      coverage.add(actionCoverageKey("surrender"));
      advance = controller.surrender();
      observeAdvance();
    }

    while (advance.result === undefined) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Programmed duel stopped without a prompt");
      coverage.add(promptCoverageKey(prompt.kind));
      if (prompt.kind === "selectTribute") tributePending = true;
      if (prompt.kind === "selectCard" && activationPending) {
        coverage.add(actionCoverageKey("target"));
        activationPending = false;
      }

      const expected = responses[humanResponses];
      if (expected === undefined) {
        throw new Error(
          `Programmed transcript exhausted at prompt ${prompt.kind}`,
        );
      }
      const choiceIds = resolveProgrammedResponse(
        prompt,
        expected,
        humanResponses,
      );
      for (const selection of expected.selections) {
        observeSelection(prompt.kind, selection);
      }
      advance = controller.respond(prompt.id, choiceIds);
      observeAdvance();
      humanResponses += 1;
    }
    if (humanResponses !== responses.length) {
      throw new Error(
        `Programmed duel ended after ${humanResponses} of ${responses.length} responses`,
      );
    }
    return {
      result: advance.result,
      trace: controller.trace(),
      humanResponses,
      engineDiagnostics: Object.freeze([...engineDiagnostics]),
      sessionDisposed: session.disposed,
      coverage: Object.freeze([...coverage].sort()),
    };
  } catch (error) {
    throw scenarioFailure(error, advance.prompt?.kind ?? "terminal advance");
  } finally {
    controller.dispose();
  }

  function scenarioFailure(error: unknown, pending: string): Error {
    const message = error instanceof Error ? error.message : String(error);
    const lastTraceEntry = controller.trace().entries.at(-1);
    return new Error(
      `Programmed scenario ${scenario.id} failed after ${humanResponses}/${responses.length} human responses; pending=${pending}; lastTrace=${JSON.stringify(lastTraceEntry)}; engineDiagnostics=${JSON.stringify(engineDiagnostics)}: ${message}`,
      { cause: error },
    );
  }

  function observeSelection(
    promptKind: ProgrammedResponse["prompt"],
    selection: ProgrammedSelectionFingerprint,
  ): void {
    switch (selection.action) {
      case "specialSummon":
        coverage.add(actionCoverageKey("special_summon"));
        break;
      case "flipSummon":
        coverage.add(actionCoverageKey("flip_summon"));
        break;
      case "setMonster":
        coverage.add(actionCoverageKey("monster_set"));
        break;
      case "setSpellTrap":
        coverage.add(actionCoverageKey("spell_trap_set"));
        break;
      case "activate": {
        coverage.add(actionCoverageKey("activate"));
        const code = selection.card?.code;
        activationPending =
          code !== undefined && TARGETING_CARD_CODES.has(code);
        if (code !== undefined && DESTRUCTION_CARD_CODES.has(code)) {
          coverage.add(actionCoverageKey("destruction"));
        }
        break;
      }
      case "changePosition":
        coverage.add(actionCoverageKey("position_change"));
        break;
      case "pass":
        coverage.add(actionCoverageKey("pass"));
        break;
      case "shuffle":
        coverage.add(actionCoverageKey("shuffle"));
        break;
      case "select":
        coverage.add(actionCoverageKey("select"));
        break;
      default:
        break;
    }
    if (
      promptKind === "chain" &&
      selection.action !== "pass" &&
      selection.action !== "cancel"
    ) {
      coverage.add(actionCoverageKey("chain"));
    }
  }

  function observeAdvance(): void {
    for (const event of advance.events) {
      switch (event.type) {
        case "cardDrawn":
          coverage.add(actionCoverageKey("draw"));
          break;
        case "cardsShuffled":
          coverage.add(actionCoverageKey("shuffle"));
          break;
        case "phaseChanged":
          coverage.add(actionCoverageKey("phase_change"));
          break;
        case "summon":
          coverage.add(
            actionCoverageKey(
              tributePending ? "tribute_summon" : "normal_summon",
            ),
          );
          tributePending = false;
          break;
        case "specialSummon":
          coverage.add(actionCoverageKey("special_summon"));
          break;
        case "flipSummon":
          coverage.add(actionCoverageKey("flip_summon"));
          break;
        case "positionChanged":
          coverage.add(actionCoverageKey("position_change"));
          break;
        case "attack":
          coverage.add(
            actionCoverageKey(
              event.direct ? "direct_attack" : "monster_attack",
            ),
          );
          attackPending = true;
          break;
        case "damage":
          coverage.add(
            actionCoverageKey(
              attackPending ? "battle_damage" : "effect_damage",
            ),
          );
          attackPending = false;
          break;
        case "recover":
          coverage.add(actionCoverageKey("recovery"));
          break;
        case "cardMoved":
          if (event.to === "graveyard")
            coverage.add(actionCoverageKey("send_to_graveyard"));
          if (event.to === "banished")
            coverage.add(actionCoverageKey("banish"));
          break;
        default:
          break;
      }
    }
  }
}

function messageTypesIn(trace: DuelTrace): ReadonlySet<number> {
  return new Set(
    trace.entries.flatMap((entry) =>
      entry.kind === "message" && entry.messageType !== undefined
        ? [entry.messageType]
        : [],
    ),
  );
}

function expectedResult(scenario: ProgrammedScenario): DuelAdvance["result"] {
  if (scenario.expectedFinishReason === "surrender") {
    return {
      type: "surrendered",
      winner: scenario.expectedWinner,
      loser: scenario.expectedWinner === 0 ? 1 : 0,
    };
  }
  return {
    type: "completed",
    winner: scenario.expectedWinner,
    loser: scenario.expectedWinner === 0 ? 1 : 0,
    reason: finishReason(scenario.expectedFinishReason),
  };
}

function finishReason(
  reason: Exclude<ProgrammedScenario["expectedFinishReason"], "surrender">,
): number {
  switch (reason) {
    case "lp_zero":
      return 1;
    case "deck_out":
      return 2;
  }
}

function traceDigest(trace: DuelTrace): string {
  return createHash("sha256").update(JSON.stringify(trace)).digest("hex");
}
