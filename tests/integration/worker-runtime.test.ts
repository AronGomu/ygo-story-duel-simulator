import { describe, expect, it } from "vitest";
import { duelId } from "../../src/duel/contracts/ids.ts";
import { createNodeDuelWorkerRuntime } from "../../src/worker/create-node-runtime.ts";

describe("typed duel Worker runtime", () => {
  it("initializes real local resources and starts only the bundled production duel", async () => {
    const runtime = createNodeDuelWorkerRuntime();
    try {
      const initialized = await runtime.handle({ type: "initialize" });
      expect(initialized.at(-1)).toEqual({
        type: "ready",
        coreVersion: [11, 0],
      });
      expect(
        initialized.filter((event) => event.type === "loading").length,
      ).toBeGreaterThan(1);

      const unknown = await runtime.handle({
        type: "startDuel",
        duelId: duelId("unknown"),
      });
      expect(unknown).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ code: "engine_error" }),
        }),
      ]);

      const started = await runtime.handle({
        type: "startDuel",
        duelId: duelId("mvp-preset-v1"),
      });
      expect(started.some((event) => event.type === "state")).toBe(true);
      expect(started.some((event) => event.type === "prompt")).toBe(true);
      const surrendered = await runtime.handle({ type: "surrender" });
      expect(surrendered.at(-1)).toEqual({
        type: "result",
        result: { type: "surrendered", winner: 1, loser: 0 },
      });
    } finally {
      runtime.dispose();
    }
  });
});
