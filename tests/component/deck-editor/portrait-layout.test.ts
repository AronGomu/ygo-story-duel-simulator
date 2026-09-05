// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/deck-editor/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import type { EditorLayoutMode } from "../../../src/deck-editor/layout/editor-layout.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-editor.ts";

afterEach(() => cleanup());

function renderEditor(
  layoutMode: EditorLayoutMode,
  onmutate = vi.fn(),
  mainCount = 1,
) {
  render(DeckEditor, {
    state: stateFixture(mainCount),
    cards: PROTOTYPE_CATALOG,
    catalog: prototypeCatalogMap,
    ruleset: PROTOTYPE_RULESET,
    layoutMode,
    returnLabel: "Deck Selection",
    onreturn: vi.fn(),
    onrename: vi.fn(),
    onmutate,
    onundo: vi.fn(),
    onredo: vi.fn(),
    onretrysave: vi.fn(),
    onreload: vi.fn(),
    onpreservecopy: vi.fn(),
  });
  return onmutate;
}

const pane = (name: string) =>
  document.querySelector(`[data-cy="deck-pane-${name}"]`);

async function openCatalog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(document.querySelector('[data-cy="deck-tab-catalog"]')!);
}

describe("deck editor portrait layout", () => {
  it("renders catalog as initial pane for entry focus", () => {
    renderEditor("tabs");
    expect(pane("catalog")).not.toBeNull();
    expect(pane("deck")).toBeNull();
    expect(pane("details")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: "Name" }),
    );
    expect(
      screen.getByRole("tablist", { name: "Deck editor panes" }),
    ).toBeTruthy();
  });

  it("switches panes from the tab list without stealing tab focus", async () => {
    const user = userEvent.setup();
    renderEditor("tabs");
    await user.click(document.querySelector('[data-cy="deck-tab-deck"]')!);
    expect(pane("deck")).not.toBeNull();
    await openCatalog(user);
    expect(pane("catalog")).not.toBeNull();
    expect(pane("deck")).toBeNull();
    const tab = document.querySelector('[data-cy="deck-tab-catalog"]')!;
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab);
  });

  it("moves between tabs with the arrow keys and keeps return with details", async () => {
    const user = userEvent.setup();
    renderEditor("tabs");
    (
      document.querySelector('[data-cy="deck-tab-deck"]') as HTMLElement
    ).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      document.querySelector('[data-cy="deck-tab-details"]'),
    );
    const details = pane("details");
    expect(details).not.toBeNull();
    const returnButton = details?.querySelector(
      '[data-cy="deck-editor-return"]',
    );
    expect(returnButton).not.toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(returnButton);
  });

  it("does not steal focus when catalog remounts after dialog close", async () => {
    const user = userEvent.setup();
    renderEditor("tabs");
    await user.click(document.querySelector('[data-cy="deck-tab-deck"]')!);
    await user.click(document.querySelector('[data-cy="deck-editor-import"]')!);
    expect(document.activeElement).toBe(
      document.querySelector('[data-cy="deck-ydk-import-heading"]'),
    );
    await user.click(
      document.querySelector('[data-cy="deck-ydk-import-cancel"]')!,
    );
    const importButton = document.querySelector(
      '[data-cy="deck-editor-import"]',
    );
    expect(document.activeElement).toBe(importButton);
    await openCatalog(user);
    expect(document.activeElement).toBe(
      document.querySelector('[data-cy="deck-tab-catalog"]'),
    );
  });

  it("adds a tapped catalog card to its canonical zone and stays on the catalog", async () => {
    const user = userEvent.setup();
    const onmutate = renderEditor("tabs");
    await openCatalog(user);
    await user.click(
      screen.getByRole("button", { name: /Blue-Eyes White Dragon/ }),
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "add",
      cardCode: 89631139,
      zone: "main",
    });
    expect(pane("catalog")).not.toBeNull();
  });

  it("does not render catalog sideboard toggle", async () => {
    const user = userEvent.setup();
    renderEditor("tabs");
    await openCatalog(user);
    expect(
      document.querySelector('[data-cy="deck-catalog-to-sideboard-field"]'),
    ).toBeNull();
  });

  it("omits a catalog card at its copy limit", async () => {
    const user = userEvent.setup();
    const base = stateFixture();
    const state = {
      ...base,
      current: {
        ...base.current!,
        deck: {
          ...base.current!.deck,
          main: [89631139, 89631139, 89631139],
        },
      },
    };
    const onmutate = vi.fn();
    render(DeckEditor, {
      state,
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      layoutMode: "tabs" satisfies EditorLayoutMode,
      returnLabel: "Deck Selection",
      onreturn: vi.fn(),
      onrename: vi.fn(),
      onmutate,
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    await openCatalog(user);
    expect(
      screen.queryByRole("button", { name: /Blue-Eyes White Dragon/ }),
    ).toBeNull();
    expect(onmutate).not.toHaveBeenCalled();
    expect(pane("catalog")).not.toBeNull();
  });

  it("opens a target menu with the legal targets only when a deck card is tapped", async () => {
    const user = userEvent.setup();
    const onmutate = renderEditor("tabs");
    await user.click(document.querySelector('[data-cy="deck-tab-deck"]')!);
    await user.click(
      screen.getAllByRole("button", { name: /Blue-Eyes White Dragon/ })[0]!,
    );
    const menu = document.querySelector('[data-cy="deck-tap-menu"]');
    expect(menu).not.toBeNull();
    expect(menu!.querySelector('[data-cy="deck-tap-target-main"]')).toBeNull();
    expect(
      menu!
        .querySelector('[data-cy="deck-tap-target-extra"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
    await user.click(menu!.querySelector('[data-cy="deck-tap-target-side"]')!);
    expect(onmutate).toHaveBeenCalledWith({
      type: "move",
      cardCode: 89631139,
      from: "main",
      to: "side",
      index: 0,
    });
    expect(document.querySelector('[data-cy="deck-tap-menu"]')).toBeNull();
  });

  it("removes a deck card from the target menu", async () => {
    const user = userEvent.setup();
    const onmutate = renderEditor("tabs");
    await user.click(document.querySelector('[data-cy="deck-tab-deck"]')!);
    await user.click(
      screen.getAllByRole("button", { name: /Blue-Eyes White Dragon/ })[0]!,
    );
    await user.click(
      document.querySelector('[data-cy="deck-tap-target-remove"]')!,
    );
    expect(onmutate).toHaveBeenCalledWith({
      type: "remove",
      cardCode: 89631139,
      zone: "main",
      index: 0,
    });
  });

  it("closes the target menu on Escape without mutating", async () => {
    const user = userEvent.setup();
    const onmutate = renderEditor("tabs");
    await user.click(document.querySelector('[data-cy="deck-tab-deck"]')!);
    await user.click(
      screen.getAllByRole("button", { name: /Blue-Eyes White Dragon/ })[0]!,
    );
    await user.keyboard("{Escape}");
    expect(document.querySelector('[data-cy="deck-tap-menu"]')).toBeNull();
    expect(onmutate).not.toHaveBeenCalled();
  });

  it("keeps all three panels and no tap menu above the breakpoint", async () => {
    const user = userEvent.setup();
    const onmutate = renderEditor("panels");
    expect(pane("catalog")).not.toBeNull();
    expect(pane("deck")).not.toBeNull();
    expect(pane("details")).not.toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();

    const deckCard = screen.getAllByRole("button", {
      name: /Blue-Eyes White Dragon/,
    })[0]!;
    await user.click(deckCard);
    expect(document.querySelector('[data-cy="deck-tap-menu"]')).toBeNull();
    expect(onmutate).not.toHaveBeenCalled();

    await user.dblClick(deckCard);
    expect(onmutate).toHaveBeenCalledWith({
      type: "remove",
      cardCode: 89631139,
      zone: "main",
      index: 0,
    });
  });
});
