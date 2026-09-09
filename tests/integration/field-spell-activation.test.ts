import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CardCode,
  ChoiceId,
} from "../../src/battle/duel/contracts/ids.ts";
import { cardCode, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import {
  parseYdk,
  uniqueDeckCodes,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";
import { mapSnapshotToBoard } from "../../src/battle/field/board-view-model.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { DuelSession } from "../../src/battle/worker/engine/DuelSession.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import { HeadlessDuelController } from "../../src/battle/worker/HeadlessDuelController.ts";

/** "The Grand Spellbook Tower", the field spell the reported bug activated. */
const GRAND_SPELLBOOK_TOWER = cardCode(33981008);

/* Observed raw address once the activation resolves, straight from the
   vendored core: controller 0, location "spellTrap", sequence 5 — the Field
   Zone is the sixth Spell & Trap slot, never a separate "field" 0 address.
   The activation itself raises no selectPlace prompt, so nothing here
   depends on the prompt place decoder. */

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let spellbook: ParsedDeck;
let opponent: ParsedDeck;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  spellbook = parseYdk(
    await readFile(
      fileURLToPath(
        new URL(
          "../../src/battle/duel/presets/decks/spellbook.ydk",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  opponent = (await loadMvpPreset()).opponent;
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(spellbook, opponent),
  );
});

describe("field spell activation", () => {
  it("activating a field spell keeps the projected board mappable", () => {
    const run = playUntilFieldSpellResolves();

    expect(run.activated).toBe(true);
    expect(run.mappingFailures).toEqual([]);
    expect(run.fieldZoneCodes).toContain(GRAND_SPELLBOOK_TOWER);
  });
});

interface FieldSpellRun {
  readonly activated: boolean;
  /**
   * Every board-mapping error seen after the activation, carrying the raw
   * engine address so a regression names the address it could not place.
   */
  readonly mappingFailures: readonly unknown[];
  readonly fieldZoneCodes: readonly (CardCode | undefined)[];
}

function playUntilFieldSpellResolves(): FieldSpellRun {
  const deckOrder = rotateToFront(spellbook.main, GRAND_SPELLBOOK_TOWER);
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: spellbook,
    opponentDeck: opponent,
    configuration: {
      mode: "programmed",
      rules: "mr5",
      seed: [17n, 23n, 29n, 31n],
      playerDeckOrder: deckOrder,
      opponentDeckOrder: opponent.main,
    },
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies,
    snapshotId: snapshotId("f".repeat(64)),
    presetId: "field-spell-activation",
    deckCounts: [spellbook.main.length, opponent.main.length],
    extraDeckCounts: [spellbook.extra.length, opponent.extra.length],
    extraMonsterZones: true,
    maximumAutomaticResponses: 5_000,
  });
  const mappingFailures: unknown[] = [];
  const fieldZoneCodes: (CardCode | undefined)[] = [];
  let activated = false;

  try {
    let advance = controller.advance();
    observe(advance.state);
    for (let step = 0; step < 40 && advance.result === undefined; step += 1) {
      const prompt = advance.prompt;
      if (prompt === undefined)
        throw new Error("Duel stopped without a prompt or a result");
      const activation = activationChoice(prompt);
      const choiceIds =
        activation === undefined ? firstValidChoice(prompt) : [activation];
      advance = controller.respond(prompt.id, choiceIds);
      if (activation !== undefined) activated = true;
      observe(advance.state);
      /* One board mapping after the field spell has left the chain is all
         the repro needs; anything later only adds unrelated duel noise. */
      if (activated && fieldZoneCodes.length > 0) break;
    }
    return {
      activated,
      mappingFailures: Object.freeze([...mappingFailures]),
      fieldZoneCodes: Object.freeze([...fieldZoneCodes]),
    };
  } finally {
    controller.dispose();
  }

  function observe(state: PublicDuelState): void {
    const result = mapSnapshotToBoard(state, cardTextsFor(dependencies));
    if (!result.ok) {
      if (activated) mappingFailures.push(result.error);
      return;
    }
    for (const card of result.value.cards)
      if (card.zoneId === "p0:field") fieldZoneCodes.push(card.code);
  }
}

function activationChoice(prompt: PlayerPrompt): ChoiceId | undefined {
  return prompt.choices.find(
    (choice) =>
      choice.action === "activate" &&
      choice.card?.code === GRAND_SPELLBOOK_TOWER,
  )?.id;
}

function firstValidChoice(prompt: PlayerPrompt): readonly ChoiceId[] {
  const wanted = prompt.ordered
    ? prompt.choices.length
    : Math.max(prompt.minimum, 1);
  const choiceIds = prompt.choices.slice(0, wanted).map(({ id }) => id);
  if (choiceIds.length === 0)
    throw new Error(`Prompt ${prompt.kind} offered no choices`);
  return choiceIds;
}

function cardTextsFor(
  value: ActiveDuelDependencies,
): ReadonlyMap<number, { readonly name: string }> {
  return new Map(
    [...value.texts].map(([code, text]) => [code, { name: text.name }]),
  );
}

function rotateToFront(
  main: readonly CardCode[],
  first: CardCode,
): readonly CardCode[] {
  const rest = [...main];
  const index = rest.indexOf(first);
  if (index < 0) throw new Error(`Deck does not contain card ${first}`);
  return Object.freeze([...rest.splice(index, 1), ...rest]);
}
