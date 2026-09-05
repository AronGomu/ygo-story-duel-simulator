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
import type { AssetDeckCardRecord } from "../../../src/decks/catalog/ocg-card-mapper.ts";
import type { PackagedCardText } from "../../../src/decks/catalog/packaged-catalog.ts";
import { syntheticCatalog } from "../../fixtures/synthetic-catalog.ts";

const CARDS_15K = syntheticCatalog(15_000);
const AVAILABLE = () => true;

/* Every budget below is a best-of-N rather than one cold run. A single run
   measures whatever the JIT and the GC were doing at that instant — the same
   `buildDeckCatalogIndex` call costs 3.1-3.8 ms cold and 0.26-0.38 ms warm —
   so a ceiling set from a cold number is really a ceiling four to fifteen
   times looser than it reads, and every "measured: ~Nms" comment in this file
   used to quote the runner's wall time for the whole case instead of the
   quantity the assertion tests. Best-of-N is the noise-robust number: measured
   across three full `npm run test:unit` runs, where these files share the
   machine with forty others, the spread stayed inside 1.5x. */
function bestOf(runs: number, work: () => unknown): number {
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const t0 = performance.now();
    work();
    const elapsed = performance.now() - t0;
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
  /* The regression this rejects is an accidental quadratic, which is what a
     de-duplicating pass over 15k codes turns into the moment it reaches for
     `Array.prototype.includes` instead of a `Set`: measured at 34-43 ms, or
     120x the linear build, and the old 400 ms ceiling waved it through. */
  it("building fresh indexes stays under budget (best of 20 runs)", () => {
    const inputs = Array.from({ length: 20 }, () =>
      CARDS_15K.map((card) => ({ ...card })),
    );
    const indexes: unknown[] = [];
    let run = 0;
    const best = bestOf(20, () => {
      const index = buildDeckCatalogIndex(inputs[run++]!);
      indexes.push(index);
      if (index.lowerNames.length !== 15_000) throw new Error("empty workload");
    });
    expect(new Set(indexes).size).toBe(20);
    expect(best).toBeLessThan(2.5);
  });

  /* `dragon` is three of the twenty-four prototype names, so the search walks
     15,000 cards and pushes 1,875 of them: the `out.push` path a real search
     takes, not the early-`continue` a zero-match term would measure. The count
     is asserted so a fixture rename cannot quietly turn this into a timing of
     the empty branch. */
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
    // measured: 0.175-0.209ms best-of-20 at n=15,000; budget rejects a 10x regression
    expect(best).toBeLessThan(1.5);
  });

  /* The index earns its keep by lower-casing every name once instead of once
     per keystroke, and that is a ratio rather than a ceiling: the two paths
     are 0.18 ms and 0.44 ms, so no absolute budget can separate them without
     sitting close enough to the noise to flake. `catalog-index-wiring.test.ts`
     is what proves the component is on the indexed path; this proves the
     indexed path is still worth being on. */
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
    // measured: unindexed/indexed = 1.9-4.3x across 24 samples under suite load
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
