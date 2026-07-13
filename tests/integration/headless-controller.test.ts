import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/duel/presets/deck-parser.ts";
import type { MvpPreset } from "../../src/duel/presets/mvp-preset.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset-node.ts";
import type { ActiveDuelDependencies } from "../../src/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/worker/assets/active-duel-dependencies-node.ts";
import { DuelSession } from "../../src/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/worker/HeadlessDuelController.ts";

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

describe("HeadlessDuelController", () => {
  it("projects real messages and accepts one opaque human choice", () => {
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
      deckCounts: [preset.player.main.length, preset.opponent.main.length],
      extraDeckCounts: [
        preset.player.extra.length,
        preset.opponent.extra.length,
      ],
    });

    try {
      const first = controller.advance();
      expect(first.prompt?.kind).toBe("idleCommand");
      expect(first.state.players[0].hand).toHaveLength(5);
      expect(first.state.players[1].hand).toEqual([]);
      const summon = first.prompt?.choices.find(
        (choice) => choice.action === "summon",
      );
      if (first.prompt === undefined || summon === undefined)
        throw new Error("Summon choice is missing");
      const place = controller.respond(first.prompt.id, [summon.id]);
      expect(place.prompt?.kind).toBe("selectPlace");
      const zone = place.prompt?.choices[0];
      if (place.prompt === undefined || zone === undefined)
        throw new Error("Zone choice is missing");
      let second = controller.respond(place.prompt.id, [zone.id]);
      while (second.prompt?.kind === "chain") {
        const pass = second.prompt.choices.find(
          (choice) => choice.action === "pass",
        );
        if (pass === undefined) throw new Error("Pass choice is missing");
        second = controller.respond(second.prompt.id, [pass.id]);
      }
      expect(second.prompt?.kind).toBe("idleCommand");
      expect(second.state.players[0].monsters).toHaveLength(1);
      expect(
        controller.trace().entries.some((entry) => entry.kind === "response"),
      ).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it("reaches a supported human prompt for a bounded randomized production matrix", () => {
    const runs = Array.from({ length: 8 }, () => {
      const session = DuelSession.create({
        adapter,
        dependencies,
        playerDeck: preset.player,
        opponentDeck: preset.opponent,
        configuration: { mode: "production" },
      });
      const controller = new HeadlessDuelController({
        session,
        dependencies,
        snapshotId: snapshotId("b".repeat(64)),
        presetId: preset.id,
        deckCounts: [preset.player.main.length, preset.opponent.main.length],
        extraDeckCounts: [
          preset.player.extra.length,
          preset.opponent.extra.length,
        ],
      });
      try {
        const first = controller.advance();
        return {
          seed: session.seed.map(String),
          promptKind: first.prompt?.kind,
          promptPlayer: first.prompt?.player,
          result: first.result,
        };
      } finally {
        controller.dispose();
      }
    });

    for (const run of runs) {
      expect(run.result, JSON.stringify(run)).toBeUndefined();
      expect(run.promptKind, JSON.stringify(run)).toBe("idleCommand");
      expect(run.promptPlayer, JSON.stringify(run)).toBe(0);
    }
    expect(new Set(runs.map(({ seed }) => seed.join(","))).size).toBe(8);
  });

  it("returns a structured surrender result and destroys the session", () => {
    const session = DuelSession.create({
      adapter,
      dependencies,
      playerDeck: preset.player,
      opponentDeck: preset.opponent,
      configuration: { mode: "production" },
    });
    const controller = new HeadlessDuelController({
      session,
      dependencies,
      snapshotId: snapshotId("a".repeat(64)),
      presetId: preset.id,
      deckCounts: [40, 40],
      extraDeckCounts: [0, 0],
    });
    expect(controller.surrender().result).toEqual({
      type: "surrendered",
      winner: 1,
      loser: 0,
    });
    expect(session.disposed).toBe(true);
  });
});
