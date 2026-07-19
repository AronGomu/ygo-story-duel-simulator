import type { DuelDiagnosticTrace } from "./duel-diagnostics.ts";
import {
  isDuelErrorCode,
  isRecoverableDuelErrorCode,
  type DuelError,
} from "./duel-error.ts";
import type { DuelPresentationEvent } from "./duel-presentation-event.ts";
import type { DuelResult } from "./duel-result.ts";
import type { PlayerPrompt, PromptKind } from "./player-prompt.ts";
import type { SnapshotId } from "./ids.ts";
import type { PublicDuelState } from "./public-duel-state.ts";

export type DuelWorkerEvent =
  | {
      readonly type: "ready";
      readonly coreVersion: readonly [number, number];
      readonly snapshotId?: SnapshotId;
      readonly activeImageManifestSha256?: string;
    }
  | {
      readonly type: "loading";
      readonly stage: string;
      readonly progress?: number;
    }
  | { readonly type: "state"; readonly state: PublicDuelState }
  | { readonly type: "event"; readonly event: DuelPresentationEvent }
  | { readonly type: "prompt"; readonly prompt: PlayerPrompt }
  | { readonly type: "result"; readonly result: DuelResult }
  | { readonly type: "diagnostics"; readonly trace: DuelDiagnosticTrace }
  | { readonly type: "error"; readonly error: DuelError }
  | { readonly type: "disposed"; readonly clean: boolean };

const MAXIMUM_ID_LENGTH = 512;
const MAXIMUM_TEXT_LENGTH = 32_768;
const MAXIMUM_CHOICES = 256;
const MAXIMUM_PUBLIC_CARDS = 256;
const MAXIMUM_CHAIN_LINKS = 256;
const MAXIMUM_DIAGNOSTIC_TEXT_UNITS = 1_000_000;

const PROMPT_KINDS: ReadonlySet<PromptKind> = new Set([
  "idleCommand",
  "battleCommand",
  "yesNo",
  "effectYesNo",
  "option",
  "chain",
  "selectCard",
  "selectTribute",
  "selectSum",
  "selectUnselectCard",
  "selectPlace",
  "selectDisabledField",
  "selectPosition",
  "sortCard",
  "sortChain",
  "selectCounter",
  "announceNumber",
  "announceAttribute",
  "announceRace",
  "announceCard",
  "rockPaperScissors",
]);

const CHOICE_ACTIONS = new Set([
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
]);
const PHASES = new Set([
  "draw",
  "standby",
  "main1",
  "battleStart",
  "battleStep",
  "damage",
  "damageCalculation",
  "battle",
  "main2",
  "end",
  "unknown",
]);
const POSITIONS = new Set([
  "faceUpAttack",
  "faceDownAttack",
  "faceUpDefense",
  "faceDownDefense",
]);
const LOCATIONS = new Set([
  "deck",
  "hand",
  "monster",
  "spellTrap",
  "field",
  "graveyard",
  "banished",
  "extra",
]);
const PLACE_LOCATIONS = new Set(["monster", "spellTrap", "field", "pendulum"]);

export class DuelWorkerEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuelWorkerEventValidationError";
  }
}

export function parseDuelWorkerEvent(value: unknown): DuelWorkerEvent {
  let clone: unknown;
  try {
    clone = globalThis.structuredClone(value);
  } catch {
    throw invalid("structured clone");
  }
  const event = requireRecord(clone, "Worker event");
  switch (event.type) {
    case "ready":
      requireExactKeys(
        event,
        ["type", "coreVersion", "snapshotId", "activeImageManifestSha256"],
        "ready",
      );
      requireTupleVersion(event.coreVersion, "ready.coreVersion");
      if (event.snapshotId !== undefined) {
        const id = requireString(event.snapshotId, "ready.snapshotId", 64);
        if (!/^[a-f0-9]{64}$/.test(id)) throw invalid("ready.snapshotId");
      }
      if (event.activeImageManifestSha256 !== undefined) {
        const digest = requireString(
          event.activeImageManifestSha256,
          "ready.activeImageManifestSha256",
          64,
        );
        if (!/^[a-f0-9]{64}$/.test(digest))
          throw invalid("ready.activeImageManifestSha256");
      }
      break;
    case "loading":
      requireExactKeys(event, ["type", "stage", "progress"], "loading");
      requireString(event.stage, "loading.stage", 256);
      if (event.progress !== undefined)
        requireFiniteNumber(event.progress, "loading.progress", 0, 1);
      break;
    case "state":
      requireExactKeys(event, ["type", "state"], "state event");
      validatePublicState(event.state);
      break;
    case "event":
      requireExactKeys(event, ["type", "event"], "presentation event");
      validatePresentationEvent(event.event);
      break;
    case "prompt":
      requireExactKeys(event, ["type", "prompt"], "prompt event");
      validatePrompt(event.prompt);
      break;
    case "result":
      requireExactKeys(event, ["type", "result"], "result event");
      validateResult(event.result);
      break;
    case "diagnostics":
      requireExactKeys(event, ["type", "trace"], "diagnostics event");
      validateDiagnosticTrace(event.trace);
      break;
    case "error":
      requireExactKeys(event, ["type", "error"], "error event");
      validateDuelError(event.error);
      break;
    case "disposed":
      requireExactKeys(event, ["type", "clean"], "disposed");
      requireBoolean(event.clean, "disposed.clean");
      break;
    default:
      throw invalid("type");
  }
  return clone as DuelWorkerEvent;
}

