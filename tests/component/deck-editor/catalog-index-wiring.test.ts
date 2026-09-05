// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DeckCatalogIndexModule from "../../../src/decks/catalog/deck-catalog-index-base.ts";
import type * as DeckCatalogModule from "../../../src/decks/catalog/deck-catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { syntheticCatalog } from "../../fixtures/synthetic-catalog.ts";

/* The catalog's cost is one lower-cased copy of 14,551 names. The index pays
   it once when the card list changes; the reference `filterDeckCatalog` pays
   it again on every keystroke. At n=15,000 that is 0.18 ms against 0.44 ms —
   a real difference, and far too small for a timing budget to separate
   without flaking, so `deck-catalog-performance.test.ts` cannot be the thing
   that catches a rewiring. This can: it counts the calls.

   Both modules are spied through rather than replaced, so the component still
   runs the real filter and the rendered results stay meaningful. */
const buildSpy = vi.hoisted(() => vi.fn());
const filterIndexSpy = vi.hoisted(() => vi.fn());
const filterPlainSpy = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../src/decks/catalog/deck-catalog-index-base.ts",
  async (original) => {
    const real = await original<typeof DeckCatalogIndexModule>();
    return {
      ...real,
      buildDeckCatalogIndex: (
        ...args: Parameters<typeof real.buildDeckCatalogIndex>
      ) => {
        buildSpy(...args);
        return real.buildDeckCatalogIndex(...args);
      },
      filterQuickDeckCatalogIndex: (
        ...args: Parameters<typeof real.filterQuickDeckCatalogIndex>
      ) => {
        filterIndexSpy(...args);
        return real.filterQuickDeckCatalogIndex(...args);
      },
    };
  },
);

vi.mock("../../../src/decks/catalog/deck-catalog.ts", async (original) => {
  const real = await original<typeof DeckCatalogModule>();
  return {
    ...real,
    filterDeckCatalog: (...args: Parameters<typeof real.filterDeckCatalog>) => {
      filterPlainSpy(...args);
      return real.filterDeckCatalog(...args);
    },
  };
});

const { default: CardCatalog } =
  await import("../../../src/deck-editor/components/CardCatalog.svelte");

const CARDS = syntheticCatalog(600);

beforeEach(() => {
  buildSpy.mockClear();
  filterIndexSpy.mockClear();
  filterPlainSpy.mockClear();
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => cleanup());

function renderCatalog() {
  return render(CardCatalog, {
    cards: CARDS,
    ruleset: PROTOTYPE_RULESET,
    onselect: vi.fn(),
    ondragcard: vi.fn(),
  });
}

describe("the catalog searches through the index", () => {
  it("a search runs the indexed filter and never the unindexed one", async () => {
    const { container } = renderCatalog();
    await tick();

    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Name" }), "dragon");
    await tick();

    /* The results are real, so this is a filter that ran rather than a spy
       that was merely installed: three of the twenty-four prototype names
       carry "Dragon", and 600 cards clone them twenty-five times each. */
    expect(
      container.querySelector('[data-cy="deck-catalog-result-count"]')
        ?.textContent,
    ).toBe("75 results");
    expect(filterIndexSpy).toHaveBeenCalled();
    expect(filterPlainSpy).not.toHaveBeenCalled();
  });

  it("six keystrokes lower-case the names once, not six times", async () => {
    renderCatalog();
    await tick();
    const buildsBeforeTyping = buildSpy.mock.calls.length;

    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Name" }), "dragon");
    await tick();

    /* `cards` never changed, so the index must not have been rebuilt: the
       whole point of hoisting it out of the filter is that a keystroke costs a
       scan and not a re-index. */
    expect(buildSpy.mock.calls.length).toBe(buildsBeforeTyping);
    expect(filterIndexSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("committing a type tag scans without rebuilding the card index", async () => {
    renderCatalog();
    await tick();
    const buildsBeforeTag = buildSpy.mock.calls.length;
    const filtersBeforeTag = filterIndexSpy.mock.calls.length;

    await userEvent
      .setup()
      .type(
        await screen.findByRole("combobox", { name: "Types" }),
        "monster{Enter}",
      );
    await tick();

    expect(buildSpy.mock.calls.length).toBe(buildsBeforeTag);
    expect(filterIndexSpy.mock.calls.length).toBeGreaterThan(filtersBeforeTag);
  });
});
