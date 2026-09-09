import { describe, expect, it } from "vitest";
import { buildActiveCardDataManifest } from "../../../scripts/lib/active-card-data-manifest.ts";
import { buildActiveCardTextManifest } from "../../../scripts/lib/active-card-text-manifest.ts";
import { buildActiveImageManifest } from "../../../scripts/lib/active-image-manifest.ts";
import {
  packagedCatalog,
  packagedCatalogRecords,
} from "../../../src/decks/catalog/packaged-catalog.ts";
import { PROTOTYPE_CATALOG_ASSETS } from "../../../src/deck-editor/fixtures/catalog.ts";

/* Built the way `vite.config.ts` builds the three globals, from the same
   generated snapshot, so this file checks the real shipped catalog rather than
   a stand-in for it. */
const packagedCodes = buildActiveImageManifest(
  process.cwd(),
  "packaged-catalog-test",
).files.map(({ code }) => code);
const codes = new Set(packagedCodes);
const catalog = packagedCatalog(
  buildActiveCardDataManifest(process.cwd(), codes),
  buildActiveCardTextManifest(process.cwd(), codes),
);

describe("packagedCatalogRecords", () => {
  it("joins each card's masks to its packaged text", () => {
    const [first] = PROTOTYPE_CATALOG_ASSETS;
    const records = packagedCatalogRecords(
      [first!],
      [{ code: first!.code, name: "Named", description: "Described" }],
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.card.code).toBe(first!.code);
    expect(records[0]?.card.type).toBe(first!.type);
    expect(records[0]?.text).toEqual({
      code: first!.code,
      name: "Named",
      description: "Described",
      strings: [],
    });
  });

  it("refuses a card whose text this build does not package", () => {
    expect(() => packagedCatalogRecords(PROTOTYPE_CATALOG_ASSETS, [])).toThrow(
      /has no packaged text/,
    );
  });
});

describe("packagedCatalog imageUrl param", () => {
  it("attaches an image url for manifest-backed codes", () => {
    const [first] = PROTOTYPE_CATALOG_ASSETS;
    const code = first!.code;
    const url = `runtime/images/${code}.jpg`;
    const map: ReadonlyMap<number, string> = new Map([[code, url]]);
    const texts = [{ code, name: "Test", description: "Test" }];
    const views = packagedCatalog([first!], texts, map);
    expect(views[0]?.imageUrl).toBe(url);
  });

  it("leaves imageUrl null for codes without packaged art", () => {
    const [first] = PROTOTYPE_CATALOG_ASSETS;
    const code = first!.code;
    const texts = [{ code, name: "Test", description: "Test" }];
    const views = packagedCatalog([first!], texts, new Map());
    expect(views[0]?.imageUrl).toBeNull();
  });
});

describe("the packaged deck catalog", () => {
  it("offers exactly the codes whose art this build ships", () => {
    expect(catalog.map(({ code }) => code)).toEqual(packagedCodes);
    expect(new Set(catalog.map(({ code }) => code)).size).toBe(catalog.length);
  });

  it("names and describes every card it offers", () => {
    expect(
      catalog.filter(({ name, description }) => !name || !description),
    ).toEqual([]);
  });

  it("packages the Chapter 1 Main-only pool with enough copies to build a deck", () => {
    const main = catalog.filter((card) => card.canonicalZone === "main");
    const extra = catalog.filter((card) => card.canonicalZone === "extra");

    expect(main.length + extra.length).toBe(catalog.length);
    expect(main).toHaveLength(16);
    expect(main.length * 3).toBeGreaterThanOrEqual(40);
    expect(extra).toHaveLength(0);
  });

  it("covers every family the editor filters by", () => {
    expect(new Set(catalog.map(({ family }) => family))).toEqual(
      new Set(["monster", "spell", "trap"]),
    );
  });
});
