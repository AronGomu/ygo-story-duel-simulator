import { describe, expect, it } from "vitest";
import { prepareAdvancedDeckCatalogIndex } from "../../../src/decks/catalog/deck-catalog-advanced.ts";
import {
  buildDeckCatalogIndex,
  filterDeckCatalogIndex,
} from "../../../src/decks/catalog/deck-catalog-index.ts";
import {
  catalogTypeOptions,
  filterDeckCatalog,
  EMPTY_DECK_CATALOG_QUERY,
} from "../../../src/decks/catalog/deck-catalog.ts";
import {
  loadRuntimeCatalog,
  CATALOG_SHARD_COUNT,
  catalogShardName,
} from "../../../src/decks/catalog/runtime-catalog.ts";
import type { CatalogShardReader } from "../../../src/decks/catalog/runtime-catalog.ts";
import type {
  AssetDeckCardRecord,
  DeckBuilderCardView,
} from "../../../src/decks/catalog/ocg-card-mapper.ts";
import type { PackagedCardText } from "../../../src/decks/catalog/packaged-catalog.ts";
import {
  highEntropyCatalog,
  syntheticCatalog,
} from "../../fixtures/synthetic-catalog.ts";

const SORT_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });
const sortFixture = (cards: readonly DeckBuilderCardView[]) =>
  Object.freeze(
    [...cards].sort(
      (left, right) =>
        SORT_COLLATOR.compare(left.name, right.name) || left.code - right.code,
    ),
  );
const CARDS_15K = sortFixture(syntheticCatalog(15_000));
const HIGH_ENTROPY_CARDS_15K = sortFixture(highEntropyCatalog(15_000));
const AVAILABLE = () => true;

/* Every budget below is best-of-N wall time rather than one cold run. Package
   test routing runs this file after parallel unit workers finish, so this clock
   measures production work instead of scheduler pauses from unrelated tests. */
