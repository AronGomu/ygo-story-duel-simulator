// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/deck-editor/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { syntheticCatalog } from "../../fixtures/synthetic-catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import type { DeckBuilderCardView } from "../../../src/decks/catalog/ocg-card-mapper.ts";

const originalIO = globalThis.IntersectionObserver;

afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = originalIO;
});

function make200Cards(): DeckBuilderCardView[] {
  return Array.from({ length: 200 }, (_, i) => {
    const base = PROTOTYPE_CATALOG[i % PROTOTYPE_CATALOG.length]!;
    return { ...base, code: base.code + i * 1_000_000 };
  });
}

function countTiles(container: HTMLElement): number {
  return container.querySelectorAll("button[data-cy^='catalog-tile-']").length;
}

interface StubIOHandle {
  trigger: (entries: Partial<IntersectionObserverEntry>[]) => void;
  /** Every element handed to `observe`, newest last. */
  observed: () => readonly Element[];
  /** The `root` the live observer was constructed with. */
  root: () => Element | Document | null | undefined;
  rootMargin: () => string | undefined;
}

function installStubIO(): StubIOHandle {
  let capturedCb: IntersectionObserverCallback | null = null;
  let capturedInstance: IntersectionObserver | null = null;
  let capturedInit: IntersectionObserverInit | undefined;
  const observed: Element[] = [];

  class StubIO {
    constructor(
      cb: IntersectionObserverCallback,
      init?: IntersectionObserverInit,
    ) {
      capturedCb = cb;
      capturedInstance = this as unknown as IntersectionObserver;
      capturedInit = init;
    }
    observe = vi.fn((element: Element) => {
      observed.push(element);
    });
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds = [];
  }

  globalThis.IntersectionObserver =
    StubIO as unknown as typeof IntersectionObserver;

  return {
    trigger(entries) {
      capturedCb?.(entries as IntersectionObserverEntry[], capturedInstance!);
    },
    observed: () => observed,
    root: () => capturedInit?.root,
    rootMargin: () => capturedInit?.rootMargin,
  };
}

describe("catalog infinite scroll", () => {
  it("only the first sixty tiles are mounted", async () => {
    installStubIO();
    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    expect(countTiles(container)).toBe(60);
    expect(
      container.querySelector('[data-cy="deck-catalog-results-sentinel"]'),
    ).toBeTruthy();
  });

  it("an intersection appends the next sixty", async () => {
    const stub = installStubIO();
    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    stub.trigger([{ isIntersecting: true }]);
    await tick();

    expect(countTiles(container)).toBe(120);
  });

  /* The narrowed set has to stay wider than one window, or "reset to 60" and
     "kept the stale 120" render the same tiles: 128 of the 200 fixture cards
     are monsters, so a family filter is a result set the window still bites
     into. A search that narrows 14,551 rows to a few thousand is the real
     shape of this, and inheriting the previous window there is the bug. */
  it("changing a filter resets the window", async () => {
    const stub = installStubIO();
    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    stub.trigger([{ isIntersecting: true }]);
    await tick();
    expect(countTiles(container)).toBe(120);

    await userEvent
      .setup()
      .type(screen.getByRole("combobox", { name: "Types" }), "monster{Enter}");
    await tick();

    expect(
      container.querySelector('[data-cy="deck-catalog-result-count"]')
        ?.textContent,
    ).toBe("128 results");
    expect(countTiles(container)).toBe(60);
  });

  /* A typed name is the other half of the same rule, and it also has to leave
     more than one window behind: every fixture card is a "..." clone, so
     filtering on a shared word narrows without emptying. */
  it("typing a name resets the window", async () => {
    const stub = installStubIO();
    const cards = make200Cards().map((card, i) => ({
      ...card,
      name: i % 2 === 0 ? `Alpha ${card.name}` : `Beta ${card.name}`,
    }));
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    stub.trigger([{ isIntersecting: true }]);
    await tick();
    expect(countTiles(container)).toBe(120);

    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Name" }), "Alpha");
    await tick();

    expect(
      container.querySelector('[data-cy="deck-catalog-result-count"]')
        ?.textContent,
    ).toBe("100 results");
    expect(countTiles(container)).toBe(60);
  });

  /* An observer aimed at the wrong element, or at nothing, never appends: the
     window would sit at its first sixty with no way to tell from the tiles.
     The root is asserted with it because `filled` changes it — that layout
     never clips, so a scroller root watches a sentinel that never moves. */
  it("the observer watches the sentinel, rooted on the scroller", async () => {
    const stub = installStubIO();
    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    const sentinel = container.querySelector(
      '[data-cy="deck-catalog-results-sentinel"]',
    );
    expect(sentinel).not.toBeNull();
    expect(stub.observed()).toContain(sentinel!);
    expect(stub.observed().at(-1)).toBe(sentinel!);
    expect(stub.root()).toBe(
      container.querySelector('[data-cy="deck-catalog-results"]'),
    );
    expect(stub.rootMargin()).toBe("200px");
  });

  it("the filled layout roots the observer on the viewport", async () => {
    const stub = installStubIO();
    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      filled: true,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    const sentinel = container.querySelector(
      '[data-cy="deck-catalog-results-sentinel"]',
    );
    expect(stub.observed().at(-1)).toBe(sentinel!);
    expect(stub.root() ?? null).toBeNull();
  });

  it("renders at most 60 tiles for 15k cards and resolves quickly", async () => {
    installStubIO();
    const cards = syntheticCatalog(15_000);
    const t0 = performance.now();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();
    const elapsed = performance.now() - t0;
    // measured: <200ms in Vitest, budget = 1500ms
    expect(countTiles(container)).toBe(60);
    expect(elapsed).toBeLessThan(1500);
  });

  it("no observer means no hidden cards", async () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const cards = make200Cards();
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    expect(countTiles(container)).toBe(200);
    expect(
      container.querySelector('[data-cy="deck-catalog-results-sentinel"]'),
    ).toBeNull();
  });

  /* Nothing appends without an observer, so the first render is the only
     render: the whole database would be 14,551 tiles at once, the one
     unbounded path in a component that windows everywhere else. */
  it("no observer caps the render and says the rest is behind the filters", async () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const cards = syntheticCatalog(15_000);
    const { container } = render(CardCatalog, {
      cards,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
    });
    await tick();

    expect(countTiles(container)).toBe(200);
    expect(
      container.querySelector('[data-cy="deck-catalog-fallback-notice"]')
        ?.textContent,
    ).toContain("Showing the first 200");
  });
});
