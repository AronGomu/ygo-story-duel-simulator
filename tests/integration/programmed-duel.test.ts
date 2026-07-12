import { createHash } from "node:crypto";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/duel/presets/deck-parser.ts";
import {
  loadMvpPreset,
  type MvpPreset,
} from "../../src/duel/presets/mvp-preset.ts";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/worker/assets/active-duel-dependencies-node.ts";
import type { DuelTrace } from "../../src/worker/diagnostics/duel-trace.ts";
import { DuelSession } from "../../src/worker/engine/DuelSession.ts";
import { EngineMessageType } from "../../src/worker/engine/engine-constants.ts";
import type { OcgCoreAdapter } from "../../src/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/worker/HeadlessDuelController.ts";
import { BasicOpponentPolicy } from "../../src/worker/opponent/OpponentPolicy.ts";

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: MvpPreset;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  preset = await loadMvpPreset();
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve("generated/assets/current"),
    uniqueDeckCodes(preset.player, preset.opponent),
  );
});

describe("programmed real-WASM duel", () => {
  it("reaches the same MSG_WIN result and ordered trace twice", () => {
    const first = playProgrammedDuel();
    const second = playProgrammedDuel();

    expect(first.result).toEqual({
      type: "completed",
      winner: 1,
      loser: 0,
      reason: 1,
    });
    expect(second.result).toEqual(first.result);
    expect(traceDigest(second.trace)).toBe(traceDigest(first.trace));
    expect(first.humanResponses).toBeGreaterThan(0);

    const messageTypes = new Set(
      first.trace.entries.flatMap((entry) =>
        entry.kind === "message" && entry.messageType !== undefined
          ? [entry.messageType]
          : [],
      ),
    );
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
  });
});

function playProgrammedDuel(): {
  readonly result: ReturnType<HeadlessDuelController["advance"]>["result"];
  readonly trace: DuelTrace;
  readonly humanResponses: number;
} {
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: preset.player,
    opponentDeck: preset.opponent,
    configuration: {
      mode: "programmed",
      seed: [1n, 2n, 3n, 4n],
      playerDeckOrder: preset.player.main,
      opponentDeckOrder: preset.opponent.main,
    },
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
  const humanProgram = new BasicOpponentPolicy(dependencies);
  let advance = controller.advance();
  let humanResponses = 0;

  try {
    while (advance.result === undefined) {
      if (advance.prompt === undefined)
        throw new Error("Programmed duel stopped without a prompt");
      const decision = humanProgram.choose(advance.prompt, advance.state);
      advance = controller.respond(advance.prompt.id, decision.choiceIds);
      humanResponses += 1;
      if (humanResponses > 5_000)
        throw new Error("Programmed duel exceeded the response limit");
    }
    return {
      result: advance.result,
      trace: controller.trace(),
      humanResponses,
    };
  } finally {
    controller.dispose();
  }
}

function traceDigest(trace: DuelTrace): string {
  return createHash("sha256").update(JSON.stringify(trace)).digest("hex");
}
