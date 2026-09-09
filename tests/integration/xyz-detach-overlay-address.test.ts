import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DuelField from "../../src/battle/app/components/DuelField.svelte";
import {
  createInteractionSession,
  reduceInteractionSession,
  type InteractionSession,
  type InteractionSessionAction,
} from "../../src/battle/app/prompts/interaction-session.ts";
import {
  mapPromptToInteractionSpec,
  type ActiveInteractionSpec,
} from "../../src/battle/app/prompts/interaction-spec.ts";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import type { ChoiceId } from "../../src/battle/duel/contracts/ids.ts";
import { snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import {
  captureDanteMaterialDecision,
  type DanteMaterialDecisionCapture,
  type DanteMaterialPromptCapture,
} from "./dante-material-decision.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import {
  mapSnapshotToBoard,
  type BoardViewModel,
} from "../../src/battle/field/board-view-model.ts";
import {
  parseYdk,
  uniqueDeckCodes,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelSeed } from "../../src/battle/worker/engine/duel-seed.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/*
  This integration suite proves `PromptCard.overlay` mirrors the raw engine
  location bit. The companion `captureDanteMaterialDecision` fixture proves
  the pinned Dante line first activates Dante, then decrements projected
  overlay materials. Its classification is therefore safe to use for the
  selector gate: real `overlay:true` choices mean engine-choice; no marker
  means pinned-core auto-detach. No sequence inference is used.
*/
const SCENARIO = Object.freeze({
  name: "detaching a material read back from the core",
  player: "burning-abyss",
  opponent: "opponent",
  seed: seedOf(0),
  policySeed: 1,
});

/** Enough prompts for the scripted seat to reach and pass the Xyz Summon. */
const PROMPT_BUDGET = 400;

/** `EngineLocation.OVERLAY`, restated so the assertion reads the engine
    constant the Worker masks rather than importing Worker internals. */
const ENGINE_LOCATION_OVERLAY = 128;

let adapter: OcgCoreAdapter;
const decks = new Map<string, ParsedDeck>();
let dependencies: ActiveDuelDependencies;
let danteCapture: DanteMaterialDecisionCapture;

