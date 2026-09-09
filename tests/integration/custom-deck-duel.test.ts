import path from "node:path";
import { describe, expect, it } from "vitest";
import { duelId, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { createDuelPreset } from "../../src/battle/duel/presets/duel-preset.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { DuelWorkerRuntime } from "../../src/battle/worker/DuelWorkerRuntime.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";

const ASSET_ROOT = path.resolve("generated/assets/current");
const CUSTOM_DUEL_ID = duelId("custom-v1:integration");

async function createRuntime(): Promise<{
  readonly runtime: DuelWorkerRuntime;
  readonly playerMain: readonly number[];
  readonly playerExtra: readonly number[];
}> {
  const adapter = await loadVendoredCoreNode();
  const deckSources = await loadDeckSources();
  const preset = createDuelPreset(
    "chapter-one-starter",
    "chapter-one-practice",
    deckSources,
  );
  const dependencies = await loadActiveDuelDependenciesNode(
    ASSET_ROOT,
    uniqueDeckCodes(preset.player, preset.opponent),
  );
  return {
    runtime: new DuelWorkerRuntime(async () => ({
      adapter,
      dependencies,
      createPreset: (playerDeckId, opponentDeckId) =>
        createDuelPreset(playerDeckId, opponentDeckId, deckSources),
      snapshotId: snapshotId("b".repeat(64)),
    })),
    playerMain: preset.player.main,
    playerExtra: preset.player.extra,
  };
}

describe("duels started from an explicit card list", () => {
  it("initializes a real-WASM duel from a card list and reaches a terminal result", async () => {
    const { runtime, playerMain, playerExtra } = await createRuntime();
    try {
      await runtime.handle({ type: "initialize" });
      const started = await runtime.handle({
        type: "startDuel",
        duelId: CUSTOM_DUEL_ID,
        player: {
          kind: "cards",
          main: [...playerMain],
          extra: [...playerExtra],
          side: [],
        },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });

      expect(started.some(({ type }) => type === "error")).toBe(false);
      expect(started.some(({ type }) => type === "state")).toBe(true);
      const firstPrompt = started.find((event) => event.type === "prompt");
      expect(firstPrompt).toBeDefined();

      /* Play the duel forward with the first legal choice each time. The seed
         is a production seed, so which side opens varies; the assertion is
         that the session stays live and ends in a real result rather than
         that any particular winner appears. */
      let events = started;
      for (let step = 0; step < 60; step += 1) {
        const result = events.find((event) => event.type === "result");
        if (result !== undefined) {
          expect(result.result.type).toBe("completed");
          return;
        }
        const prompt = events.findLast((event) => event.type === "prompt");
        if (prompt === undefined) break;
        const choice = prompt.prompt.choices[0];
        if (choice === undefined) break;
        events = [
          ...(await runtime.handle({
            type: "respond",
            promptId: prompt.prompt.id,
            choiceIds: [choice.id],
          })),
        ];
      }

      const surrendered = await runtime.handle({ type: "surrender" });
      expect(surrendered.at(-1)).toEqual({
        type: "result",
        result: { type: "surrendered", winner: 1, loser: 0 },
      });
    } finally {
      runtime.dispose();
    }
  }, 120_000);

  it("refuses an unsupported code and never creates a duel session", async () => {
    const { runtime, playerMain } = await createRuntime();
    try {
      await runtime.handle({ type: "initialize" });
      const refused = await runtime.handle({
        type: "startDuel",
        duelId: CUSTOM_DUEL_ID,
        player: {
          kind: "cards",
          main: [...playerMain.slice(1), 909_090],
          extra: [],
          side: [],
        },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      expect(refused).toEqual([
        {
          type: "error",
          error: expect.objectContaining({
            code: "unsupported_card",
            message: expect.stringContaining("909090"),
          }),
        },
      ]);
      /* The runtime still holds no controller, so the very next start is
         accepted rather than rejected as `duel_already_active`. */
      const accepted = await runtime.handle({
        type: "startDuel",
        duelId: duelId(
          "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
        ),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      expect(accepted.some(({ type }) => type === "error")).toBe(false);
    } finally {
      runtime.dispose();
    }
  }, 120_000);
});
