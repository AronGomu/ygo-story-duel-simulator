import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import {
  createMvpPreset,
  type MvpPreset,
} from "../../src/battle/duel/presets/mvp-preset.ts";
import type { EngineMasterRule } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { selectedDeckPairRulesProfile } from "../../src/battle/duel/presets/duel-rules-profile.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import {
  DuelSession,
  type CoreStartupScript,
} from "../../src/battle/worker/engine/DuelSession.ts";
import { EngineMessageType } from "../../src/battle/worker/engine/engine-constants.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";

/**
 * The Link-free profile removes the shared Extra Monster Zones from the engine
 * itself, not only from the rendered board: under Master Rule 3 an Extra Deck
 * summon may never reach monster sequence 5 or 6. This fixture is the contract
 * that lets the field omit those zones without stranding a legal choice.
 */
const EXTRA_DECK_SUMMON_SCRIPT: CoreStartupScript = Object.freeze({
  name: "mr_extra_deck_placement.lua",
  source: `local mr_extra_deck_placement = Effect.GlobalEffect()
mr_extra_deck_placement:SetType(EFFECT_TYPE_FIELD + EFFECT_TYPE_CONTINUOUS)
mr_extra_deck_placement:SetCode(EVENT_STARTUP)
mr_extra_deck_placement:SetOperation(function()
  local extra = Duel.GetFieldGroup(0, LOCATION_EXTRA, 0)
  local card = extra:GetFirst()
  Duel.SpecialSummon(card, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
end)
Duel.RegisterEffect(mr_extra_deck_placement, 0)`,
});

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: MvpPreset;
const sessions: DuelSession[] = [];

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  // Extra-deck placement requires this historical Fusion fixture, not an active preset.
  const source = await readFile(
    new URL(
      "../../src/battle/duel/presets/decks/shaddoll.ydk",
      import.meta.url,
    ),
    "utf8",
  );
  preset = createMvpPreset(source, source);
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(preset.player, preset.opponent),
  );
});

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
});

interface Place {
  readonly player: 0 | 1;
  readonly location: "monster" | "spellTrap";
  readonly sequence: number;
}

function extraDeckPlacementChoices(rules: EngineMasterRule): readonly Place[] {
  const session = DuelSession.create({
    adapter,
    dependencies,
    playerDeck: preset.player,
    opponentDeck: preset.opponent,
    configuration: {
      mode: "programmed",
      rules,
      seed: [1n, 2n, 3n, 4n],
      playerDeckOrder: preset.player.main,
      opponentDeckOrder: preset.opponent.main,
      startupScripts: [EXTRA_DECK_SUMMON_SCRIPT],
    },
  });
  sessions.push(session);
  const boundary = session.processUntilBoundary();
  const selectPlace = boundary.messages.find(
    (message) => message.type === EngineMessageType.SELECT_PLACE,
  );
  if (selectPlace === undefined)
    throw new Error(`Core never asked where to place under ${rules}`);
  return decodePlaces(
    (selectPlace as { readonly field_mask: number }).field_mask,
    (selectPlace as { readonly player: number }).player === 0 ? 0 : 1,
  );
}

/* Mirror of the worker's own decoding: a clear bit is a legal place. */
function decodePlaces(mask: number, selectingPlayer: 0 | 1): readonly Place[] {
  const other: 0 | 1 = selectingPlayer === 0 ? 1 : 0;
  const groups: readonly (readonly [number, 0 | 1, "monster" | "spellTrap"])[] =
    [
      [0, selectingPlayer, "monster"],
      [8, selectingPlayer, "spellTrap"],
      [16, other, "monster"],
      [24, other, "spellTrap"],
    ];
  const places: Place[] = [];
  for (const [offset, player, location] of groups) {
    for (let sequence = 0; sequence < 8; sequence += 1) {
      if ((mask & (1 << (offset + sequence))) === 0)
        places.push({ player, location, sequence });
    }
  }
  return places;
}

describe("pinned core placement under each master rule", () => {
  it("selects the Link-free profile for the bundled pair", () => {
    expect(
      selectedDeckPairRulesProfile(
        preset.player,
        preset.opponent,
        dependencies.cards,
      ),
    ).toEqual({ rules: "mr3", extraMonsterZones: false });
  });

  it("never offers a shared Extra Monster Zone under MR3", () => {
    const places = extraDeckPlacementChoices("mr3");
    const monsterSequences = places
      .filter((place) => place.location === "monster")
      .map((place) => place.sequence);

    expect(monsterSequences.length).toBeGreaterThan(0);
    expect(monsterSequences).not.toContain(5);
    expect(monsterSequences).not.toContain(6);
  });

  it("still exposes a shared Extra Monster Zone under MR5", () => {
    const places = extraDeckPlacementChoices("mr5");
    const monsterSequences = places
      .filter((place) => place.location === "monster")
      .map((place) => place.sequence);

    expect(
      monsterSequences.some((sequence) => sequence === 5 || sequence === 6),
    ).toBe(true);
  });
});
