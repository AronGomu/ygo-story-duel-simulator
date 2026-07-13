import { assertNever } from "../../duel/contracts/assert-never.ts";
import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";

export function formatDuelPresentationEvent(
  event: DuelPresentationEvent,
): string {
  switch (event.type) {
    case "duelStarted":
      return "The duel started.";
    case "turnStarted":
      return `Turn ${event.turn}: ${playerLabel(event.player)} to play.`;
    case "phaseChanged":
      return `Phase changed to ${formatWords(event.phase)}.`;
    case "cardDrawn":
      return `${playerLabel(event.player)} drew ${event.count} card${event.count === 1 ? "" : "s"}.`;
    case "cardsShuffled":
      return `${playerLabel(event.player)} shuffled their ${event.location}.`;
    case "cardMoved":
      return `${cardLabel(event.card)} moved from ${formatWords(event.from)} to ${formatWords(event.to)}.`;
    case "summon":
      return `${playerLabel(event.player)} summoned ${cardLabel(event.card)}.`;
    case "specialSummon":
      return `${playerLabel(event.player)} Special Summoned ${cardLabel(event.card)}.`;
    case "flipSummon":
      return `${playerLabel(event.player)} Flip Summoned ${cardLabel(event.card)}.`;
    case "set":
      return `${playerLabel(event.player)} set ${cardLabel(event.card)}.`;
    case "positionChanged":
      return `${cardLabel(event.card)} changed to ${formatWords(event.position)}.`;
    case "attack":
      return `${playerLabel(event.player)} declared ${event.direct ? "a direct attack" : "an attack"}.`;
    case "damage":
      return `${playerLabel(event.player)} took ${event.amount} damage.`;
    case "recover":
      return `${playerLabel(event.player)} recovered ${event.amount} LP.`;
    case "lifePointsChanged":
      return `${playerLabel(event.player)} now has ${event.lifePoints} LP.`;
    case "chainChanged":
      return event.size === 0
        ? "The chain resolved."
        : `The chain now has ${event.size} link${event.size === 1 ? "" : "s"}.`;
    case "hint":
      return event.message;
    default:
      return assertNever(event, "Unknown duel presentation event");
  }
}

function playerLabel(player: 0 | 1): string {
  return player === 0 ? "You" : "Opponent";
}

function cardLabel(card?: number): string {
  return card === undefined ? "A card" : `Card ${card}`;
}

function formatWords(value: string): string {
  return value.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
