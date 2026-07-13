import type { CardInstanceId, ChoiceId } from "../duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
} from "../duel/contracts/player-prompt.ts";
import type {
  CardPosition,
  PlayerIndex,
  PublicCard,
  PublicDuelState,
  PublicLocation,
} from "../duel/contracts/public-duel-state.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  createDuelFieldLayout,
  fieldZoneId,
  type FieldZoneKind,
} from "./duel-field-layout.ts";

export interface FieldCardView {
  readonly id: string;
  readonly instanceId?: CardInstanceId;
  readonly code?: number;
  readonly player: PlayerIndex;
  readonly zone: FieldZoneKind;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly hidden: boolean;
  readonly label: string;
}

export interface FieldStackView {
  readonly id: string;
  readonly player: PlayerIndex;
  readonly zone: "deck" | "extra";
  readonly count: number;
  readonly x: number;
  readonly y: number;
}

export interface FieldSnapshotView {
  readonly cards: ReadonlyMap<string, FieldCardView>;
  readonly stacks: ReadonlyMap<string, FieldStackView>;
}

const LAYOUT_BY_ID = new Map(
  createDuelFieldLayout().map((zone) => [zone.id, zone] as const),
);

export function mapSnapshotToField(
  snapshot: PublicDuelState,
): FieldSnapshotView {
  const cards = new Map<string, FieldCardView>();
  const stacks = new Map<string, FieldStackView>();
  for (const player of snapshot.players) {
    addCards(cards, player.player, "hand", player.hand);
    addCards(cards, player.player, "monster", player.monsters);
    addCards(cards, player.player, "spellTrap", player.spellsAndTraps);
    addCards(cards, player.player, "graveyard", player.graveyard);
    addCards(cards, player.player, "banished", player.banished);
    if (player.player === 1) {
      for (let index = 0; index < player.handCount; index += 1)
        addHiddenHandCard(cards, index, player.handCount);
    }
    addStack(stacks, player.player, "deck", player.deckCount);
    addStack(stacks, player.player, "extra", player.extraDeckCount);
  }
  return Object.freeze({ cards, stacks });
}

export function promptFieldTargets(
  prompt: PlayerPrompt | null,
  snapshot: PublicDuelState | null,
): {
  readonly cardIds: ReadonlySet<string>;
  readonly zoneIds: ReadonlySet<string>;
} {
  const cardIds = new Set<string>();
  const zoneIds = new Set<string>();
  if (prompt === null) return { cardIds, zoneIds };
  for (const choice of prompt.choices) {
    if (choice.place !== undefined) {
      zoneIds.add(
        fieldZoneId(
          choice.place.player,
          normalizePromptLocation(choice.place.location),
          choice.place.sequence,
        ),
      );
    }
    if (choice.card === undefined) continue;
    const publicCard = findPublicCard(snapshot, choice.card);
    cardIds.add(publicCard?.instanceId ?? choice.card.instanceId);
  }
  return { cardIds, zoneIds };
}

export function fieldCardChoices(
  prompt: PlayerPrompt | null,
  snapshot: PublicDuelState | null,
  instanceId: string,
): readonly PromptChoice[] {
  if (prompt === null) return [];
  return prompt.choices.filter((choice) => {
    if (choice.card === undefined) return false;
    if (choice.card.instanceId === instanceId) return true;
    return findPublicCard(snapshot, choice.card)?.instanceId === instanceId;
  });
}

export function fieldZoneChoice(
  prompt: PlayerPrompt | null,
  zoneId: string,
): PromptChoice | undefined {
  return prompt?.choices.find(
    (choice) =>
      choice.place !== undefined &&
      fieldZoneId(
        choice.place.player,
        normalizePromptLocation(choice.place.location),
        choice.place.sequence,
      ) === zoneId,
  );
}

export function reconcileFieldKeys(
  current: ReadonlySet<string>,
  next: ReadonlySet<string>,
): { readonly create: readonly string[]; readonly remove: readonly string[] } {
  return {
    create: [...next].filter((id) => !current.has(id)),
    remove: [...current].filter((id) => !next.has(id)),
  };
}

