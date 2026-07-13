import { readFile } from "node:fs/promises";
import type { ChoiceId } from "../../src/duel/contracts/ids.ts";
import type {
  ChoiceAction,
  PlayerPrompt,
  PromptChoice,
  PromptKind,
} from "../../src/duel/contracts/player-prompt.ts";
import type {
  PlayerIndex,
  PublicLocation,
} from "../../src/duel/contracts/public-duel-state.ts";
import { MVP_PROMPT_FAMILIES } from "./action-coverage.ts";

const CHOICE_ACTIONS: readonly ChoiceAction[] = [
  "summon",
  "specialSummon",
  "flipSummon",
  "setMonster",
  "setSpellTrap",
  "activate",
  "changePosition",
  "attack",
  "battlePhase",
  "mainPhase2",
  "endPhase",
  "shuffle",
  "yes",
  "no",
  "pass",
  "cancel",
  "finish",
  "select",
];

const MAXIMUM_PROGRAMMED_RESPONSES = 10_000;

const PUBLIC_LOCATIONS: readonly PublicLocation[] = [
  "deck",
  "hand",
  "monster",
  "spellTrap",
  "field",
  "graveyard",
  "banished",
  "extra",
];

export type ProgrammedTranscriptId =
  | "basic-duel-v1"
  | "tribute-special-v1"
  | "effects-recovery-v1"
  | "prompt-matrix-v1"
  | "sort-chain-v1"
  | "surrender-v1"
  | "deck-out-v1";

export interface ProgrammedCardFingerprint {
  readonly code?: number;
  readonly controller: PlayerIndex;
  readonly location: PublicLocation;
  readonly sequence: number;
}

export interface ProgrammedPlaceFingerprint {
  readonly player: PlayerIndex;
  readonly location: "monster" | "spellTrap" | "field" | "pendulum";
  readonly sequence: number;
}

export interface ProgrammedSelectionFingerprint {
  readonly action: ChoiceAction;
  readonly card?: ProgrammedCardFingerprint;
  readonly place?: ProgrammedPlaceFingerprint;
  readonly value?: number | string;
  readonly occurrence?: number;
}

export interface ProgrammedResponse {
  readonly prompt: PromptKind;
  readonly selections: readonly ProgrammedSelectionFingerprint[];
}

export interface ProgrammedResponseRun extends ProgrammedResponse {
  readonly repeat?: number;
}

export interface ProgrammedTranscript {
  readonly schemaVersion: 1;
  readonly scenarioId: string;
  readonly responseCount: number;
  readonly runCount: number;
  readonly runs: readonly ProgrammedResponseRun[];
  readonly expectedTraceSha256?: string;
}

export async function loadProgrammedTranscript(
  id: ProgrammedTranscriptId,
): Promise<ProgrammedTranscript> {
  const files: Readonly<Record<ProgrammedTranscriptId, string>> = {
    "basic-duel-v1": "basic-duel-v1.json",
    "tribute-special-v1": "tribute-special-v1.json",
    "effects-recovery-v1": "effects-recovery-v1.json",
    "prompt-matrix-v1": "prompt-matrix-v1.json",
    "sort-chain-v1": "sort-chain-v1.json",
    "surrender-v1": "surrender-v1.json",
    "deck-out-v1": "deck-out-v1.json",
  };
  const source = await readFile(
    new URL(`./transcripts/${files[id]}`, import.meta.url),
    "utf8",
  );
  return parseProgrammedTranscript(JSON.parse(source) as unknown);
}

export function loadBasicDuelTranscript(): Promise<ProgrammedTranscript> {
  return loadProgrammedTranscript("basic-duel-v1");
}

