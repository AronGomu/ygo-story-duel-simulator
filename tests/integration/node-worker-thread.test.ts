import { describe, expect, it, onTestFinished } from "vitest";
import { parseDuelDeckSelection } from "../../src/battle/duel/contracts/duel-deck-selection.ts";
import { duelId } from "../../src/battle/duel/contracts/ids.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { createDuelPreset } from "../../src/battle/duel/presets/duel-preset.ts";
import {
  hasWorkerEventType,
  NodeDuelWorkerHarness,
} from "../fixtures/node-duel-worker-harness.ts";

describe("real Node duel Worker thread", () => {
  it("loads real WASM and completes a production lifecycle over IPC", async () => {
    const harness = new NodeDuelWorkerHarness();
    onTestFinished(async () => {
      await harness.terminate();
    });
    expect(harness.threadId).toBeGreaterThan(0);

    const initializeCursor = harness.cursor;
    harness.post({ type: "initialize" });
    await expect(
      harness.waitForMessage(hasWorkerEventType("ready"), {
        afterSequence: initializeCursor,
      }),
    ).resolves.toEqual({
      type: "ready",
      coreVersion: [11, 0],
      snapshotId: expect.stringMatching(/^[a-f0-9]{64}$/),
      activeImageManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const startCursor = harness.cursor;
    harness.post({
      type: "startDuel",
      duelId: duelId("bundled-v1:chapter-one-starter:vs:chapter-one-practice"),
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    await expect(
      harness.waitForMessage(hasWorkerEventType("state"), {
        afterSequence: startCursor,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ type: "state", state: expect.any(Object) }),
    );
    await expect(
      harness.waitForMessage(hasWorkerEventType("prompt"), {
        afterSequence: startCursor,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        type: "prompt",
        prompt: expect.objectContaining({ choices: expect.any(Array) }),
      }),
    );

    const surrenderCursor = harness.cursor;
    harness.post({ type: "surrender" });
    await expect(
      harness.waitForMessage(hasWorkerEventType("result"), {
        afterSequence: surrenderCursor,
      }),
    ).resolves.toEqual({
      type: "result",
      result: { type: "surrendered", winner: 1, loser: 0 },
    });

    const restartCursor = harness.cursor;
    harness.post({
      type: "startDuel",
      duelId: duelId("bundled-v1:chapter-one-starter:vs:chapter-one-practice"),
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    await harness.waitForMessage(hasWorkerEventType("prompt"), {
      afterSequence: restartCursor,
    });

    expect(() => JSON.stringify(harness.messages)).not.toThrow();
    await expect(harness.disposeGracefully()).resolves.toBe(0);
  });

  it("returns a typed initialization failure across the Worker boundary", async () => {
    const harness = new NodeDuelWorkerHarness({ fixture: "missing-runtime" });
    onTestFinished(async () => {
      await harness.terminate();
    });

    const initializeCursor = harness.cursor;
    harness.post({ type: "initialize" });
    const failure = await harness.waitForMessage(hasWorkerEventType("error"), {
      afterSequence: initializeCursor,
    });
    expect(failure).toEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "snapshot_validation_failed",
          recoverable: false,
        }),
      }),
    );
    expect(JSON.stringify(failure)).not.toContain("missing-runtime-root");
    await expect(harness.disposeGracefully()).resolves.toBe(0);
  });

  it("starts from a card list posted across the real Worker boundary", async () => {
    const harness = new NodeDuelWorkerHarness();
    onTestFinished(async () => {
      await harness.terminate();
    });

    const initializeCursor = harness.cursor;
    harness.post({ type: "initialize" });
    await harness.waitForMessage(hasWorkerEventType("ready"), {
      afterSequence: initializeCursor,
    });

    /* The parser's own output is what a caller would post, so this is the
       empirical check that a frozen plain object of frozen arrays survives
       `postMessage` intact — a class instance or a getter would not. */
    const preset = createDuelPreset(
      "chapter-one-starter",
      "chapter-one-practice",
      await loadDeckSources(),
    );
    const player = parseDuelDeckSelection({
      kind: "cards",
      main: [...preset.player.main],
      extra: [...preset.player.extra],
      side: [],
    });
    const startCursor = harness.cursor;
    harness.post({
      type: "startDuel",
      duelId: duelId("custom-v1:node-worker-thread"),
      player,
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    await expect(
      harness.waitForMessage(hasWorkerEventType("state"), {
        afterSequence: startCursor,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ type: "state", state: expect.any(Object) }),
    );

    /* The opponent seat was named, never listed, and the Worker must not send
       its resolved list back across the same boundary. Codes the player also
       holds are excluded: those can legitimately appear in the player's own
       visible hand and prove nothing either way. */
    const outbound = JSON.stringify(harness.messages);
    const playerCodes = new Set(preset.player.main);
    const opponentOnly = preset.opponent.main.filter(
      (code) => !playerCodes.has(code),
    );
    expect(opponentOnly.length).toBeGreaterThan(0);
    for (const code of opponentOnly) {
      const anywhere = new RegExp(`(?<!\\d)${code}(?!\\d)`);
      /* The matcher has teeth: it finds the same code in a control string, so
         a clean sweep below means absence rather than a broken pattern. */
      expect(JSON.stringify([code])).toMatch(anywhere);
      expect(outbound).not.toMatch(anywhere);
    }

    await expect(harness.disposeGracefully()).resolves.toBe(0);
  });

  it("surfaces cleanup failure as a nonzero Worker exit", async () => {
    const harness = new NodeDuelWorkerHarness({ fixture: "cleanup-failure" });

    await expect(harness.disposeGracefully(5_000)).rejects.toThrow(
      /intentional cleanup failure|exited unexpectedly with code 1/,
    );
    await expect(harness.waitForExit()).resolves.toBe(1);
  });

  it("terminates the headless Worker when initialization exceeds its bound", async () => {
    const harness = new NodeDuelWorkerHarness({ fixture: "unresponsive" });

    await expect(harness.initializeWithin(100)).rejects.toThrow(
      "Timed out after 100ms waiting for a Duel Worker message",
    );
    await expect(harness.waitForExit()).resolves.toBe(1);
  });

  it("falls back to forced termination when graceful disposal times out", async () => {
    const harness = new NodeDuelWorkerHarness({ fixture: "unresponsive" });
    onTestFinished(async () => {
      await harness.terminate();
    });

    await expect(harness.disposeGracefully(100)).rejects.toThrow(
      "Timed out after 100ms waiting for Worker exit",
    );
    await expect(harness.waitForExit()).resolves.toBe(1);
  });

  it("can forcibly terminate an initialized Worker within a bound", async () => {
    const harness = new NodeDuelWorkerHarness();
    onTestFinished(async () => {
      await harness.terminate();
    });

    const initializeCursor = harness.cursor;
    harness.post({ type: "initialize" });
    await harness.waitForMessage(hasWorkerEventType("ready"), {
      afterSequence: initializeCursor,
    });
    const startCursor = harness.cursor;
    harness.post({
      type: "startDuel",
      duelId: duelId("bundled-v1:chapter-one-starter:vs:chapter-one-practice"),
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
    await harness.waitForMessage(hasWorkerEventType("prompt"), {
      afterSequence: startCursor,
    });

    await expect(harness.terminate(5_000)).resolves.toBe(1);
  });
});