beforeAll(async () => {
  adapter = await loadCoreForDomTest();
  for (const name of [SCENARIO.player, SCENARIO.opponent])
    decks.set(name, await loadDeck(name));
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(...decks.values()),
  );
  danteCapture = captureDanteMaterialDecision({
    adapter,
    dependencies,
    playerDeck: deck(SCENARIO.player),
    opponentDeck: deck(SCENARIO.opponent),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Xyz detach overlay addressing", () => {
  it("proves player Dante host loses one captured material id before classifying detach", () => {
    const beforeIds = danteCapture.before.map(({ instanceId }) => instanceId);
    const afterIds = danteCapture.after.map(({ instanceId }) => instanceId);

    expect(danteCapture.activationPromptId).toBeTruthy();
    expect(danteCapture.player).toBe(0);
    expect(danteCapture.hostInstanceId).toBeTruthy();
    expect(new Set(beforeIds).size).toBe(beforeIds.length);
    expect(afterIds.every((id) => beforeIds.includes(id))).toBe(true);
    expect(beforeIds.filter((id) => !afterIds.includes(id))).toHaveLength(1);
    expect(danteCapture.before.length - danteCapture.after.length).toBe(1);
    expect(danteCapture.detachedCode).not.toBeNull();
    expect(danteCapture.kind).toBe("auto-detach");
    expect(
      danteCapture.materialPromptCaptures.map(({ prompt }) => prompt),
    ).toEqual(danteCapture.materialPrompts);
  });

  it("feeds captured prompt and state through the production material-dialog gate", async () => {
    await assertCapturedMaterialDialogContract(danteCapture);
  });

  it("marks a prompt card as an overlay unit exactly when the engine location carries the OVERLAY bit", () => {
    const run = playScriptedDuel(SCENARIO);

    expect(run.failure?.duelError).toBeUndefined();
    /* The scenario has to reach an Xyz monster holding materials, or the
       detach flow was never exercised and the absence below proves nothing. */
    expect(run.overlaidStates).toBeGreaterThan(0);
    // And it has to have read real prompt cards, so the rule is not vacuous.
    expect(run.promptCardsSeen).toBeGreaterThan(0);
    expect(run.markerMismatches).toEqual([]);
  });
});

async function assertCapturedMaterialDialogContract(
  capture: DanteMaterialDecisionCapture,
): Promise<void> {
  const engineChoiceCapture = capture.materialPromptCaptures.find(
    ({ prompt }) => prompt.choices.some(hasOverlayChoice),
  );

  if (capture.kind === "engine-choice") {
    if (engineChoiceCapture === undefined)
      throw new Error("Engine material choices did not reach capture");
    const harness = renderCapturedPrompt(engineChoiceCapture);
    const offeredIds = engineChoiceCapture.prompt.choices
      .filter(hasOverlayChoice)
      .map(({ id }) => id);
    const responseIds = new Set(engineChoiceCapture.responseChoiceIds);
    const submittedIds = offeredIds.filter((id) => responseIds.has(id));

    expect(engineChoiceCapture.responseChoiceIds).toHaveLength(
      submittedIds.length,
    );
    expect([...harness.spec.overlayChoices.keys()]).toEqual(offeredIds);
    expect(materialDialogTileIds()).toEqual(offeredIds);
    if (document.querySelector('[data-cy="material-select-dialog"]') === null) {
      throw new Error(
        "Engine material choices did not reach MaterialSelectDialog",
      );
    }

    await selectMaterialResponse(engineChoiceCapture, offeredIds, submittedIds);
    expect(harness.commands).toEqual([submittedIds]);
    return;
  }

  expect(engineChoiceCapture).toBeUndefined();
  if (capture.materialPromptCaptures.length === 0) {
    const board = mappedBoard(capture.afterState, null);
    expect(
      mapPromptToInteractionSpec(null, capture.afterState, board, {
        workerGeneration: 1,
        sessionGeneration: 1,
      }).kind,
    ).toBe("inactive");
    render(DuelField, { board });
    assertNoMaterialDialog();
    return;
  }

  for (const promptCapture of capture.materialPromptCaptures) {
    const harness = renderCapturedPrompt(promptCapture);
    expect([...harness.spec.overlayChoices.keys()]).toEqual([]);
    expect(harness.spec.choiceOrder).toEqual(
      promptCapture.prompt.choices.map(({ id }) => id),
    );
    assertNoMaterialDialog();
    cleanup();
  }
}

function renderCapturedPrompt(capture: DanteMaterialPromptCapture): {
  readonly spec: ActiveInteractionSpec;
  readonly commands: readonly (readonly ChoiceId[])[];
} {
  const board = mappedBoard(capture.state, capture.prompt);
  const mapped = mapPromptToInteractionSpec(
    capture.prompt,
    capture.state,
    board,
    { workerGeneration: 1, sessionGeneration: 1 },
  );
  if (mapped.kind === "inactive")
    throw new Error(`Captured ${capture.prompt.kind} prompt mapped inactive`);
  const spec = mapped;
  let session: InteractionSession = createInteractionSession(spec);
  const commands: ChoiceId[][] = [];
  const dispatch = vi.fn(async (action: InteractionSessionAction) => {
    const reduction = reduceInteractionSession(session, spec, action);
    const changed = reduction.session !== session;
    session = reduction.session;
    if (reduction.command !== null)
      commands.push([...reduction.command.choiceIds]);
    await rendered.rerender({ session });
    return reduction.command !== null || changed;
  });
  const rendered = render(DuelField, {
    board,
    prompt: capture.prompt,
    spec,
    session,
    pending: false,
    oninteraction: dispatch,
  });
  return { spec, commands };
}

async function selectMaterialResponse(
  capture: DanteMaterialPromptCapture,
  offeredIds: readonly ChoiceId[],
  submittedIds: readonly ChoiceId[],
): Promise<void> {
  const wanted = new Set(submittedIds);
  const selected = new Set(
    capture.prompt.choices
      .filter(
        ({ id, selected }) => selected === true && offeredIds.includes(id),
      )
      .map(({ id }) => id),
  );
  for (const id of offeredIds) {
    if (selected.has(id) && !wanted.has(id))
      await fireEvent.click(materialTile(id));
  }
  for (const id of submittedIds) {
    if (!selected.has(id)) await fireEvent.click(materialTile(id));
  }
  const confirm = document.querySelector<HTMLButtonElement>(
    '[data-cy="material-select-confirm"]',
  );
  if (confirm === null) throw new Error("Missing material confirm control");
  await fireEvent.click(confirm);
}

function materialDialogTileIds(): readonly string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[data-cy^="material-select-tile-"]',
    ),
  ].map(({ dataset }) =>
    (dataset.cy ?? "").replace("material-select-tile-", ""),
  );
}

