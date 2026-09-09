import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { cardCode, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import type { MvpPreset } from "../../src/battle/duel/presets/mvp-preset.ts";
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import {
  EngineLocation,
  EngineMessageType,
  EnginePosition,
  EngineQueryFlag,
} from "../../src/battle/worker/engine/engine-constants.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: MvpPreset;
const sessions: DuelSession[] = [];

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  preset = await loadMvpPreset();
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
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
        rules: "mr5",
        seed: [1n, 2n, 3n, 4n],
        playerDeckOrder: preset.player.main,
        opponentDeckOrder: preset.opponent.main,
      },
      onEngineDiagnostic: ({ message }) => diagnostics.push(message),
    });
    sessions.push(session);

    expect(session.initialExtraDeckOrder(0)).toEqual(preset.player.extra);
    const queriedExtra = session.queryLocation({
      flags: EngineQueryFlag.CODE,
      controller: 0,
      location: EngineLocation.EXTRA as never,
    });
    expect(
      queriedExtra.filter((card) => card !== null).map((card) => card?.code),
    ).toEqual(preset.player.extra);
    const cardQuery = {
      flags: EngineQueryFlag.CODE,
      controller: 0 as const,
      location: EngineLocation.EXTRA as never,
      sequence: 0,
      overlaySequence: 0,
    };
    expect(session.queryCard(cardQuery)?.code).toBe(preset.player.extra[0]);

    const boundary = session.processUntilBoundary();
    expect(boundary.status).toBe("waiting");
    expect(boundary.messages.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
    session.dispose();
    session.dispose();
    expect(session.disposed).toBe(true);
    expect(() => session.initialExtraDeckOrder(0)).toThrow("disposed");
    expect(() =>
      session.queryLocation({
        flags: EngineQueryFlag.CODE,
        controller: 0,
        location: EngineLocation.EXTRA as never,
      }),
    ).toThrow("disposed");
    expect(() => session.queryCard(cardQuery)).toThrow("disposed");
  });

  it("preserves authoritative Extra query order in the real wrapper", () => {
    const template = dependencies.cards.values().next().value;
    if (template === undefined) throw new Error("Card template missing");
    const extra = Object.freeze([cardCode(10_000_001), cardCode(10_000_002)]);
    const cards = new Map(dependencies.cards);
    for (const code of extra)
      cards.set(code, { ...template, code, type: template.type | 0x40 });
    const queryDependencies = { ...dependencies, cards };
    const playerDeck = Object.freeze({ ...preset.player, extra });
    const session = DuelSession.create({
      adapter,
      dependencies: queryDependencies,
      playerDeck,
      opponentDeck: preset.opponent,
      configuration: {
        mode: "programmed",
        rules: "mr5",
        seed: [5n, 6n, 7n, 8n],
        playerDeckOrder: playerDeck.main,
        opponentDeckOrder: preset.opponent.main,
      },
    });
    sessions.push(session);

    expect(session.initialExtraDeckOrder(0)).toEqual(extra);
    const queried = session
      .queryLocation({
        flags: (EngineQueryFlag.CODE |
          EngineQueryFlag.POSITION |
          EngineQueryFlag.OWNER |
          EngineQueryFlag.IS_PUBLIC |
          EngineQueryFlag.IS_HIDDEN) as never,
        controller: 0,
        location: EngineLocation.EXTRA as never,
      })
      .filter((card) => card !== null);
    expect(queried.map((card) => card?.code)).toEqual([...extra].reverse());
    expect(queried).toEqual(
      [...extra].reverse().map((code) =>
        expect.objectContaining({
          code,
          owner: 0,
          position: EnginePosition.FACE_DOWN_DEFENSE,
          isPublic: false,
          isHidden: false,
        }),
      ),
    );
  });

  it("falls back to the host list when pinned core cannot query material detail", () => {
    const session = DuelSession.create({
      adapter,
      dependencies,
      playerDeck: preset.player,
      opponentDeck: preset.opponent,
      configuration: {
        mode: "programmed",
        rules: "mr5",
        seed: [9n, 10n, 11n, 12n],
        playerDeckOrder: preset.player.main,
        opponentDeckOrder: preset.opponent.main,
        startupScripts: [
          {
            name: "mvp_overlay_query.lua",
            source: `local overlay_query = Effect.GlobalEffect()
overlay_query:SetType(EFFECT_TYPE_FIELD + EFFECT_TYPE_CONTINUOUS)
overlay_query:SetCode(EVENT_STARTUP)
overlay_query:SetOperation(function()
  local deck = Duel.GetFieldGroup(0, LOCATION_DECK, 0)
  local host = deck:GetFirst()
  local material = deck:GetNext()
  Duel.MoveToField(host, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK, true)
  local materials = Group.CreateGroup()
  materials:AddCard(material)
  Duel.Overlay(host, materials)
end)
Duel.RegisterEffect(overlay_query, 0)`,
          },
        ],
      },
    });
    sessions.push(session);
    const controller = new HeadlessDuelController({
      session,
      dependencies,
      snapshotId: snapshotId("real-overlay-query"),
      presetId: "real-overlay-query",
      deckCounts: [preset.player.main.length, preset.opponent.main.length],
      extraDeckCounts: [
        preset.player.extra.length,
        preset.opponent.extra.length,
      ],
      extraMonsterZones: true,
    });

    let advance = controller.advance();
    for (let index = 0; index < 4; index += 1) {
      const material =
        advance.state.players[0].monsters[0]?.overlayMaterials[0];
      if (material !== undefined) break;
      const choice = advance.prompt?.choices[0];
      if (advance.prompt === undefined || choice === undefined) break;
      advance = controller.respond(advance.prompt.id, [choice.id]);
    }

    const host = session.queryCard({
      flags: EngineQueryFlag.OVERLAY_CARD,
      controller: 0,
      location: EngineLocation.MONSTER as never,
      sequence: 0,
      overlaySequence: 0,
    });
    expect(host?.overlayCards).toEqual([expect.any(Number)]);
    const hostCodes = host?.overlayCards ?? [];
    expect(
      advance.state.players[0].monsters[0]?.overlayMaterials.map(
        ({ code }) => code,
      ),
    ).toEqual(hostCodes);
    expect(
      advance.state.players[0].monsters[0]?.overlayMaterials[0],
    ).toMatchObject({
      code: hostCodes[0],
      identityVisible: true,
      sequence: 0,
    });
    expect(session.disposed).toBe(false);
    expect(JSON.stringify(controller.trace())).toContain(
      "reconcile:overlayHost:enrichment_unavailable",
    );
  });

  it("reclaims one hundred real core sessions", () => {
    for (let index = 0; index < 100; index += 1) {
      const session = DuelSession.create({
        adapter,
        dependencies,
        playerDeck: preset.player,
        opponentDeck: preset.opponent,
        configuration: {
          mode: "programmed",
          rules: "mr5",
          seed: [1n, 2n, 3n, BigInt(index + 4)],
          playerDeckOrder: preset.player.main,
          opponentDeckOrder: preset.opponent.main,
        },
      });
      session.dispose();
      expect(session.disposed).toBe(true);
    }
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
    configuration: { mode: "production", rules: "mr5" },
  });
}
