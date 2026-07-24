import type { ChoiceId } from "../model/prototype-state.ts";

export type StoryBeat = {
  readonly id: string;
  readonly speaker: "Rin" | "Kael" | "Protagonist" | null;
  readonly kind: "dialogue" | "narration" | "thought";
  readonly text: string;
  readonly background: "station" | "concourse" | "arena";
  readonly characters: readonly ("rin-neutral" | "rin-smile" | "kael")[];
};

const beat = (
  id: string,
  speaker: StoryBeat["speaker"],
  kind: StoryBeat["kind"],
  text: string,
  background: StoryBeat["background"] = "station",
  characters: StoryBeat["characters"] = [],
): StoryBeat => ({ id, speaker, kind, text, background, characters });

export const PROLOGUE = {
  title: "The Signal Beneath the City",
  beats: [
    beat(
      "arrival",
      null,
      "narration",
      "Rain turned the last train into a ribbon of silver.",
    ),
    beat(
      "thought-1",
      "Protagonist",
      "thought",
      "Rin said midnight. She did not say why.",
    ),
    beat("rin-enter", "Rin", "dialogue", "You came.", "station", [
      "rin-neutral",
    ]),
    beat("reply", "Protagonist", "dialogue", "You made it sound urgent."),
    beat(
      "warning",
      "Rin",
      "dialogue",
      "It is. Someone woke the old duel transmitters beneath the arena.",
      "station",
      ["rin-neutral"],
    ),
    beat("train", null, "narration", "The train left without either of them."),
    beat(
      "signal",
      "Rin",
      "dialogue",
      "Every receiver in the district heard one challenge, repeated in a dead frequency.",
      "station",
      ["rin-neutral"],
    ),
    beat(
      "thought-2",
      "Protagonist",
      "thought",
      "A challenge meant a duelist. A dead frequency meant a ghost.",
    ),
    beat(
      "smile",
      "Rin",
      "dialogue",
      "That face says you already want to investigate.",
      "station",
      ["rin-smile"],
    ),
    beat(
      "kael-enter",
      "Kael",
      "dialogue",
      "Or run. Running remains underrated.",
      "station",
      ["rin-smile", "kael"],
    ),
    beat(
      "rin-kael",
      "Rin",
      "dialogue",
      "Kael traced the signal. I supplied the optimism.",
      "station",
      ["rin-smile", "kael"],
    ),
    beat(
      "kael-map",
      "Kael",
      "dialogue",
      "Two nodes answered. The archive is sealed. The arena is inviting us in.",
      "station",
      ["rin-neutral", "kael"],
    ),
    beat(
      "choice-lead",
      "Rin",
      "dialogue",
      "Before we go: are you with me?",
      "station",
      ["rin-neutral"],
    ),
    beat(
      "choice-pause",
      null,
      "narration",
      "Her hand stayed open between them.",
    ),
    beat(
      "reaction",
      "Rin",
      "dialogue",
      "Then we choose how to step into the dark.",
      "station",
      ["rin-smile"],
    ),
    beat(
      "walk",
      null,
      "narration",
      "They crossed the empty concourse toward the river district.",
      "concourse",
    ),
    beat(
      "posters",
      null,
      "narration",
      "Tournament posters peeled from pillars like old scales.",
      "concourse",
    ),
    beat(
      "kael-exit",
      "Kael",
      "dialogue",
      "I will keep the channel open from here.",
      "concourse",
      ["kael"],
    ),
    beat(
      "rin-plan",
      "Rin",
      "dialogue",
      "At the arena, we listen before we answer.",
      "concourse",
      ["rin-neutral"],
    ),
    beat(
      "thought-3",
      "Protagonist",
      "thought",
      "That was not how challenges worked. It was how traps worked.",
    ),
    beat(
      "gate",
      null,
      "narration",
      "The arena gate opened on its own.",
      "arena",
    ),
    beat(
      "rin-long",
      "Rin",
      "dialogue",
      "If the transmitter recognizes your deck, it may stage a complete duel before it reveals who sent the signal. We can still turn back.",
      "arena",
      ["rin-neutral"],
    ),
    beat("reply-2", "Protagonist", "dialogue", "Not after it called us here."),
    beat(
      "lights",
      null,
      "narration",
      "Floodlights woke one bank at a time, drawing a path to the center field.",
      "arena",
    ),
    beat(
      "rin-final",
      "Rin",
      "dialogue",
      "Then remember: winning is not the only way forward.",
      "arena",
      ["rin-smile"],
    ),
    beat(
      "thought-4",
      "Protagonist",
      "thought",
      "Easy to say before the first card hit the field.",
    ),
    beat(
      "objective",
      null,
      "narration",
      "New objective: investigate the Old Arena signal.",
      "arena",
    ),
    beat(
      "map-lead",
      "Rin",
      "dialogue",
      "Pick our route. The city map is linked to the transmitter now.",
      "arena",
      ["rin-neutral"],
    ),
    beat(
      "silence",
      null,
      "narration",
      "Somewhere below, a duel disk powered on.",
    ),
    beat(
      "end",
      "Protagonist",
      "thought",
      "Whatever waited there already knew my name.",
    ),
  ] satisfies readonly StoryBeat[],
  choices: [
    { id: "trust-rin", label: "I trust you. Lead the way." },
    { id: "challenge-rin", label: "Tell me what you are hiding." },
    { id: "observe-first", label: "We watch the signal before deciding." },
  ] satisfies readonly { readonly id: ChoiceId; readonly label: string }[],
} as const;

export const CHOICE_RESPONSES: Record<ChoiceId, string> = {
  "trust-rin": "Rin exhales. “Then I will earn that trust.”",
  "challenge-rin": "Rin meets your stare. “Fair. No more half-answers.”",
  "observe-first": "Kael nods. “Good. You watched before you moved.”",
};

export const LATER_ACKNOWLEDGMENTS: Record<ChoiceId, string> = {
  "trust-rin": "Rin remembers your trust and marks the safest route.",
  "challenge-rin":
    "Rin acknowledges your challenge and shares the full signal trace.",
  "observe-first":
    "Because you watched first, the arena marker reveals an extra warning.",
};