function addCards(
  target: Map<string, FieldCardView>,
  player: PlayerIndex,
  zone: FieldZoneKind,
  values: readonly PublicCard[],
): void {
  for (const card of values) {
    const effectiveZone = card.location === "field" ? "field" : zone;
    const base = LAYOUT_BY_ID.get(
      fieldZoneId(player, effectiveZone, card.sequence),
    );
    const stackBase = LAYOUT_BY_ID.get(fieldZoneId(player, effectiveZone, 0));
    if (base === undefined && stackBase === undefined) continue;
    const coordinate = base ?? stackBase!;
    const offset =
      zone === "hand" ? handOffset(card.sequence, values.length) : 0;
    target.set(
      card.instanceId,
      Object.freeze({
        id: card.instanceId,
        instanceId: card.instanceId,
        ...(card.code === undefined ? {} : { code: card.code }),
        player,
        zone: effectiveZone,
        sequence: card.sequence,
        x: coordinate.x + offset,
        y: coordinate.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        rotation: rotationFor(card.position, player),
        hidden:
          card.code === undefined || (!card.faceUp && effectiveZone !== "hand"),
        label: card.code === undefined ? "Hidden card" : `Card ${card.code}`,
      }),
    );
  }
}

function addHiddenHandCard(
  target: Map<string, FieldCardView>,
  index: number,
  count: number,
): void {
  const coordinate = LAYOUT_BY_ID.get(fieldZoneId(1, "hand", 0));
  if (coordinate === undefined) return;
  const id = `opponent-hand-${index}`;
  target.set(
    id,
    Object.freeze({
      id,
      player: 1,
      zone: "hand",
      sequence: index,
      x: coordinate.x + handOffset(index, count),
      y: coordinate.y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      rotation: 180,
      hidden: true,
      label: "Hidden opponent card",
    }),
  );
}

function addStack(
  target: Map<string, FieldStackView>,
  player: PlayerIndex,
  zone: "deck" | "extra",
  count: number,
): void {
  const layout = LAYOUT_BY_ID.get(fieldZoneId(player, zone, 0));
  if (layout === undefined) return;
  const id = fieldZoneId(player, zone, 0);
  target.set(id, { id, player, zone, count, x: layout.x, y: layout.y });
}

function handOffset(index: number, count: number): number {
  return (index - (count - 1) / 2) * Math.min(58, 600 / Math.max(count, 1));
}

function rotationFor(position: CardPosition, player: PlayerIndex): number {
  const defense =
    position === "faceUpDefense" || position === "faceDownDefense" ? 90 : 0;
  return player === 1 ? defense + 180 : defense;
}

function findPublicCard(
  snapshot: PublicDuelState | null,
  candidate: {
    readonly controller: PlayerIndex;
    readonly location: PublicLocation;
    readonly sequence: number;
  },
): PublicCard | undefined {
  if (snapshot === null) return undefined;
  const player = snapshot.players[candidate.controller];
  const zone = publicCards(player, candidate.location);
  return zone?.find((card) => card.sequence === candidate.sequence);
}

function publicCards(
  player: PublicDuelState["players"][number],
  location: PublicLocation,
): readonly PublicCard[] | undefined {
  switch (location) {
    case "hand":
      return player.hand;
    case "monster":
      return player.monsters;
    case "spellTrap":
    case "field":
      return player.spellsAndTraps;
    case "graveyard":
      return player.graveyard;
    case "banished":
      return player.banished;
    case "deck":
    case "extra":
      return undefined;
  }
}

function normalizePromptLocation(
  location: "monster" | "spellTrap" | "field" | "pendulum",
): FieldZoneKind {
  return location === "pendulum" ? "spellTrap" : location;
}

export function choiceIdsForFieldIntent(
  choice: PromptChoice | undefined,
): readonly ChoiceId[] {
  return choice === undefined ? [] : [choice.id];
}
