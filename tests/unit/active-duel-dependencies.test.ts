import { describe, expect, it } from "vitest";
import { cardCode } from "../../src/duel/contracts/ids.ts";
import {
  loadActiveDuelDependencies,
  normalizeRequestedScriptName,
  type ActiveDuelAssetReader,
} from "../../src/worker/assets/active-duel-dependencies.ts";

describe("active duel dependency resolver", () => {
  it("normalizes only supported pinned script names", () => {
    expect(normalizeRequestedScriptName("./official/c83764718.lua")).toBe(
      "c83764718.lua",
    );
    expect(normalizeRequestedScriptName("script\\utility.lua")).toBe(
      "utility.lua",
    );
    expect(() => normalizeRequestedScriptName("../../arbitrary.js")).toThrow(
      /Unsupported/,
    );
  });

  it("resolves aliases, scripts, and artifact groups deterministically", async () => {
    const progress: string[] = [];
    const first = await loadActiveDuelDependencies(
      fixtureReader(),
      new Set([cardCode(1)]),
      (group) => progress.push(group),
    );
    const second = await loadActiveDuelDependencies(
      fixtureReader(),
      new Set([cardCode(1)]),
    );

    expect([...first.cards.keys()]).toEqual([1, 2]);
    expect([...first.texts.keys()].sort()).toEqual([1, 2]);
    expect([...first.images.keys()].sort()).toEqual([1, 2]);
    expect([...first.scripts.keys()].sort()).toEqual([
      "c1.lua",
      "c2.lua",
      "constant.lua",
      "utility.lua",
    ]);
    expect(progress.sort()).toEqual(
      [
        "catalog",
        "texts",
        "images",
        "scriptIndex",
        "globalScripts",
        "cardScripts",
        "strings",
      ].sort(),
    );
    expect(serializeDependencies(second)).toEqual(serializeDependencies(first));
  });

  it.each([
    ["catalog/texts/en/02.json", "Missing active card text: 2"],
    ["images/02.json", "Missing active card image record: 2"],
    ["scripts/cards/02.json", "Indexed active card script is missing: c2.lua"],
  ])(
    "fails before duel creation when %s is incomplete",
    async (path, message) => {
      const overrides = new Map<string, unknown>([
        [path, path.startsWith("scripts/") ? {} : []],
      ]);
      await expect(
        loadActiveDuelDependencies(
          fixtureReader(overrides),
          new Set([cardCode(1)]),
        ),
      ).rejects.toThrow(message);
    },
  );
});

function fixtureReader(
  overrides: ReadonlyMap<string, unknown> = new Map(),
): ActiveDuelAssetReader {
  const values = new Map<string, unknown>([
    ["catalog/cards/01.json", [cardRecord(1, 2)]],
    ["catalog/cards/02.json", [cardRecord(2, 0)]],
    ["catalog/texts/en/01.json", [textRecord(1)]],
    ["catalog/texts/en/02.json", [textRecord(2)]],
    ["images/01.json", [imageRecord(1)]],
    ["images/02.json", [imageRecord(2)]],
    [
      "scripts/index.json",
      {
        official: ["c1.lua", "c2.lua"],
        preRelease: [],
        globals: ["constant.lua", "utility.lua"],
        shardCount: 256,
      },
    ],
    [
      "scripts/globals.json",
      { "constant.lua": "return", "utility.lua": "return" },
    ],
    ["scripts/cards/01.json", { "c1.lua": "return" }],
    ["scripts/cards/02.json", { "c2.lua": "return" }],
    ["strings/en.json", { system: {}, victory: {}, counter: {}, setname: {} }],
    ...overrides,
  ]);
  return {
    async readJson<T>(relativePath: string): Promise<T> {
      if (!values.has(relativePath))
        throw new Error(`Missing fixture artifact: ${relativePath}`);
      return structuredClone(values.get(relativePath)) as T;
    },
  };
}

function cardRecord(code: number, alias: number) {
  return {
    code,
    alias,
    setcodes: [],
    type: 17,
    level: 4,
    attribute: 1,
    race: "1",
    attack: 1000,
    defense: 1000,
    lscale: 0,
    rscale: 0,
    linkMarker: 0,
  };
}

function textRecord(code: number) {
  return { code, name: `Card ${code}`, description: "Fixture", strings: [] };
}

function imageRecord(code: number) {
  return { code, full: `${code}.jpg`, cropped: `${code}-cropped.jpg` };
}

function serializeDependencies(
  value: Awaited<ReturnType<typeof loadActiveDuelDependencies>>,
) {
  return {
    cards: [...value.cards],
    texts: [...value.texts],
    scripts: [...value.scripts],
    strings: value.strings,
    images: [...value.images],
    counts: value.counts,
  };
}