export function parseProgrammedTranscript(
  value: unknown,
): ProgrammedTranscript {
  const transcript = requireRecord(value, "transcript");
  if (transcript.schemaVersion !== 1)
    throw new Error(
      `Unsupported programmed transcript schema: ${String(transcript.schemaVersion)}`,
    );
  const scenarioId = requireString(transcript.scenarioId, "scenarioId");
  const responseCount = requireNonNegativeInteger(
    transcript.responseCount,
    "responseCount",
  );
  const runCount = requireNonNegativeInteger(transcript.runCount, "runCount");
  if (responseCount > MAXIMUM_PROGRAMMED_RESPONSES) {
    throw new Error(
      `Programmed transcript exceeds ${MAXIMUM_PROGRAMMED_RESPONSES} responses`,
    );
  }
  if (!Array.isArray(transcript.runs))
    throw new Error("Programmed transcript runs must be an array");
  const runs = transcript.runs.map((run, index) => parseRun(run, index));
  if (runs.length !== runCount) {
    throw new Error(
      `Programmed transcript declares ${runCount} runs but contains ${runs.length}`,
    );
  }
  const expandedCount = runs.reduce(
    (count, run) => count + (run.repeat ?? 1),
    0,
  );
  if (expandedCount !== responseCount) {
    throw new Error(
      `Programmed transcript declares ${responseCount} responses but expands to ${expandedCount}`,
    );
  }
  const expectedTraceSha256 =
    transcript.expectedTraceSha256 === undefined
      ? undefined
      : requireDigest(transcript.expectedTraceSha256);
  return Object.freeze({
    schemaVersion: 1,
    scenarioId,
    responseCount,
    runCount,
    runs: Object.freeze(runs),
    ...(expectedTraceSha256 === undefined ? {} : { expectedTraceSha256 }),
  });
}

export function expandProgrammedResponses(
  transcript: ProgrammedTranscript,
): readonly ProgrammedResponse[] {
  return Object.freeze(
    transcript.runs.flatMap((run) =>
      Array.from({ length: run.repeat ?? 1 }, () =>
        Object.freeze({
          prompt: run.prompt,
          selections: run.selections,
        }),
      ),
    ),
  );
}

export function resolveProgrammedResponse(
  prompt: PlayerPrompt,
  expected: ProgrammedResponse,
  responseIndex: number,
): readonly ChoiceId[] {
  if (prompt.kind !== expected.prompt) {
    throw new Error(
      `Programmed response ${responseIndex + 1} expected ${expected.prompt}, received ${prompt.kind}`,
    );
  }
  return expected.selections.map((selection, selectionIndex) => {
    const matches = prompt.choices.filter((choice) =>
      matchesSelection(choice, selection),
    );
    const occurrence = selection.occurrence ?? 0;
    if (occurrence >= matches.length) {
      throw new Error(
        `Programmed response ${responseIndex + 1} selection ${selectionIndex + 1} matched ${matches.length} choice(s)`,
      );
    }
    if (selection.occurrence === undefined && matches.length !== 1) {
      throw new Error(
        `Programmed response ${responseIndex + 1} selection ${selectionIndex + 1} is ambiguous across ${matches.length} choices`,
      );
    }
    return matches[occurrence]!.id;
  });
}

function parseRun(value: unknown, index: number): ProgrammedResponseRun {
  const run = requireRecord(value, `runs[${index}]`);
  if (!isPromptKind(run.prompt))
    throw new Error(
      `Programmed transcript run ${index + 1} has an invalid prompt`,
    );
  if (!Array.isArray(run.selections) || run.selections.length === 0) {
    throw new Error(
      `Programmed transcript run ${index + 1} must select at least one choice`,
    );
  }
  const selections = run.selections.map((selection, selectionIndex) =>
    parseSelection(selection, index, selectionIndex),
  );
  const repeat =
    run.repeat === undefined
      ? undefined
      : requirePositiveInteger(run.repeat, `runs[${index}].repeat`);
  return Object.freeze({
    prompt: run.prompt,
    selections: Object.freeze(selections),
    ...(repeat === undefined || repeat === 1 ? {} : { repeat }),
  });
}