function bestOf(runs: number, work: () => unknown): number {
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    work();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/** Build an in-memory CatalogShardReader from 15k synthetic view cards. */
function makeInMemoryReader(count: number): CatalogShardReader {
  // produce raw records bucketed by code % 64
  const cardShards = new Map<string, AssetDeckCardRecord[]>();
  const textShards = new Map<string, PackagedCardText[]>();

  for (let i = 0; i < CATALOG_SHARD_COUNT; i++) {
    const key = catalogShardName(i);
    cardShards.set(`assets/current/catalog/cards/${key}.json`, []);
    textShards.set(`assets/current/catalog/texts/en/${key}.json`, []);
  }

  for (let i = 0; i < count; i++) {
    const code = 10_000_000 + i;
    const bucket = catalogShardName(code % CATALOG_SHARD_COUNT);
    const cardRecord: AssetDeckCardRecord = {
      code,
      alias: 0,
      setcodes: [],
      // spell type: 0x2 = TYPE_SPELL
      type: 0x2,
      level: 0,
      attribute: 0,
      race: "",
      attack: 0,
      defense: 0,
      lscale: 0,
      rscale: 0,
      linkMarker: 0,
      ot: 1,
    };
    const textRecord: PackagedCardText = {
      code,
      name: `Synthetic Card ${i}`,
      description: "",
    };
    cardShards
      .get(`assets/current/catalog/cards/${bucket}.json`)!
      .push(cardRecord);
    textShards
      .get(`assets/current/catalog/texts/en/${bucket}.json`)!
      .push(textRecord);
  }

  return {
    async readJson<T>(relativePath: string): Promise<T> {
      const result =
        cardShards.get(relativePath) ?? textShards.get(relativePath) ?? [];
      return result as T;
    },
  };
}

describe("catalog performance budgets", () => {
  /* Runtime loading establishes exact Name A–Z order once. Fresh indexes then
     verify that production invariant while building lower-name search data. */
  it("building fresh indexes stays under budget (best of 20 runs)", () => {
    const inputs = Array.from({ length: 20 }, () =>
      CARDS_15K.map((card) => ({ ...card })),
    );
    const indexes: unknown[] = [];
    let run = 0;
    const best = bestOf(20, () => {
      const index = buildDeckCatalogIndex(inputs[run++]!);
      const prepared = prepareAdvancedDeckCatalogIndex(index);
      indexes.push(index);
      if (
        index.lowerNames.length !== 15_000 ||
        prepared.order.length !== 15_000
      )
        throw new Error("empty workload");
    });
    expect(new Set(indexes).size).toBe(20);
    expect(best).toBeLessThan(2.5);
  });

  /* High-entropy names mirror production's broad sort workload: more than
     5,000 distinct six-character prefixes across 15,000 cards. */
  it("builds a sorted high-entropy production-shaped index under budget", () => {
    expect(
      new Set(
        HIGH_ENTROPY_CARDS_15K.map(({ name }) =>
          name.toLowerCase().slice(0, 6),
        ),
      ).size,
    ).toBeGreaterThan(5_000);
    const inputs = Array.from({ length: 20 }, () =>
      HIGH_ENTROPY_CARDS_15K.map((card) => ({ ...card })),
    );
    let run = 0;
    const best = bestOf(20, () => {
      const index = buildDeckCatalogIndex(inputs[run++]!);
      const prepared = prepareAdvancedDeckCatalogIndex(index);
      if (prepared.order.length !== 15_000) throw new Error("empty workload");
    });
    expect(best).toBeLessThan(2.5);
  });

  it("a name search stays under budget (best of 20 runs)", () => {
    const index = buildDeckCatalogIndex(CARDS_15K);
    prepareAdvancedDeckCatalogIndex(index);
    const filters = { ...EMPTY_DECK_CATALOG_QUERY, name: "dragon" };
    expect(filterDeckCatalogIndex(index, filters, AVAILABLE)).toHaveLength(
      1_875,
    );

    const best = bestOf(20, () =>
      filterDeckCatalogIndex(index, filters, AVAILABLE),
    );
    // measured: 0.31-0.33ms best-of-20 at n=15,000; budget rejects a 4x regression
    expect(best).toBeLessThan(1.5);
  });

  /* The index earns its keep by lower-casing every name once and preserving
     precomputed result order instead of repeating both per keystroke. The ratio
     remains useful across machines; `catalog-index-wiring.test.ts` proves the
     component uses this path. */
  it("the indexed search beats the unindexed reference implementation", () => {
    const index = buildDeckCatalogIndex(CARDS_15K);
    prepareAdvancedDeckCatalogIndex(index);
    const filters = { ...EMPTY_DECK_CATALOG_QUERY, name: "dragon" };
    const indexed = bestOf(20, () =>
      filterDeckCatalogIndex(index, filters, AVAILABLE),
    );
    const unindexed = bestOf(20, () =>
      filterDeckCatalog(CARDS_15K, filters, AVAILABLE),
    );
    // measured: unindexed/indexed = 4.1x at n=15,000
    expect(indexed).toBeLessThan(unindexed);
  });

  it("a multi-tag query stays under budget (best of 20 runs)", () => {
    const index = buildDeckCatalogIndex(CARDS_15K);
    prepareAdvancedDeckCatalogIndex(index);
    const options = catalogTypeOptions(CARDS_15K);
    const filters = {
      ...EMPTY_DECK_CATALOG_QUERY,
      name: "",
      types: options.filter(({ id }) =>
        ["family:monster", "attribute:DARK", "race:Dragon"].includes(id),
      ),
    };
    expect(
      filterDeckCatalogIndex(index, filters, AVAILABLE).length,
    ).toBeGreaterThan(0);
    const best = bestOf(20, () =>
      filterDeckCatalogIndex(index, filters, AVAILABLE),
    );
    expect(best).toBeLessThan(2.5);
  });

  it("a representative text query stays under budget (best of 20 runs)", () => {
    const index = buildDeckCatalogIndex(CARDS_15K);
    prepareAdvancedDeckCatalogIndex(index);
    const filters = {
      ...EMPTY_DECK_CATALOG_QUERY,
      advanced: {
        ...EMPTY_DECK_CATALOG_QUERY.advanced,
        text: "monster",
      },
    };
    expect(filterDeckCatalogIndex(index, filters, AVAILABLE).length).toBe(
      8_125,
    );
    const best = bestOf(20, () =>
      filterDeckCatalogIndex(index, filters, AVAILABLE),
    );
    expect(best).toBeLessThan(5);
  });

  it("a worst supported combined query stays under budget (best of 20 runs)", () => {
    const index = buildDeckCatalogIndex(CARDS_15K);
    prepareAdvancedDeckCatalogIndex(index);
    const filters = {
      ...EMPTY_DECK_CATALOG_QUERY,
      advanced: {
        ...EMPTY_DECK_CATALOG_QUERY.advanced,
        text: 'monster -"special summon"',
        family: "monster" as const,
        attack: { op: "gte" as const, value: 0 },
      },
    };
    const count = filterDeckCatalogIndex(index, filters, AVAILABLE).length;
    expect(count).toBeGreaterThan(0);
    const best = bestOf(20, () =>
      filterDeckCatalogIndex(index, filters, AVAILABLE),
    );
    expect(best).toBeLessThan(5);
  });

  it("deriving type options stays under budget (best of 20 runs)", () => {
    const best = bestOf(20, () => catalogTypeOptions(CARDS_15K));
    expect(best).toBeLessThan(12);
  });

  it("loading the catalog stays under budget", async () => {
    const reader = makeInMemoryReader(15_000);
    const t0 = performance.now();
    await loadRuntimeCatalog(reader, "http://localhost/");
    const elapsed = performance.now() - t0;
    // measured: ~43ms in Vitest (in-memory reader), budget = ~35× headroom
    expect(elapsed).toBeLessThan(1500);
  });
});
