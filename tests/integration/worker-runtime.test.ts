import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { choiceId, duelId } from "../../src/duel/contracts/ids.ts";
import { createNodeDuelWorkerRuntime } from "../../src/worker/create-node-runtime.ts";

describe("typed duel Worker runtime", () => {
  it("classifies a missing runtime snapshot during initialization", async () => {
    const runtime = createNodeDuelWorkerRuntime(
      path.resolve("tests/fixtures/missing-runtime-root"),
    );
    try {
      expect((await runtime.handle({ type: "initialize" })).at(-1)).toEqual(
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({
            code: "snapshot_validation_failed",
            recoverable: false,
          }),
        }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("rejects a declared snapshot artifact before loading the engine", async () => {
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "ygo-runtime-snapshot-"),
    );
    const assetRoot = path.join(projectRoot, "generated", "assets", "current");
    const vendorRoot = path.join(
      projectRoot,
      "vendor",
      "ocgcore-wasm",
      "0.1.2",
    );
    await Promise.all([
      mkdir(assetRoot, { recursive: true }),
      mkdir(vendorRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(assetRoot, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: "2026-07-13T00:00:00.000Z",
          sources: {
            babelCdb: { commit: "a".repeat(40) },
            cardScripts: { commit: "b".repeat(40) },
            distribution: { commit: "c".repeat(40) },
          },
          files: [
            {
              path: "catalog/missing.json",
              bytes: 1,
              sha256: "0".repeat(64),
            },
          ],
        }),
      ),
      writeFile(
        path.join(vendorRoot, "vendor-manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          package: "ocgcore-wasm",
          version: "0.1.2",
          integrity: "sha512-test",
          embeddedCoreRevision: "d".repeat(40),
          coreVersion: [11, 0],
        }),
      ),
    ]);

    const runtime = createNodeDuelWorkerRuntime(projectRoot);
    try {
      const initialized = await runtime.handle({ type: "initialize" });
      expect(initialized.at(-1)).toEqual(
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({
            code: "snapshot_validation_failed",
            message: expect.stringContaining(
              "Runtime snapshot validation failed",
            ),
          }),
        }),
      );
    } finally {
      runtime.dispose();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("initializes real local resources and starts only the bundled production duel", async () => {
    const runtime = createNodeDuelWorkerRuntime();
    try {
      const initialized = await runtime.handle({ type: "initialize" });
      expect(initialized.at(-1)).toEqual({
        type: "ready",
        coreVersion: [11, 0],
      });
      const loadingStages = initialized.flatMap((event) =>
        event.type === "loading" ? [event.stage] : [],
      );
      expect(loadingStages).toContain("snapshot-files");
      expect(loadingStages.length).toBeGreaterThan(2);

      const unknown = await runtime.handle({
        type: "startDuel",
        duelId: duelId("unknown"),
      });
      expect(unknown).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ code: "invalid_command" }),
        }),
      ]);

      const started = await runtime.handle({
        type: "startDuel",
        duelId: duelId("mvp-preset-v1"),
      });
      expect(started.some((event) => event.type === "state")).toBe(true);
      const promptEvent = started.find((event) => event.type === "prompt");
      if (promptEvent?.type !== "prompt")
        throw new Error("Expected the production duel to request human input");

      const invalid = await runtime.handle({
        type: "respond",
        promptId: promptEvent.prompt.id,
        choiceIds: [choiceId("unknown-choice")],
      });
      expect(invalid).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({
            code: "invalid_response",
            recoverable: true,
          }),
        }),
      ]);

      const surrendered = await runtime.handle({ type: "surrender" });
      expect(surrendered.at(-1)).toEqual({
        type: "result",
        result: { type: "surrendered", winner: 1, loser: 0 },
      });

      const restarted = await runtime.handle({
        type: "startDuel",
        duelId: duelId("mvp-preset-v1"),
      });
      const restartedPrompt = restarted.find(
        (event) => event.type === "prompt",
      );
      if (restartedPrompt?.type !== "prompt")
        throw new Error("Expected the restarted duel to request human input");
      expect(restartedPrompt.prompt.id).not.toBe(promptEvent.prompt.id);

      const stale = await runtime.handle({
        type: "respond",
        promptId: promptEvent.prompt.id,
        choiceIds: [promptEvent.prompt.choices[0]!.id],
      });
      expect(stale).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({
            code: "stale_prompt",
            recoverable: true,
          }),
        }),
      ]);
      expect(
        (await runtime.handle({ type: "surrender" })).at(-1),
      ).toMatchObject({ type: "result" });

      const replacementRuntime = createNodeDuelWorkerRuntime();
      try {
        await replacementRuntime.handle({ type: "initialize" });
        const replacementStarted = await replacementRuntime.handle({
          type: "startDuel",
          duelId: duelId("mvp-preset-v1"),
        });
        const replacementPrompt = replacementStarted.find(
          (event) => event.type === "prompt",
        );
        if (replacementPrompt?.type !== "prompt")
          throw new Error("Expected the replacement Worker to request input");
        expect(replacementPrompt.prompt.id).not.toBe(restartedPrompt.prompt.id);
      } finally {
        replacementRuntime.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
});
