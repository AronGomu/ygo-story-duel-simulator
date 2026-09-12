import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeChapterSource,
  type ChapterSourceCorrections,
  type ChapterSourceSet,
} from "../../scripts/lib/chapter-source-policy.ts";

const rawSourceSha256 =
  "b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d";
const excludedSet =
  "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition";
const promoSet = "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny promotional cards";
const prizeSet = "Yu-Gi-Oh! World Championship 2004 prize cards";

async function realInputs() {
  const sourceBytes = await readFile("content/authoring/card-set-source.json");
  const source = JSON.parse(sourceBytes.toString("utf8")) as {
    sets: ChapterSourceSet[];
  };
  const selections = JSON.parse(
    await readFile("content/chapter-selections.json", "utf8"),
  ) as { chapters: { setNames: string[] }[] };
  const corrections = JSON.parse(
    await readFile("content/authoring/chapter-one-corrections.json", "utf8"),
  ) as ChapterSourceCorrections;
  const selectedNames = new Set(selections.chapters[0]!.setNames);
  return {
    sourceBytes,
    selectedSets: source.sets.filter(({ name }) => selectedNames.has(name)),
    corrections,
  };
}

const printingKey = (
  setName: string,
  code: number,
  printing: { code: string; rarity: string; rarityCode: string },
) =>
  JSON.stringify([
    setName,
    code,
    printing.code,
    printing.rarity,
    printing.rarityCode,
  ]);

describe("Chapter 1 source normalization", () => {
  it("retains every included printing in the exact approved 75-set, 1627-code pool", async () => {
    const { sourceBytes, selectedSets, corrections } = await realInputs();
    const normalized = normalizeChapterSource(selectedSets, corrections);

    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(
      rawSourceSha256,
    );
    expect(normalized.sets).toHaveLength(75);
    expect(normalized.cardCodes).toHaveLength(1627);
    expect(normalized.cardCodes).toContain(81480460);
    expect(normalized.cardCodes).not.toContain(81480461);
    expect(normalized.cardCodes).not.toContain(501000000);
    expect(normalized.cardCodes).not.toContain(501000001);
    expect(normalized.sets.map(({ name }) => name)).not.toContain(excludedSet);
    expect(normalized.sets.map(({ name }) => name)).toContain(promoSet);
    expect(normalized.sets.map(({ name }) => name)).toContain(prizeSet);
    expect(
      normalized.sets.find(({ name }) => name === prizeSet)?.cards,
    ).toHaveLength(1);

    const excludedCodes = new Set(corrections.excludedCardCodes);
    const aliases = new Map(
      corrections.aliases.map(({ sourceCode, runtimeCode }) => [
        sourceCode,
        runtimeCode,
      ]),
    );
    const expectedPrintings = selectedSets
      .filter(({ name }) => !corrections.excludedSetNames.includes(name))
      .flatMap((set) =>
        set.cards
          .filter(({ id }) => !excludedCodes.has(id))
          .flatMap((card) =>
            card.printings.map((printing) =>
              printingKey(set.name, aliases.get(card.id) ?? card.id, printing),
            ),
          ),
      );
    const retainedPrintings = normalized.sets.flatMap((set) =>
      set.cards.flatMap((card) =>
        card.printings.map((printing) =>
          printingKey(set.name, card.id, printing),
        ),
      ),
    );
    expect(new Set(retainedPrintings)).toEqual(new Set(expectedPrintings));
  });

  it("merges same-runtime cards only within one set and deduplicates printing tuples", () => {
    const sourcePrinting = {
      code: "ONE-001",
      rarity: "Rare",
      rarityCode: "(R)",
    };
    const normalized = normalizeChapterSource(
      [
        {
          name: "One",
          code: "ONE",
          tcgReleaseDate: "2002-01-01",
          cards: [
            {
              id: 81480461,
              name: "Barrel Dragon",
              printings: [sourcePrinting],
            },
            {
              id: 81480460,
              name: "Barrel Dragon",
              printings: [
                sourcePrinting,
                { code: "ONE-002", rarity: "Common", rarityCode: "(C)" },
              ],
            },
          ],
        },
        {
          name: "Two",
          code: "TWO",
          tcgReleaseDate: "2002-01-02",
          cards: [
            {
              id: 81480461,
              name: "Barrel Dragon",
              printings: [
                { code: "TWO-001", rarity: "Rare", rarityCode: "(R)" },
              ],
            },
          ],
        },
        {
          name: excludedSet,
          code: "PCY",
          tcgReleaseDate: "2003-11-18",
          cards: [],
        },
      ],
      {
        schemaVersion: 1,
        aliases: [{ sourceCode: 81480461, runtimeCode: 81480460 }],
        excludedCardCodes: [501000000, 501000001],
        excludedSetNames: [excludedSet],
      },
    );

    expect(normalized.cardCodes).toEqual([81480460]);
    expect(normalized.sets).toHaveLength(2);
    expect(normalized.sets[0]!.cards).toEqual([
      {
        id: 81480460,
        name: "Barrel Dragon",
        printings: [
          { code: "ONE-001", rarity: "Rare", rarityCode: "(R)" },
          { code: "ONE-002", rarity: "Common", rarityCode: "(C)" },
        ],
      },
    ]);
    expect(normalized.sets[1]!.cards[0]!.printings).toEqual([
      { code: "TWO-001", rarity: "Rare", rarityCode: "(R)" },
    ]);
  });

  it.each([
    [
      "extra alias",
      (value: Record<string, unknown>) => ({
        ...value,
        aliases: [
          ...(value.aliases as unknown[]),
          { sourceCode: 1, runtimeCode: 2 },
        ],
      }),
    ],
    [
      "duplicate conflicting alias",
      (value: Record<string, unknown>) => ({
        ...value,
        aliases: [
          ...(value.aliases as unknown[]),
          { sourceCode: 81480461, runtimeCode: 3 },
        ],
      }),
    ],
    [
      "malformed code",
      (value: Record<string, unknown>) => ({
        ...value,
        excludedCardCodes: [0, 501000001],
      }),
    ],
    [
      "unknown key",
      (value: Record<string, unknown>) => ({
        ...value,
        inferAliases: true,
      }),
    ],
  ])("rejects unapproved correction: %s", async (_name, mutate) => {
    const { selectedSets, corrections } = await realInputs();
    expect(() =>
      normalizeChapterSource(
        selectedSets,
        mutate(
          structuredClone(corrections) as unknown as Record<string, unknown>,
        ) as unknown as ChapterSourceCorrections,
      ),
    ).toThrowError("CONTENT_SOURCE_POLICY_INVALID");
  });
});
