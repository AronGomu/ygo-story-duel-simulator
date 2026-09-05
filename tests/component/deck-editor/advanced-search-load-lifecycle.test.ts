// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/deck-editor/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { EMPTY_ADVANCED_DECK_CATALOG_FILTERS } from "../../../src/decks/catalog/deck-catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import type {
  AdvancedSearchHost,
  AdvancedSearchSession,
} from "../../../src/deck-editor/advanced-search-loader.ts";

const loader = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("../../../src/deck-editor/advanced-search-loader.ts", () => ({
  openAdvancedSearch: (...args: unknown[]) => loader.run(...args),
}));

const open = vi.fn();
const destroy = vi.fn();

beforeEach(() => {
  open.mockReset();
  destroy.mockReset();
  loader.run.mockReset();
  loader.run.mockImplementation(async (host: AdvancedSearchHost) => {
    const generation = ++host.generation;
    await Promise.resolve();
    if (host.disposed || generation !== host.generation) return;
    const session: AdvancedSearchSession = {
      emptyFilters: EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
      filter: (index) => index.cards,
      open,
      setResultCount: vi.fn(),
      destroy,
    };
    host.session ??= session;
    host.onchange({
      ...host.read().filters,
      advanced: EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
    });
    open();
  });
});

afterEach(() => cleanup());

function renderCatalog() {
  return render(CardCatalog, {
    cards: PROTOTYPE_CATALOG,
    ruleset: PROTOTYPE_RULESET,
  });
}

describe("advanced search lazy lifecycle", () => {
  it("shares one import while generation guard mounts one dialog", async () => {
    renderCatalog();
    const trigger = screen.getByRole("button", { name: "Advanced Search" });
    trigger.click();
    trigger.click();

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(loader.run).toHaveBeenCalledTimes(1);
  });

  it("does not create an orphan session after catalog disposal", async () => {
    const view = renderCatalog();
    screen.getByRole("button", { name: "Advanced Search" }).click();
    view.unmount();

    await waitFor(() => expect(loader.run).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("destroys an opened session with its catalog", async () => {
    const view = renderCatalog();
    screen.getByRole("button", { name: "Advanced Search" }).click();
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
