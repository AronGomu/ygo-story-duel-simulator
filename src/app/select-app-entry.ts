export type AppEntry = "duel" | "deck-builder-prototype";

export function selectAppEntry(hash: string): AppEntry {
  return hash === "#/prototype/deck-builder"
    ? "deck-builder-prototype"
    : "duel";
}
