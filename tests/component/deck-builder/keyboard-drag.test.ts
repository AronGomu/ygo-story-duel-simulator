// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditor from "../../../src/prototypes/deck-builder/components/DeckEditor.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("keyboard drag parity", () => {
  it("picks up, announces, drops, and cancels without pointer input", async () => {
    const user = userEvent.setup();
    const onmutate = vi.fn();
    render(DeckEditor, {
      state: stateFixture(),
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      onlibrary: vi.fn(),
      onrename: vi.fn(),
      onmutate,
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });

    const card = screen.getByRole("button", { name: /Blue-Eyes White Dragon/ });
    card.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("status").textContent).toContain("picked up");
    await user.click(
      screen.getByRole("button", { name: "Drop picked card in Main Deck" }),
    );
    expect(onmutate).toHaveBeenCalledWith({ type: "add", cardCode: 89631139 });
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Main Deck" }),
    );

    card.focus();
    await user.keyboard(" ");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status").textContent).toContain("cancelled");
    expect(
      screen.queryByRole("button", { name: /Drop picked card/ }),
    ).toBeNull();
  });

  it("blocks keyboard pickup when copy limit is reached", async () => {
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
    render(DeckEditor, {
      state,
      cards: PROTOTYPE_CATALOG,
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
      onlibrary: vi.fn(),
      onrename: vi.fn(),
      onmutate: vi.fn(),
      onundo: vi.fn(),
      onredo: vi.fn(),
      onretrysave: vi.fn(),
      onreload: vi.fn(),
      onpreservecopy: vi.fn(),
    });
    const card = screen.getAllByRole("button", {
      name: /Blue-Eyes White Dragon/,
    })[0]!;
    card.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("status").textContent).toContain(
      "Copy limit 3 reached",
    );
    expect(
      screen.queryByRole("button", { name: /Drop picked card/ }),
    ).toBeNull();
  });
});
