import {
  adaptAssetDeckCard,
  mapDeckBuilderCard,
  type AssetDeckCardRecord,
  type DeckBuilderCardView,
  type DeckCatalogRecord,
} from "../../../decks/catalog/ocg-card-mapper.ts";
import {
  OCG_ATTRIBUTE,
  OCG_RACE,
  OCG_TYPE,
} from "../../../decks/catalog/ocg-mask.ts";

interface FixtureInput {
  readonly code: number;
  readonly name: string;
  readonly description: string;
  readonly type: number;
  readonly level?: number;
  readonly attribute?: number;
  readonly race?: bigint;
  readonly attack?: number;
  readonly defense?: number;
  readonly lscale?: number;
  readonly rscale?: number;
  readonly linkMarker?: number;
}

function fixture(input: FixtureInput): DeckCatalogRecord {
  const asset: AssetDeckCardRecord = {
    code: input.code,
    alias: 0,
    setcodes: [],
    type: input.type,
    level: input.level ?? 0,
    attribute: input.attribute ?? 0,
    race: String(input.race ?? 0n),
    attack: input.attack ?? 0,
    defense: input.defense ?? 0,
    lscale: input.lscale ?? 0,
    rscale: input.rscale ?? 0,
    linkMarker: input.linkMarker ?? 0,
    ot: 3,
  };
  return adaptAssetDeckCard(asset, {
    code: input.code,
    name: input.name,
    description: input.description,
    strings: [],
  });
}

const MONSTER = OCG_TYPE.MONSTER | OCG_TYPE.EFFECT;
const NORMAL_MONSTER = OCG_TYPE.MONSTER | OCG_TYPE.NORMAL;