function validatePrompt(value: unknown): void {
  const prompt = requireRecord(value, "Worker prompt");
  requireExactKeys(
    prompt,
    [
      "id",
      "kind",
      "player",
      "title",
      "message",
      "contextCard",
      "choices",
      "minimum",
      "maximum",
      "cancelable",
      "ordered",
      "requiredTotal",
      "sumMode",
      "mandatoryContributions",
    ],
    "prompt",
  );
  requireString(prompt.id, "prompt.id", MAXIMUM_ID_LENGTH);
  if (
    typeof prompt.kind !== "string" ||
    !PROMPT_KINDS.has(prompt.kind as PromptKind)
  )
    throw invalid("prompt.kind");
  requirePlayer(prompt.player, "prompt.player");
  if (prompt.player !== 0) throw invalid("prompt.player privacy");
  requireString(prompt.title, "prompt.title", MAXIMUM_TEXT_LENGTH);
  if (prompt.message !== undefined)
    requireString(prompt.message, "prompt.message", MAXIMUM_TEXT_LENGTH);
  if (prompt.contextCard !== undefined)
    validatePromptCard(prompt.contextCard, "prompt.contextCard");
  const choices = requireArray(
    prompt.choices,
    "prompt.choices",
    MAXIMUM_CHOICES,
  );
  const choiceIds = new Set<string>();
  for (const [index, choice] of choices.entries()) {
    const record = requireRecord(choice, `prompt.choices[${index}]`);
    requireExactKeys(
      record,
      [
        "id",
        "label",
        "action",
        "card",
        "place",
        "value",
        "selected",
        "allocationMaximum",
      ],
      `prompt.choices[${index}]`,
    );
    const id = requireString(
      record.id,
      `prompt.choices[${index}].id`,
      MAXIMUM_ID_LENGTH,
    );
    if (choiceIds.has(id)) throw invalid("duplicate prompt choice ID");
    choiceIds.add(id);
    requireString(
      record.label,
      `prompt.choices[${index}].label`,
      MAXIMUM_TEXT_LENGTH,
    );
    if (typeof record.action !== "string" || !CHOICE_ACTIONS.has(record.action))
      throw invalid(`prompt.choices[${index}].action`);
    if (record.card !== undefined)
      validatePromptCard(record.card, `prompt.choices[${index}].card`);
    if (record.place !== undefined)
      validatePromptPlace(record.place, `prompt.choices[${index}].place`);
    if (record.value !== undefined) {
      if (typeof record.value === "string")
        requireString(
          record.value,
          `prompt.choices[${index}].value`,
          MAXIMUM_TEXT_LENGTH,
        );
      else requireFiniteNumber(record.value, `prompt.choices[${index}].value`);
    }
    if (record.selected !== undefined)
      requireBoolean(record.selected, `prompt.choices[${index}].selected`);
    if (record.allocationMaximum !== undefined)
      requireSafeInteger(
        record.allocationMaximum,
        `prompt.choices[${index}].allocationMaximum`,
        0,
        MAXIMUM_CHOICES,
      );
  }
  const minimum = requireSafeInteger(
    prompt.minimum,
    "prompt.minimum",
    0,
    MAXIMUM_CHOICES,
  );
  const maximum = requireSafeInteger(
    prompt.maximum,
    "prompt.maximum",
    0,
    MAXIMUM_CHOICES,
  );
  if (minimum > maximum) throw invalid("prompt selection bounds");
  requireBoolean(prompt.cancelable, "prompt.cancelable");
  requireBoolean(prompt.ordered, "prompt.ordered");
  if (prompt.requiredTotal !== undefined)
    requireSafeInteger(
      prompt.requiredTotal,
      "prompt.requiredTotal",
      0,
      Number.MAX_SAFE_INTEGER,
    );
  if (
    prompt.sumMode !== undefined &&
    prompt.sumMode !== "exact" &&
    prompt.sumMode !== "atLeast"
  )
    throw invalid("prompt.sumMode");
  if (prompt.mandatoryContributions !== undefined) {
    const contributions = requireArray(
      prompt.mandatoryContributions,
      "prompt.mandatoryContributions",
      MAXIMUM_CHOICES,
    );
    contributions.forEach((contribution, index) =>
      validateContribution(
        contribution,
        `prompt.mandatoryContributions[${index}]`,
      ),
    );
  }
}