function parseSelection(
  value: unknown,
  runIndex: number,
  selectionIndex: number,
): ProgrammedSelectionFingerprint {
  const label = `runs[${runIndex}].selections[${selectionIndex}]`;
  const selection = requireRecord(value, label);
  if (!isChoiceAction(selection.action))
    throw new Error(`${label}.action is invalid`);
  const card =
    selection.card === undefined
      ? undefined
      : parseCard(selection.card, `${label}.card`);
  const place =
    selection.place === undefined
      ? undefined
      : parsePlace(selection.place, `${label}.place`);
  const selectedValue = selection.value;
  if (
    selectedValue !== undefined &&
    typeof selectedValue !== "number" &&
    typeof selectedValue !== "string"
  ) {
    throw new Error(`${label}.value must be a number or string`);
  }
  const occurrence =
    selection.occurrence === undefined
      ? undefined
      : requireNonNegativeInteger(selection.occurrence, `${label}.occurrence`);
  return Object.freeze({
    action: selection.action,
    ...(card === undefined ? {} : { card }),
    ...(place === undefined ? {} : { place }),
    ...(selectedValue === undefined ? {} : { value: selectedValue }),
    ...(occurrence === undefined ? {} : { occurrence }),
  });
}

function parseCard(value: unknown, label: string): ProgrammedCardFingerprint {
  const card = requireRecord(value, label);
  const code =
    card.code === undefined
      ? undefined
      : requirePositiveInteger(card.code, `${label}.code`);
  return Object.freeze({
    ...(code === undefined ? {} : { code }),
    controller: requirePlayer(card.controller, `${label}.controller`),
    location: requireLocation(card.location, `${label}.location`),
    sequence: requireNonNegativeInteger(card.sequence, `${label}.sequence`),
  });
}

function parsePlace(value: unknown, label: string): ProgrammedPlaceFingerprint {
  const place = requireRecord(value, label);
  if (
    place.location !== "monster" &&
    place.location !== "spellTrap" &&
    place.location !== "field" &&
    place.location !== "pendulum"
  ) {
    throw new Error(`${label}.location is invalid`);
  }
  return Object.freeze({
    player: requirePlayer(place.player, `${label}.player`),
    location: place.location,
    sequence: requireNonNegativeInteger(place.sequence, `${label}.sequence`),
  });
}

function matchesSelection(
  choice: PromptChoice,
  expected: ProgrammedSelectionFingerprint,
): boolean {
  return (
    choice.action === expected.action &&
    matchesCard(choice, expected.card) &&
    matchesPlace(choice, expected.place) &&
    (expected.value === undefined || choice.value === expected.value)
  );
}

function matchesCard(
  choice: PromptChoice,
  expected: ProgrammedCardFingerprint | undefined,
): boolean {
  if (expected === undefined) return true;
  const card = choice.card;
  return (
    card !== undefined &&
    (expected.code === undefined || card.code === expected.code) &&
    card.controller === expected.controller &&
    card.location === expected.location &&
    card.sequence === expected.sequence
  );
}

function matchesPlace(
  choice: PromptChoice,
  expected: ProgrammedPlaceFingerprint | undefined,
): boolean {
  if (expected === undefined) return true;
  const place = choice.place;
  return (
    place !== undefined &&
    place.player === expected.player &&
    place.location === expected.location &&
    place.sequence === expected.sequence
  );
}

function isPromptKind(value: unknown): value is PromptKind {
  return (
    typeof value === "string" &&
    (MVP_PROMPT_FAMILIES as readonly string[]).includes(value)
  );
}

function isChoiceAction(value: unknown): value is ChoiceAction {
  return (
    typeof value === "string" &&
    (CHOICE_ACTIONS as readonly string[]).includes(value)
  );
}

function requireRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Programmed ${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(
      `Programmed transcript ${label} must be a non-empty string`,
    );
  return value;
}

function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Programmed transcript expectedTraceSha256 is invalid");
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(
      `Programmed transcript ${label} must be a positive integer`,
    );
  return value as number;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(
      `Programmed transcript ${label} must be a non-negative integer`,
    );
  return value as number;
}

function requirePlayer(value: unknown, label: string): PlayerIndex {
  if (value !== 0 && value !== 1)
    throw new Error(`Programmed transcript ${label} must be player 0 or 1`);
  return value;
}

function requireLocation(value: unknown, label: string): PublicLocation {
  if (
    typeof value !== "string" ||
    !(PUBLIC_LOCATIONS as readonly string[]).includes(value)
  ) {
    throw new Error(`Programmed transcript ${label} is invalid`);
  }
  return value as PublicLocation;
}