function materialTile(id: ChoiceId): HTMLButtonElement {
  const tile = document.querySelector<HTMLButtonElement>(
    `[data-cy="material-select-tile-${id}"]`,
  );
  if (tile === null) throw new Error(`Missing material tile ${id}`);
  return tile;
}

function assertNoMaterialDialog(): void {
  if (document.querySelector('[data-cy="material-select-dialog"]') !== null)
    throw new Error(
      "Material selector rendered without an engine material choice",
    );
}

function mappedBoard(
  state: PublicDuelState,
  prompt: PlayerPrompt | null,
): BoardViewModel {
  const result = mapSnapshotToBoard(state, new Map(), prompt);
  if (!result.ok)
    throw new Error(`Captured state mapping failed: ${result.error.type}`);
  return result.value;
}

function hasOverlayChoice(choice: PlayerPrompt["choices"][number]): boolean {
  return choice.card?.overlay === true;
}

/** One prompt card the engine addressed as an overlay unit. */
interface OverlayAddress {
  readonly promptKind: PlayerPrompt["kind"];
  readonly controller: 0 | 1;
  readonly location: string;
  readonly sequence: number;
  /** Material sequences of every host holding units in the same state. */
  readonly hostMaterialSequences: readonly number[];
}

interface ScriptedRun {
  readonly promptsAnswered: number;
  readonly failure?: DuelOperationError;
  readonly overlayAddresses: readonly OverlayAddress[];
  /** States passed through holding at least one Xyz monster with materials. */
  readonly overlaidStates: number;
  readonly promptCardsSeen: number;
  /** One line per prompt card whose `overlay` disagreed with its raw location. */
  readonly markerMismatches: readonly string[];
}

function playScriptedDuel(scenario: typeof SCENARIO): ScriptedRun {
  const player = deck(scenario.player);
  const opponent = deck(scenario.opponent);
  const profile = selectedDeckPairRulesProfile(
    player,
    opponent,
    dependencies.cards,
  );
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: player,
    opponentDeck: opponent,
    /* Production mode is what the Worker runs: the deck order comes from the
       core's own shuffle, so only this seed replays this duel. */
    configuration: {
      mode: "production",
      rules: profile.rules,
      seed: scenario.seed,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "xyz-detach-overlay-address",
    deckCounts: [player.main.length, opponent.main.length],
    extraDeckCounts: [player.extra.length, opponent.extra.length],
    extraMonsterZones: profile.extraMonsterZones,
  });
  const random = seededRandom(scenario.policySeed);
  const overlayAddresses: OverlayAddress[] = [];
  const markerMismatches: string[] = [];
  let overlaidStates = 0;
  let promptCardsSeen = 0;
  let promptsAnswered = 0;

  try {
    let advance = controller.advance();
    while (advance.result === undefined && promptsAnswered < PROMPT_BUDGET) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      observe(prompt, advance.state);
      advance = answer(controller, prompt, random);
      promptsAnswered += 1;
    }
    return completed();
  } catch (error) {
    if (!(error instanceof DuelOperationError)) throw error;
    return { ...completed(), failure: error };
  } finally {
    controller.dispose();
  }

  function completed(): ScriptedRun {
    return {
      promptsAnswered,
      overlayAddresses: Object.freeze([...overlayAddresses]),
      overlaidStates,
      promptCardsSeen,
      markerMismatches: Object.freeze([...markerMismatches]),
    };
  }

  function observe(prompt: PlayerPrompt, state: PublicDuelState): void {
    const hostMaterialSequences = Object.freeze(
      state.players.flatMap((seat) =>
        seat.monsters.flatMap((monster) =>
          monster.overlayMaterials.map((material) => material.sequence),
        ),
      ),
    );
    if (hostMaterialSequences.length > 0) overlaidStates += 1;

    const cards = [
      ...prompt.choices.flatMap((choice) =>
        choice.card === undefined ? [] : [choice.card],
      ),
      ...(prompt.contextCard === undefined ? [] : [prompt.contextCard]),
    ];
    promptCardsSeen += cards.length;
    for (const card of cards) {
      const raw = rawEngineLocation(card.instanceId);
      const carriesBit = raw !== null && (raw & ENGINE_LOCATION_OVERLAY) !== 0;
      if ((card.overlay === true) !== carriesBit) {
        markerMismatches.push(
          `${card.instanceId}: overlay=${String(card.overlay)} rawLocation=${String(raw)}`,
        );
      }
      if (card.overlay !== true) continue;
      overlayAddresses.push(
        Object.freeze({
          promptKind: prompt.kind,
          controller: card.controller,
          location: card.location as string,
          sequence: card.sequence,
          hostMaterialSequences,
        }),
      );
    }
  }
}

