import type {
  OcgAttribute,
  OcgRace,
  OcgType,
} from "../../../vendor/ocgcore-wasm/0.1.2/dist/index.js";

export const OCG_TYPE = {
  MONSTER: 1,
  SPELL: 2,
  TRAP: 4,
  NORMAL: 16,
  EFFECT: 32,
  FUSION: 64,
  RITUAL: 128,
  TRAPMONSTER: 256,
  SPIRIT: 512,
  UNION: 1024,
  GEMINI: 2048,
  TUNER: 4096,
  SYNCHRO: 8192,
  TOKEN: 16384,
  QUICKPLAY: 65536,
  CONTINUOUS: 131072,
  EQUIP: 262144,
  FIELD: 524288,
  COUNTER: 1048576,
  FLIP: 2097152,
  TOON: 4194304,
  XYZ: 8388608,
  PENDULUM: 16777216,
  SPSUMMON: 33554432,
  LINK: 67108864,
} as const satisfies Record<string, OcgType>;

export const OCG_ATTRIBUTE = {
  EARTH: 1,
  WATER: 2,
  FIRE: 4,
  WIND: 8,
  LIGHT: 16,
  DARK: 32,
  DIVINE: 64,
} as const satisfies Record<string, OcgAttribute>;

export const OCG_RACE = {
  WARRIOR: 1n,
  SPELLCASTER: 2n,
  FAIRY: 4n,
  FIEND: 8n,
  ZOMBIE: 16n,
  MACHINE: 32n,
  AQUA: 64n,
  PYRO: 128n,
  ROCK: 256n,
  WINGED_BEAST: 512n,
  PLANT: 1024n,
  INSECT: 2048n,
  THUNDER: 4096n,
  DRAGON: 8192n,
  BEAST: 16384n,
  BEAST_WARRIOR: 32768n,
  DINOSAUR: 65536n,
  FISH: 131072n,
  SEA_SERPENT: 262144n,
  REPTILE: 524288n,
  PSYCHIC: 1048576n,
  DIVINE_BEAST: 2097152n,
  CREATOR_GOD: 4194304n,
  WYRM: 8388608n,
  CYBERSE: 16777216n,
  ILLUSION: 33554432n,
} as const satisfies Record<string, OcgRace>;

export function hasOcgType(type: number, mask: number): boolean {
  return (type & mask) !== 0;
}
