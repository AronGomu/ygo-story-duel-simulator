import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { describe, expect, it } from "vitest";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import {
  DEFAULT_OPPONENT_DECK_ID,
  DEFAULT_PLAYER_DECK_ID,
} from "../../src/battle/duel/presets/deck-catalog.ts";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { createDuelPreset } from "../../src/battle/duel/presets/duel-preset.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";
import {
  BasicOpponentPolicy,
  toOpponentVisibleState,
} from "../../src/battle/worker/opponent/OpponentPolicy.ts";

// Production shuffle, no startup Lua or substituted AI. The human seat uses the
// same existing policy to exercise a full duel without a scripted win condition.
describe("Chapter 1 real-engine defaults", () => {
  it.each([1, 2, 3])(
    "completes the new default pair with production shuffle and default AI: run %i",
    async () => {
      const preset = createDuelPreset(
        DEFAULT_PLAYER_DECK_ID,
        DEFAULT_OPPONENT_DECK_ID,
        await loadDeckSources(),
      );
      const dependencies = await loadActiveDuelDependenciesNode(
        ASSET_SOURCES.data.source,
        uniqueDeckCodes(preset.player, preset.opponent),
      );
      const adapter = await loadVendoredCoreNode();
      const profile = selectedDeckPairRulesProfile(
        preset.player,
        preset.opponent,
        dependencies.cards,
      );
      const diagnostics: string[] = [];
      const session = DuelSession.create({
        adapter,
        dependencies,
        playerDeck: preset.player,
        opponentDeck: preset.opponent,
        configuration: { mode: "production", rules: profile.rules },
        onEngineDiagnostic: ({ type, message }) =>
          diagnostics.push(`${type}:${message}`),
      });
      const controller = new HeadlessDuelController({
        session,
        dependencies,
        snapshotId: snapshotId("c".repeat(64)),
        presetId: preset.id,
        deckCounts: [40, 40],
        extraDeckCounts: [0, 0],
        extraMonsterZones: profile.extraMonsterZones,
      });
      const human = new BasicOpponentPolicy(dependencies);
      let responses = 0;
      let opponentTurns = 0;
      try {
        let advance = controller.advance();
        while (advance.result === undefined && responses < 2000) {
          for (const event of advance.events)
            if (event.type === "turnStarted" && event.player === 1)
              opponentTurns++;
          const prompt = advance.prompt;
          if (prompt === undefined)
            throw new Error("Duel stopped without a prompt or result");
          const decision = human.choose(
            prompt,
            toOpponentVisibleState(advance.state),
          );
          advance = controller.respond(prompt.id, decision.choiceIds);
          responses++;
        }
        const evidence = JSON.stringify({
          seed: session.seed.map(String),
          responses,
          diagnostics,
          trace: controller.trace().entries.slice(-20),
        });
        expect(advance.result, evidence).toMatchObject({ type: "completed" });
        expect(responses, evidence).toBeGreaterThan(0);
        expect(opponentTurns, evidence).toBeGreaterThan(0);
        expect(
          controller
            .trace()
            .entries.some(
              (entry) =>
                entry.kind === "response" &&
                entry.player === 1 &&
                entry.opponentReason !== undefined,
            ),
          evidence,
        ).toBe(true);
        expect(diagnostics, evidence).toEqual([]);
        expect(session.disposed).toBe(true);
      } finally {
        controller.dispose();
      }
    },
  );
});