function validatePromptCard(value: unknown, label: string): void {
  const card = requireRecord(value, label);
  requireExactKeys(
    card,
    [
      "instanceId",
      "code",
      "name",
      "description",
      "controller",
      "location",
      "sequence",
      "position",
      "contribution",
      "alternativeContribution",
    ],
    label,
  );
  requireString(card.instanceId, `${label}.instanceId`, MAXIMUM_ID_LENGTH);
  if (card.code !== undefined)
    requireSafeInteger(card.code, `${label}.code`, 1, Number.MAX_SAFE_INTEGER);
  if (card.name !== undefined)
    requireString(card.name, `${label}.name`, MAXIMUM_TEXT_LENGTH);
  if (card.description !== undefined)
    requireString(
      card.description,
      `${label}.description`,
      MAXIMUM_TEXT_LENGTH,
      true,
    );
  requirePlayer(card.controller, `${label}.controller`);
  requireEnum(card.location, LOCATIONS, `${label}.location`);
  requireSafeInteger(card.sequence, `${label}.sequence`, 0, 255);
  if (card.position !== undefined)
    requireEnum(card.position, POSITIONS, `${label}.position`);
  if (card.contribution !== undefined)
    requireSafeInteger(
      card.contribution,
      `${label}.contribution`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  if (card.alternativeContribution !== undefined)
    requireSafeInteger(
      card.alternativeContribution,
      `${label}.alternativeContribution`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  const concealedOpponentCard =
    card.controller === 1 &&
    (card.location === "deck" ||
      card.location === "extra" ||
      card.location === "hand" ||
      card.position === "faceDownAttack" ||
      card.position === "faceDownDefense");
  if (
    concealedOpponentCard &&
    (card.code !== undefined ||
      card.name !== undefined ||
      card.description !== undefined)
  )
    throw invalid(`${label}.identity privacy`);
}

function validatePromptPlace(value: unknown, label: string): void {
  const place = requireRecord(value, label);
  requireExactKeys(place, ["player", "location", "sequence"], label);
  requirePlayer(place.player, `${label}.player`);
  requireEnum(place.location, PLACE_LOCATIONS, `${label}.location`);
  requireSafeInteger(place.sequence, `${label}.sequence`, 0, 255);
}

function validateContribution(value: unknown, label: string): void {
  const contribution = requireRecord(value, label);
  requireExactKeys(
    contribution,
    ["contribution", "alternativeContribution"],
    label,
  );
  requireSafeInteger(
    contribution.contribution,
    `${label}.contribution`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (contribution.alternativeContribution !== undefined)
    requireSafeInteger(
      contribution.alternativeContribution,
      `${label}.alternativeContribution`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
}

function validatePublicState(value: unknown): void {
  const state = requireRecord(value, "Worker state");
  requireExactKeys(
    state,
    [
      "snapshotId",
      "revision",
      "turn",
      "turnPlayer",
      "phase",
      "players",
      "chain",
    ],
    "state",
  );
  requireString(state.snapshotId, "state.snapshotId", MAXIMUM_ID_LENGTH);
  requireSafeInteger(
    state.revision,
    "state.revision",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  requireSafeInteger(state.turn, "state.turn", 0, Number.MAX_SAFE_INTEGER);
  requirePlayer(state.turnPlayer, "state.turnPlayer");
  requireEnum(state.phase, PHASES, "state.phase");
  const players = requireArray(state.players, "state.players", 2);
  if (players.length !== 2) throw invalid("state.players length");
  players.forEach((player, index) => validatePublicPlayer(player, index));
  const firstPlayer = requireRecord(players[0], "state.players[0]");
  const secondPlayer = requireRecord(players[1], "state.players[1]");
  if (firstPlayer.player !== 0 || secondPlayer.player !== 1)
    throw invalid("state.players order");
  if (!Array.isArray(secondPlayer.hand) || secondPlayer.hand.length !== 0)
    throw invalid("state.players[1].hand privacy");
  const chain = requireArray(state.chain, "state.chain", MAXIMUM_CHAIN_LINKS);
  chain.forEach((link, index) => validateChainLink(link, index));
}

function validatePublicPlayer(value: unknown, index: number): void {
  const label = `state.players[${index}]`;
  const player = requireRecord(value, label);
  requireExactKeys(
    player,
    [
      "player",
      "lifePoints",
      "deckCount",
      "extraDeckCount",
      "handCount",
      "hand",
      "monsters",
      "spellsAndTraps",
      "graveyard",
      "banished",
    ],
    label,
  );
  requirePlayer(player.player, `${label}.player`);
  requireSafeInteger(
    player.lifePoints,
    `${label}.lifePoints`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  for (const count of ["deckCount", "extraDeckCount", "handCount"] as const) {
    requireSafeInteger(
      player[count],
      `${label}.${count}`,
      0,
      MAXIMUM_PUBLIC_CARDS,
    );
  }
  for (const zone of [
    "hand",
    "monsters",
    "spellsAndTraps",
    "graveyard",
    "banished",
  ] as const) {
    const cards = requireArray(
      player[zone],
      `${label}.${zone}`,
      MAXIMUM_PUBLIC_CARDS,
    );
    cards.forEach((card, cardIndex) => {
      const cardLabel = `${label}.${zone}[${cardIndex}]`;
      validatePublicCard(card, cardLabel);
      if (index === 1) {
        const record = requireRecord(card, cardLabel);
        const concealed =
          record.position === "faceDownAttack" ||
          record.position === "faceDownDefense";
        if (concealed && record.code !== undefined)
          throw invalid(`${cardLabel}.code privacy`);
      }
    });
  }
}

function validatePublicCard(value: unknown, label: string): void {
  const card = requireRecord(value, label);
  requireExactKeys(
    card,
    [
      "instanceId",
      "code",
      "owner",
      "controller",
      "location",
      "sequence",
      "position",
      "faceUp",
      "overlayMaterials",
    ],
    label,
  );
  requireString(card.instanceId, `${label}.instanceId`, MAXIMUM_ID_LENGTH);
  if (card.code !== undefined)
    requireSafeInteger(card.code, `${label}.code`, 1, Number.MAX_SAFE_INTEGER);
  requirePlayer(card.owner, `${label}.owner`);
  requirePlayer(card.controller, `${label}.controller`);
  requireEnum(card.location, LOCATIONS, `${label}.location`);
  requireSafeInteger(card.sequence, `${label}.sequence`, 0, 255);
  requireEnum(card.position, POSITIONS, `${label}.position`);
  requireBoolean(card.faceUp, `${label}.faceUp`);
  const expectedFaceUp =
    card.position === "faceUpAttack" || card.position === "faceUpDefense";
  if (card.faceUp !== expectedFaceUp)
    throw invalid(`${label}.faceUp position consistency`);
  const materials = requireArray(
    card.overlayMaterials,
    `${label}.overlayMaterials`,
    MAXIMUM_PUBLIC_CARDS,
  );
  materials.forEach((material, index) =>
    requireString(
      material,
      `${label}.overlayMaterials[${index}]`,
      MAXIMUM_ID_LENGTH,
    ),
  );
}

function validateChainLink(value: unknown, index: number): void {
  const label = `state.chain[${index}]`;
  const link = requireRecord(value, label);
  requireExactKeys(link, ["index", "controller", "card", "label"], label);
  requireSafeInteger(link.index, `${label}.index`, 0, MAXIMUM_CHAIN_LINKS);
  requirePlayer(link.controller, `${label}.controller`);
  if (link.card !== undefined)
    requireSafeInteger(link.card, `${label}.card`, 1, Number.MAX_SAFE_INTEGER);
  requireString(link.label, `${label}.label`, MAXIMUM_TEXT_LENGTH);
}

function validatePresentationEvent(value: unknown): void {
  const event = requireRecord(value, "Worker presentation event");
  switch (event.type) {
    case "duelStarted":
      requireExactKeys(event, ["type"], "event.duelStarted");
      return;
    case "turnStarted":
      requireExactKeys(event, ["type", "player", "turn"], "event.turnStarted");
      requirePlayer(event.player, "event.player");
      requireSafeInteger(event.turn, "event.turn", 0, Number.MAX_SAFE_INTEGER);
      return;
    case "phaseChanged":
      requireExactKeys(event, ["type", "phase"], "event.phaseChanged");
      requireEnum(event.phase, PHASES, "event.phase");
      return;
    case "cardDrawn":
      requireExactKeys(event, ["type", "player", "count"], "event.cardDrawn");
      requirePlayer(event.player, "event.player");
      requireSafeInteger(event.count, "event.count", 0, MAXIMUM_PUBLIC_CARDS);
      return;
    case "cardsShuffled":
      requireExactKeys(
        event,
        ["type", "player", "location"],
        "event.cardsShuffled",
      );
      requirePlayer(event.player, "event.player");
      if (event.location !== "deck" && event.location !== "hand")
        throw invalid("event.location");
      return;
    case "cardMoved":
      requireExactKeys(
        event,
        ["type", "card", "instanceId", "from", "to"],
        "event.cardMoved",
      );
      validateOptionalCardIdentity(event, "event");
      requireEnum(event.from, LOCATIONS, "event.from");
      requireEnum(event.to, LOCATIONS, "event.to");
      return;
    case "summon":
    case "specialSummon":
    case "flipSummon":
    case "set":
      requireExactKeys(
        event,
        ["type", "player", "card"],
        `event.${event.type}`,
      );
      requirePlayer(event.player, "event.player");
      if (event.card !== undefined)
        requireSafeInteger(
          event.card,
          "event.card",
          1,
          Number.MAX_SAFE_INTEGER,
        );
      return;
    case "positionChanged":
      requireExactKeys(
        event,
        ["type", "card", "position"],
        "event.positionChanged",
      );
      if (event.card !== undefined)
        requireSafeInteger(
          event.card,
          "event.card",
          1,
          Number.MAX_SAFE_INTEGER,
        );
      requireEnum(event.position, POSITIONS, "event.position");
      return;
    case "attack":
      requireExactKeys(event, ["type", "player", "direct"], "event.attack");
      requirePlayer(event.player, "event.player");
      requireBoolean(event.direct, "event.direct");
      return;
    case "damage":
    case "recover":
      requireExactKeys(
        event,
        ["type", "player", "amount"],
        `event.${event.type}`,
      );
      requirePlayer(event.player, "event.player");
      requireSafeInteger(
        event.amount,
        "event.amount",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return;
    case "lifePointsChanged":
      requireExactKeys(
        event,
        ["type", "player", "lifePoints"],
        "event.lifePointsChanged",
      );
      requirePlayer(event.player, "event.player");
      requireSafeInteger(
        event.lifePoints,
        "event.lifePoints",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return;
    case "chainChanged":
      requireExactKeys(event, ["type", "size"], "event.chainChanged");
      requireSafeInteger(event.size, "event.size", 0, MAXIMUM_CHAIN_LINKS);
      return;
    case "hint":
      requireExactKeys(event, ["type", "message"], "event.hint");
      requireString(event.message, "event.message", MAXIMUM_TEXT_LENGTH);
      return;
    default:
      throw invalid("presentation event type");
  }
}

function validateOptionalCardIdentity(
  event: Readonly<Record<string, unknown>>,
  label: string,
): void {
  if (event.card !== undefined)
    requireSafeInteger(event.card, `${label}.card`, 1, Number.MAX_SAFE_INTEGER);
  if (event.instanceId !== undefined)
    requireString(event.instanceId, `${label}.instanceId`, MAXIMUM_ID_LENGTH);
}

function validateDiagnosticTrace(value: unknown): void {
  const trace = requireRecord(value, "Worker diagnostics");
  requireExactKeys(
    trace,
    [
      "schemaVersion",
      "sensitivity",
      "presetId",
      "snapshotId",
      "seed",
      "coreVersion",
      "revisions",
      "entries",
      "lastMessageType",
      "pendingPromptId",
    ],
    "diagnostics",
  );
  if (trace.schemaVersion !== 2) throw invalid("diagnostics.schemaVersion");
  if (trace.sensitivity !== "contains-production-seed")
    throw invalid("diagnostics.sensitivity");
  const presetId = requireString(
    trace.presetId,
    "diagnostics.presetId",
    MAXIMUM_ID_LENGTH,
  );
  const snapshot = requireString(
    trace.snapshotId,
    "diagnostics.snapshotId",
    MAXIMUM_ID_LENGTH,
  );
  if (!/^[a-f0-9]{64}$/.test(snapshot)) throw invalid("diagnostics.snapshotId");
  const seed = requireArray(trace.seed, "diagnostics.seed", 4);
  if (seed.length !== 4) throw invalid("diagnostics.seed");
  seed.forEach((part, index) => {
    const text = requireString(part, `diagnostics.seed[${index}]`, 32);
    if (!/^\d+$/.test(text)) throw invalid(`diagnostics.seed[${index}]`);
  });
  requireTupleVersion(trace.coreVersion, "diagnostics.coreVersion");
  const revisions = requireRecord(trace.revisions, "diagnostics.revisions");
  requireExactKeys(
    revisions,
    [
      "enginePackage",
      "engineVersion",
      "babelCdb",
      "cardScripts",
      "distribution",
      "activeImageManifestSha256",
    ],
    "diagnostics.revisions",
  );
  if (
    revisions.enginePackage !== "ocgcore-wasm" ||
    revisions.engineVersion !== "0.1.2"
  )
    throw invalid("diagnostics.revisions.engine");
  for (const key of [
    "babelCdb",
    "cardScripts",
    "distribution",
    "activeImageManifestSha256",
  ] as const)
    requireString(revisions[key], `diagnostics.revisions.${key}`, 512);
  const entries = requireArray(trace.entries, "diagnostics.entries", 10_000);
  let diagnosticTextUnits = presetId.length + snapshot.length;
  const kinds = new Set([
    "process",
    "message",
    "presentation",
    "prompt",
    "response",
    "result",
    "error",
    "engineDiagnostic",
    "promptDiagnostic",
    "lifecycle",
  ]);
  entries.forEach((entry, index) => {
    const label = `diagnostics.entries[${index}]`;
    const record = requireRecord(entry, label);
    requireExactKeys(
      record,
      [
        "sequence",
        "kind",
        "status",
        "diagnosticType",
        "messageType",
        "promptId",
        "choiceIds",
        "player",
        "opponentReason",
        "detail",
      ],
      label,
    );
    requireSafeInteger(
      record.sequence,
      `${label}.sequence`,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    requireEnum(record.kind, kinds, `${label}.kind`);
    if (record.status !== undefined)
      requireSafeInteger(
        record.status,
        `${label}.status`,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    if (record.diagnosticType !== undefined)
      requireSafeInteger(
        record.diagnosticType,
        `${label}.diagnosticType`,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    if (record.messageType !== undefined)
      requireSafeInteger(
        record.messageType,
        `${label}.messageType`,
        0,
        Number.MAX_SAFE_INTEGER,
      );
    if (record.promptId !== undefined)
      diagnosticTextUnits += requireString(
        record.promptId,
        `${label}.promptId`,
        MAXIMUM_ID_LENGTH,
      ).length;
    if (record.choiceIds !== undefined) {
      const choices = requireArray(
        record.choiceIds,
        `${label}.choiceIds`,
        MAXIMUM_CHOICES,
      );
      choices.forEach((choice, choiceIndex) => {
        diagnosticTextUnits += requireString(
          choice,
          `${label}.choiceIds[${choiceIndex}]`,
          MAXIMUM_ID_LENGTH,
        ).length;
      });
    }
    if (record.player !== undefined)
      requirePlayer(record.player, `${label}.player`);
    if (record.opponentReason !== undefined)
      diagnosticTextUnits += requireString(
        record.opponentReason,
        `${label}.opponentReason`,
        256,
      ).length;
    if (record.detail !== undefined)
      diagnosticTextUnits += requireString(
        record.detail,
        `${label}.detail`,
        MAXIMUM_TEXT_LENGTH,
        true,
      ).length;
    if (diagnosticTextUnits > MAXIMUM_DIAGNOSTIC_TEXT_UNITS)
      throw invalid("diagnostics aggregate size");
  });
  if (trace.lastMessageType !== undefined)
    requireSafeInteger(
      trace.lastMessageType,
      "diagnostics.lastMessageType",
      0,
      Number.MAX_SAFE_INTEGER,
    );
  if (trace.pendingPromptId !== undefined)
    requireString(
      trace.pendingPromptId,
      "diagnostics.pendingPromptId",
      MAXIMUM_ID_LENGTH,
    );
}

function validateResult(value: unknown): void {
  const result = requireRecord(value, "Worker result");
  switch (result.type) {
    case "completed":
      requireExactKeys(
        result,
        ["type", "winner", "loser", "reason"],
        "result.completed",
      );
      requirePlayer(result.winner, "result.winner");
      requirePlayer(result.loser, "result.loser");
      if (result.winner === result.loser) throw invalid("result players");
      requireSafeInteger(
        result.reason,
        "result.reason",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return;
    case "surrendered":
      requireExactKeys(
        result,
        ["type", "winner", "loser"],
        "result.surrendered",
      );
      requirePlayer(result.winner, "result.winner");
      requirePlayer(result.loser, "result.loser");
      if (result.winner === result.loser) throw invalid("result players");
      return;
    case "unsupported":
      requireExactKeys(
        result,
        ["type", "messageType", "detail"],
        "result.unsupported",
      );
      requireSafeInteger(
        result.messageType,
        "result.messageType",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      requireString(result.detail, "result.detail", MAXIMUM_TEXT_LENGTH);
      return;
    case "engineError":
      requireExactKeys(result, ["type", "detail"], "result.engineError");
      requireString(result.detail, "result.detail", MAXIMUM_TEXT_LENGTH);
      return;
    default:
      throw invalid("result type");
  }
}

function validateDuelError(value: unknown): void {
  const error = requireRecord(value, "Worker error");
  requireExactKeys(
    error,
    ["code", "message", "detail", "recoverable"],
    "error",
  );
  if (!isDuelErrorCode(error.code)) throw invalid("error.code");
  requireString(error.message, "error.message", MAXIMUM_TEXT_LENGTH);
  requireBoolean(error.recoverable, "error.recoverable");
  if (error.recoverable !== isRecoverableDuelErrorCode(error.code))
    throw invalid("error.recoverable");
  if (error.detail !== undefined) {
    const detail = requireRecord(error.detail, "error.detail");
    if (Object.keys(detail).length > 64) throw invalid("error.detail size");
    for (const [key, detailValue] of Object.entries(detail)) {
      requireString(key, "error.detail key", 256);
      if (
        detailValue !== null &&
        typeof detailValue !== "string" &&
        typeof detailValue !== "number" &&
        typeof detailValue !== "boolean"
      )
        throw invalid(`error.detail.${key}`);
      if (typeof detailValue === "number" && !Number.isFinite(detailValue))
        throw invalid(`error.detail.${key}`);
    }
  }
}

function requireRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new DuelWorkerEventValidationError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function requireArray(
  value: unknown,
  label: string,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value)) throw invalid(label);
  if (value.length > maximum) throw invalid(`${label} length`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw invalid(`${label} dense array`);
  }
  return value;
}

function requireString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  )
    throw invalid(label);
  return value;
}

function requireBoolean(
  value: unknown,
  label: string,
): asserts value is boolean {
  if (typeof value !== "boolean") throw invalid(label);
}

function requirePlayer(value: unknown, label: string): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw invalid(label);
}

function requireSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    throw invalid(label);
  return value as number;
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw invalid(label);
  return value;
}

function requireTupleVersion(value: unknown, label: string): void {
  const tuple = requireArray(value, label, 2);
  if (tuple.length !== 2) throw invalid(label);
  requireSafeInteger(tuple[0], `${label}[0]`, 0, 65_535);
  requireSafeInteger(tuple[1], `${label}[1]`, 0, 65_535);
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw invalid(`${label}.${unexpected}`);
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw invalid(label);
}

function invalid(field: string): DuelWorkerEventValidationError {
  return new DuelWorkerEventValidationError(
    `Worker event contains an invalid ${field}`,
  );
}
