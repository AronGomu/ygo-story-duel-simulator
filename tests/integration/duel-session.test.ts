import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/worker/assets/active-duel-dependencies-node.ts";
import { uniqueDeckCodes } from "../../src/duel/presets/deck-parser.ts";
import type { MvpPreset } from "../../src/duel/presets/mvp-preset.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset-node.ts";
import { DuelSession } from "../../src/worker/engine/DuelSession.ts";
import { EngineMessageType } from "../../src/worker/engine/engine-constants.ts";
import type { OcgCoreAdapter } from "../../src/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/worker/engine/load-vendored-core-node.ts";

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: MvpPreset;
const sessions: DuelSession[] = [];

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  preset = await loadMvpPreset();
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve("generated/assets/current"),
    uniqueDeckCodes(preset.player, preset.opponent),
  );
});

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
});

describe("real ocgcore duel session", () => {
  it("creates, starts, processes to the first human prompt, and disposes idempotently", () => {
    const diagnostics: string[] = [];
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
      onEngineDiagnostic: ({ message }) => diagnostics.push(message),
    });
    sessions.push(session);

    const boundary = session.processUntilBoundary();
    expect(boundary.status).toBe("waiting");
    expect(boundary.messages.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
    session.dispose();
    session.dispose();
    expect(session.disposed).toBe(true);
  });

  it("generates fresh seeds and lets the core shuffle varied production hands", () => {
    const productionSessions = Array.from({ length: 8 }, () =>
      createProductionSession(),
    );
    sessions.push(...productionSessions);

    expect(productionSessions[0]?.seed.some((word) => word !== 0n)).toBe(true);
    expect(productionSessions[1]?.seed).not.toEqual(
      productionSessions[0]?.seed,
    );

    const openingHands = productionSessions.map((session) => {
      const boundary = session.processUntilBoundary();
      expect(boundary.status).toBe("waiting");
      const messages = boundary.messages;
      expect(
        messages
          .filter((message) => message.type === EngineMessageType.SHUFFLE_DECK)
          .map((message) => message.player),
        `production seed=${session.seed.map(String).join(",")}`,
      ).toEqual([0, 1]);
      const openingDraw = messages.find(
        (message) =>
          message.type === EngineMessageType.DRAW && message.player === 0,
      );
      if (openingDraw?.type !== EngineMessageType.DRAW) {
        throw new Error(
          `Production opening draw is missing for seed ${session.seed.map(String).join(",")}`,
        );
      }
      return openingDraw.drawn.map((card) => card.code);
    });

    expect(
      new Set(openingHands.map((hand) => JSON.stringify(hand))).size,
      JSON.stringify({
        seeds: productionSessions.map((session) => session.seed.map(String)),
        openingHands,
      }),
    ).toBeGreaterThan(1);
  });
});

function createProductionSession(): DuelSession {
  return DuelSession.create({
    adapter,
    dependencies,
    playerDeck: preset.player,
    opponentDeck: preset.opponent,
    configuration: { mode: "production" },
  });
}