export const PROTOTYPE_CATALOG_RECORDS: readonly DeckCatalogRecord[] =
  Object.freeze([
    fixture({
      code: 10000000,
      name: "Obelisk the Tormentor",
      description: "A Divine-Beast with immense power.",
      type: MONSTER,
      level: 10,
      attribute: OCG_ATTRIBUTE.DIVINE,
      race: OCG_RACE.DIVINE_BEAST,
      attack: 4000,
      defense: 4000,
    }),
    fixture({
      code: 89631139,
      name: "Blue-Eyes White Dragon",
      description: "This legendary dragon is a powerful engine of destruction.",
      type: NORMAL_MONSTER,
      level: 8,
      attribute: OCG_ATTRIBUTE.LIGHT,
      race: OCG_RACE.DRAGON,
      attack: 3000,
      defense: 2500,
    }),
    fixture({
      code: 46986414,
      name: "Dark Magician",
      description: "The ultimate wizard in terms of attack and defense.",
      type: NORMAL_MONSTER,
      level: 7,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.SPELLCASTER,
      attack: 2500,
      defense: 2100,
    }),
    fixture({
      code: 74677422,
      name: "Red-Eyes Black Dragon",
      description: "A ferocious dragon with a deadly attack.",
      type: NORMAL_MONSTER,
      level: 7,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.DRAGON,
      attack: 2400,
      defense: 2000,
    }),
    fixture({
      code: 97590747,
      name: "La Jinn the Mystical Genie of the Lamp",
      description:
        "A genie with powerful dark magic and a very long display name for layout testing.",
      type: NORMAL_MONSTER,
      level: 4,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.FIEND,
      attack: 1800,
      defense: 1000,
    }),
    fixture({
      code: 91152256,
      name: "Mystical Elf",
      description:
        "A delicate elf that lacks offense, but has a terrific defense backed by mystical power.",
      type: NORMAL_MONSTER,
      level: 4,
      attribute: OCG_ATTRIBUTE.LIGHT,
      race: OCG_RACE.SPELLCASTER,
      attack: 800,
      defense: 2000,
    }),
    fixture({
      code: 15025844,
      name: "Kuriboh",
      description:
        "During damage calculation, discard this card to prevent battle damage.",
      type: MONSTER,
      level: 1,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.FIEND,
      attack: 300,
      defense: 200,
    }),
    fixture({
      code: 83764718,
      name: "Cyber Dragon",
      description:
        "If only your opponent controls a monster, you can Special Summon this card.",
      type: MONSTER,
      level: 5,
      attribute: OCG_ATTRIBUTE.LIGHT,
      race: OCG_RACE.MACHINE,
      attack: 2100,
      defense: 1600,
    }),
    fixture({
      code: 9742784,
      name: "Jet Synchron",
      description:
        "A Tuner that can return from the Graveyard for a Synchro Summon.",
      type: MONSTER | OCG_TYPE.TUNER,
      level: 1,
      attribute: OCG_ATTRIBUTE.FIRE,
      race: OCG_RACE.MACHINE,
      attack: 500,
      defense: 0,
    }),
    fixture({
      code: 3048768,
      name: "Angello Vaalmonica",
      description:
        "Pendulum Effect: gains Resonance Counters. Monster Effect: applies a Vaalmonica effect. This intentionally long text verifies the pinned details panel rather than dense catalog text.",
      type: MONSTER | OCG_TYPE.PENDULUM,
      level: 4,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.FAIRY,
      attack: 1200,
      defense: 2100,
      lscale: 3,
      rscale: 3,
    }),
    fixture({
      code: 24175232,
      name: "Cerulean Sacred Phoenix of Nephthys",
      description:
        "A Ritual Monster that destroys Nephthys cards to answer opposing monsters.",
      type: MONSTER | OCG_TYPE.RITUAL,
      level: 8,
      attribute: OCG_ATTRIBUTE.FIRE,
      race: OCG_RACE.WINGED_BEAST,
      attack: 3000,
      defense: 1000,
    }),
    fixture({
      code: 8505920,
      name: "Gate Guardians Combined",
      description:
        "A three-material Fusion Monster with repeated targeting negation.",
      type: MONSTER | OCG_TYPE.FUSION,
      level: 12,
      attribute: OCG_ATTRIBUTE.DARK,
      race: OCG_RACE.WARRIOR,
      attack: 3750,
      defense: 3400,
    }),
    fixture({
      code: 6766208,
      name: "D/D/D Gust High King Alexander",
      description: "A Synchro Monster that revives another D/D monster.",
      type: MONSTER | OCG_TYPE.SYNCHRO,
      level: 10,
      attribute: OCG_ATTRIBUTE.WIND,
      race: OCG_RACE.FIEND,
      attack: 3000,
      defense: 2500,
    }),
    fixture({
      code: 8809344,
      name: "Outer Entity Nyarla",
      description: "An Xyz Monster that changes Rank, Type, and Attribute.",
      type: MONSTER | OCG_TYPE.XYZ,
      level: 4,
      attribute: OCG_ATTRIBUTE.EARTH,
      race: OCG_RACE.FIEND,
      attack: 0,
      defense: 2600,
    }),
    fixture({
      code: 1322368,
      name: "SPYRAL Double Helix",
      description: "A Link Monster that reveals the opponent's top card.",
      type: MONSTER | OCG_TYPE.LINK,
      level: 2,
      attribute: OCG_ATTRIBUTE.EARTH,
      race: OCG_RACE.WARRIOR,
      attack: 1900,
      defense: 0,
      linkMarker: 10,
    }),
    fixture({
      code: 12580477,
      name: "Raigeki",
      description: "Destroy all monsters your opponent controls.",
      type: OCG_TYPE.SPELL,
    }),
    fixture({
      code: 53129443,
      name: "Dark Hole",
      description: "Destroy all monsters on the field.",
      type: OCG_TYPE.SPELL,
    }),
    fixture({
      code: 22082432,
      name: "Dangers of the Divine",
      description: "A Quick-Play Spell with a delayed return effect.",
      type: OCG_TYPE.SPELL | OCG_TYPE.QUICKPLAY,
    }),
    fixture({
      code: 6186304,
      name: "D - Force",
      description: "A Continuous Spell supporting Destiny HERO - Plasma.",
      type: OCG_TYPE.SPELL | OCG_TYPE.CONTINUOUS,
    }),
    fixture({
      code: 37120512,
      name: "Sword of Dark Destruction",
      description: "Equip only to a DARK monster.",
      type: OCG_TYPE.SPELL | OCG_TYPE.EQUIP,
    }),
    fixture({
      code: 4064256,
      name: "Zombie World",
      description:
        "All monsters on the field and in the GYs become Zombie monsters.",
      type: OCG_TYPE.SPELL | OCG_TYPE.FIELD,
    }),
    fixture({
      code: 44095762,
      name: "Mirror Force",
      description:
        "When an opponent's monster declares an attack, destroy their Attack Position monsters.",
      type: OCG_TYPE.TRAP,
    }),
    fixture({
      code: 97077563,
      name: "Call of the Haunted",
      description:
        "A Continuous Trap that Special Summons a monster from your GY.",
      type: OCG_TYPE.TRAP | OCG_TYPE.CONTINUOUS,
    }),
    fixture({
      code: 1637760,
      name: "Grand Horn of Heaven",
      description: "A Counter Trap that negates a Special Summon.",
      type: OCG_TYPE.TRAP | OCG_TYPE.COUNTER,
    }),
  ]);

export const PROTOTYPE_CATALOG: readonly DeckBuilderCardView[] = Object.freeze(
  PROTOTYPE_CATALOG_RECORDS.map(mapDeckBuilderCard),
);
