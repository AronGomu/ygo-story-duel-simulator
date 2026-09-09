import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  choiceId,
  duelId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { createDuelPreset } from "../../src/battle/duel/presets/duel-preset.ts";
import { TYPE_LINK } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { createNodeDuelWorkerRuntime } from "../../src/battle/worker/create-node-runtime.ts";
import { DuelWorkerRuntime } from "../../src/battle/worker/DuelWorkerRuntime.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";

describe("typed duel Worker runtime", () => {
  /* Every bundled deck pair is Link-free, so a hard-coded MR3 layout would
     satisfy each assertion below. One synthetic Link-typed catalog entry for a
     card the selected pair actually plays is the only falsifiable proof that
     the profile is computed from the pair and reaches the projected snapshot. */
  it("projects the Link profile when the selected pair plays a Link monster", async () => {
    const adapter = await loadVendoredCoreNode();
    const deckSources = await loadDeckSources();
    const preset = createDuelPreset(
      "chapter-one-starter",
      "chapter-one-practice",
      deckSources,
    );
    const dependencies = await loadActiveDuelDependenciesNode(
      path.resolve("generated/assets/current"),
      uniqueDeckCodes(preset.player, preset.opponent),
    );
    const linkCode = preset.player.main[0];
    const catalogEntry =
      linkCode === undefined ? undefined : dependencies.cards.get(linkCode);
    if (linkCode === undefined || catalogEntry === undefined)
      throw new Error("Expected a catalog entry for the first main-deck card");
    const cards = new Map(dependencies.cards);
    cards.set(linkCode, {
      ...catalogEntry,
      type: catalogEntry.type | TYPE_LINK,
    });

    const runtime = new DuelWorkerRuntime(async () => ({
      adapter,
      dependencies: { ...dependencies, cards },
      createPreset: () => preset,
      snapshotId: snapshotId("a".repeat(64)),
    }));
    try {
      await runtime.handle({ type: "initialize" });
      const started = await runtime.handle({
        type: "startDuel",
        duelId: duelId(preset.id),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      expect(
        started.flatMap((event) =>
          event.type === "state" ? [event.state.layout] : [],
        ),
      ).toContainEqual({ extraMonsterZones: true });
    } finally {
      runtime.dispose();
    }
  });

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
            message: "Unable to verify runtime snapshot files",
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
        snapshotId: expect.stringMatching(/^[a-f0-9]{64}$/),
        activeImageManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const loadingStages = initialized.flatMap((event) =>
        event.type === "loading" ? [event.stage] : [],
      );
      expect(loadingStages).toContain("snapshot-files");
      expect(loadingStages.length).toBeGreaterThan(2);

      const unknown = await runtime.handle({
        type: "startDuel",
        duelId: duelId("unknown"),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      expect(unknown).toEqual([
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ code: "invalid_command" }),
        }),
      ]);

      const started = await runtime.handle({
        type: "startDuel",
        duelId: duelId(
          "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
        ),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      expect(started.some((event) => event.type === "state")).toBe(true);
      /* Every bundled pair is Link-free, so the worker's own profile decision
         must reach the projected snapshot as MR3 geometry. */
      expect(
        started.flatMap((event) =>
          event.type === "state" ? [event.state.layout] : [],
        ),
      ).toContainEqual({ extraMonsterZones: false });
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
        duelId: duelId(
          "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
        ),
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      });
      const restartedPrompt = restarted.find(
        (event) => event.type === "prompt",
      );
      if (restartedPrompt?.type !== "prompt")
        throw new Error("Expected the restarted duel to request human input");
      expect(restartedPrompt.prompt.id).not.toBe(promptEvent.prompt.id);
      /* A rematch keeps the same pair, so it keeps the same profile. */
      expect(
        restarted.flatMap((event) =>
          event.type === "state" ? [event.state.layout] : [],
        ),
      ).toContainEqual({ extraMonsterZones: false });

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

      /* Changing decks recomputes the profile from the new pair. */
      const otherPair = await runtime.handle({
        type: "startDuel",
        duelId: duelId(
          "bundled-v1:chapter-one-practice:vs:chapter-one-starter",
        ),
        player: { kind: "preset", deckId: "chapter-one-practice" },
        opponent: { kind: "preset", deckId: "chapter-one-starter" },
      });
      expect(
        otherPair.flatMap((event) =>
          event.type === "state" ? [event.state.layout] : [],
        ),
      ).toContainEqual({ extraMonsterZones: false });
      expect(
        (await runtime.handle({ type: "surrender" })).at(-1),
      ).toMatchObject({ type: "result" });

      const replacementRuntime = createNodeDuelWorkerRuntime();
      try {
        await replacementRuntime.handle({ type: "initialize" });
        const replacementStarted = await replacementRuntime.handle({
          type: "startDuel",
          duelId: duelId(
            "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
          ),
          player: { kind: "preset", deckId: "chapter-one-starter" },
          opponent: { kind: "preset", deckId: "chapter-one-practice" },
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
