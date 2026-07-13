import { describe, expect, it } from "vitest";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import {
  EngineLocation,
  EngineMessageType,
  EnginePosition,
} from "../../src/worker/engine/engine-constants.ts";
import { DuelStateProjector } from "../../src/worker/projection/DuelStateProjector.ts";

function projector(): DuelStateProjector {
  return new DuelStateProjector(snapshotId("a".repeat(64)), [40, 40], [0, 0]);
}

describe("DuelStateProjector", () => {
  it("projects human hand identities but strips opponent hidden identities", () => {
    const value = projector();
    value.apply({
      type: EngineMessageType.DRAW,
      player: 0,
      drawn: [{ code: 97590747, position: EnginePosition.FACE_DOWN_DEFENSE }],
    });
    value.apply({
      type: EngineMessageType.DRAW,
      player: 1,
      drawn: [{ code: 5053103, position: EnginePosition.FACE_DOWN_DEFENSE }],
    });

    const snapshot = value.snapshot();
    expect(snapshot.players[0].hand[0]?.code).toBe(97590747);
    expect(snapshot.players[1].handCount).toBe(1);
    expect(snapshot.players[1].hand).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("5053103");
  });

  it("moves one physical instance between zones without duplication", () => {
    const value = projector();
    value.apply({
      type: EngineMessageType.DRAW,
      player: 0,
      drawn: [{ code: 97590747, position: EnginePosition.FACE_DOWN_DEFENSE }],
    });
    value.apply({
      type: EngineMessageType.MOVE,
      card: 97590747,
      from: {
        controller: 0,
        location: EngineLocation.HAND,
        sequence: 0,
        position: EnginePosition.FACE_DOWN_DEFENSE,
      },
      to: {
        controller: 0,
        location: EngineLocation.MONSTER,
        sequence: 0,
        position: EnginePosition.FACE_UP_ATTACK,
      },
    });

    const snapshot = value.snapshot();
    expect(snapshot.players[0].hand).toHaveLength(0);
    expect(snapshot.players[0].monsters).toHaveLength(1);
    expect(snapshot.players[0].monsters[0]?.code).toBe(97590747);
  });

  it("projects shuffles and reconciles the visible human hand order", () => {
    const value = projector();
    value.apply({
      type: EngineMessageType.DRAW,
      player: 0,
      drawn: [
        { code: 97590747, position: EnginePosition.FACE_DOWN_DEFENSE },
        { code: 5053103, position: EnginePosition.FACE_DOWN_DEFENSE },
      ],
    });

    expect(
      value.apply({ type: EngineMessageType.SHUFFLE_DECK, player: 0 }).events,
    ).toEqual([{ type: "cardsShuffled", player: 0, location: "deck" }]);
    expect(
      value.apply({
        type: EngineMessageType.SHUFFLE_HAND,
        player: 0,
        cards: [5053103, 97590747],
      }).events,
    ).toEqual([{ type: "cardsShuffled", player: 0, location: "hand" }]);
    expect(
      value
        .snapshot()
        .players[0].hand.map((card) => [card.code, card.sequence]),
    ).toEqual([
      [5053103, 0],
      [97590747, 1],
    ]);
  });

  it("accepts hidden code-zero deck moves emitted while sorting", () => {
    const value = projector();

    expect(() =>
      value.apply({
        type: EngineMessageType.MOVE,
        card: 0,
        from: {
          controller: 0,
          location: EngineLocation.DECK,
          sequence: 39,
          position: EnginePosition.FACE_DOWN_DEFENSE,
        },
        to: {
          controller: 0,
          location: EngineLocation.DECK,
          sequence: 39,
          position: EnginePosition.FACE_DOWN_DEFENSE,
        },
      }),
    ).not.toThrow();
    expect(value.snapshot().players[0].deckCount).toBe(40);
  });

  it("tracks life points, turns, phases, and core-provided results", () => {
    const value = projector();
    value.apply({ type: EngineMessageType.NEW_TURN, player: 0 });
    value.apply({ type: EngineMessageType.NEW_PHASE, phase: 4 });
    value.apply({ type: EngineMessageType.DAMAGE, player: 1, amount: 1800 });
    const update = value.apply({
      type: EngineMessageType.WIN,
      player: 0,
      reason: 1,
    });

    expect(value.snapshot()).toMatchObject({
      turn: 1,
      turnPlayer: 0,
      phase: "main1",
    });
    expect(value.snapshot().players[1].lifePoints).toBe(6200);
    expect(update.result).toEqual({
      type: "completed",
      winner: 0,
      loser: 1,
      reason: 1,
    });
  });
});