/**
 * `toPromptCard` synthesizes `p{controller}-l{location}-s{sequence}` from the
 * raw engine card, so the pre-mask location survives on the public prompt.
 */
function rawEngineLocation(instanceId: string): number | null {
  const match = /^p[01]-l(\d+)-s\d+$/.exec(instanceId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Answers a prompt the way a player working through a duel does: an arbitrary
 * legal choice, retried against the next candidate when the core refuses the
 * selection. The order is seeded so the scenario replays exactly.
 */
function answer(
  controller: HeadlessDuelController,
  prompt: PlayerPrompt,
  random: () => number,
): ReturnType<HeadlessDuelController["respond"]> {
  let lastRejection: DuelOperationError | undefined;
  for (const choiceIds of candidateResponses(prompt, random)) {
    try {
      return controller.respond(prompt.id, choiceIds);
    } catch (error) {
      if (
        !(error instanceof DuelOperationError) ||
        error.duelError.code !== "invalid_response"
      )
        throw error;
      lastRejection = error;
    }
  }
  throw (
    lastRejection ??
    new Error(`Prompt ${prompt.kind} offered no answerable choices`)
  );
}

function candidateResponses(
  prompt: PlayerPrompt,
  random: () => number,
): readonly ChoiceId[][] {
  const ids = prompt.choices.map(({ id }) => id);
  if (prompt.ordered) return [ids];
  const size = Math.max(prompt.minimum, 1);
  const candidates: ChoiceId[][] = [];
  for (const start of shuffled([...ids.keys()], random)) {
    const window: ChoiceId[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      const value = ids[(start + offset) % ids.length];
      if (value !== undefined) window.push(value);
    }
    if (window.length === size && new Set(window).size === size)
      candidates.push(window);
  }
  if (prompt.cancelable) candidates.push([]);
  return candidates;
}

function shuffled(values: number[], random: () => number): number[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = values[index];
    const right = values[swap];
    if (left !== undefined && right !== undefined) {
      values[index] = right;
      values[swap] = left;
    }
  }
  return values;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedOf(index: number): DuelSeed {
  const value = (offset: number): bigint =>
    (BigInt(index * 4 + offset) * 6364136223846793005n + 1442695040888963407n) &
    0xffffffffffffffffn;
  return [value(1), value(2), value(3), value(4)];
}

async function loadCoreForDomTest(): Promise<OcgCoreAdapter> {
  const bytes = await readFile(
    path.resolve("vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm"),
  );
  return OcgCoreAdapter.initialize({
    wasmBinary: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  });
}

async function loadDeck(name: string): Promise<ParsedDeck> {
  return parseYdk(
    await readFile(
      path.resolve(`src/battle/duel/presets/decks/${name}.ydk`),
      "utf8",
    ),
  );
}

function deck(name: string): ParsedDeck {
  const value = decks.get(name);
  if (value === undefined) throw new Error(`Deck ${name} was not loaded`);
  return value;
}
