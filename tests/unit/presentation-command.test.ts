import { describe, expect, it, vi } from "vitest";
import type { DuelPresentationEvent } from "../../src/duel/contracts/duel-presentation-event.ts";
import {
  PresentationScheduler,
  presentationCommandForEvent,
} from "../../src/app/presentation/presentation-command.ts";

const events: readonly DuelPresentationEvent[] = [
  { type: "duelStarted" },
  { type: "turnStarted", player: 0, turn: 1 },
  { type: "phaseChanged", phase: "main1" },
  { type: "cardDrawn", player: 0, count: 1 },
  { type: "cardsShuffled", player: 1, location: "deck" },
  { type: "cardMoved", from: "hand", to: "monster" },
  { type: "summon", player: 0 },
  { type: "specialSummon", player: 0 },
  { type: "flipSummon", player: 0 },
  { type: "set", player: 0 },
  { type: "positionChanged", position: "faceUpDefense" },
  { type: "attack", player: 0, direct: true },
  { type: "damage", player: 1, amount: 1200 },
  { type: "recover", player: 0, amount: 500 },
  { type: "lifePointsChanged", player: 1, lifePoints: 6800 },
  { type: "chainChanged", size: 2 },
  { type: "hint", message: "Resolve effect" },
];

describe("presentation commands", () => {
  it("classifies every presentation event without affecting engine state", () => {
    expect(
      events.map((event) => presentationCommandForEvent(event).kind),
    ).toEqual([
      "notice",
      "notice",
      "notice",
      "notice",
      "notice",
      "card-move",
      "summon",
      "summon",
      "summon",
      "set",
      "position",
      "attack",
      "life-points",
      "life-points",
      "life-points",
      "chain",
      "notice",
    ]);
  });

  it("removes animation duration for reduced-motion users", () => {
    expect(
      events.map(
        (event) => presentationCommandForEvent(event, true).durationMs,
      ),
    ).toEqual(Array.from({ length: events.length }, () => 0));
  });

  it("cancels queued feedback on reset without delaying callers", async () => {
    const scheduler = new PresentationScheduler();
    const present = vi.fn();
    scheduler.run(presentationCommandForEvent(events[0]!), present);
    scheduler.cancel();
    await Promise.resolve();
    expect(present).not.toHaveBeenCalled();
  });
});
