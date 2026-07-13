import type {
  CardPosition,
  PlayerIndex,
  PublicLocation,
} from "./contracts/public-duel-state.ts";

export function isFaceUpPosition(position: CardPosition | undefined): boolean {
  return position === "faceUpAttack" || position === "faceUpDefense";
}

/** Identity visibility from the local human viewer's perspective. */
export function isCardIdentityVisible(
  viewer: PlayerIndex,
  controller: PlayerIndex,
  location: PublicLocation,
  position: CardPosition | undefined,
): boolean {
  return (
    controller === viewer ||
    location === "graveyard" ||
    isFaceUpPosition(position)
  );
}
