// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckSelectScreen from "../../../src/deck-select/DeckSelectScreen.svelte";
import { tile } from "./tile-builder.ts";

afterEach(() => cleanup());

function find(value: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-cy="${value}"]`);
}

function cy(value: string): HTMLElement {
  const element = find(value);
  if (element === null) throw new Error(`No element with data-cy "${value}"`);
  return element;
}

function button(value: string): HTMLButtonElement {
  return cy(value) as HTMLButtonElement;
}

/** The tiles the grid shows, in the order it shows them. */
function gridOrder(): readonly string[] {
  return [...cy("deck-select-grid").children].map(
    (child) => child.getAttribute("data-cy") ?? "",
  );
}

/** The management cluster's buttons, in the order the footer shows them. */
function manageOrder(): readonly string[] {
  return [...cy("deck-select-manage").children].map(
    (child) => child.getAttribute("data-cy") ?? "",
  );
}

function handlers() {
  return {
    onselect: vi.fn(),
    onstart: vi.fn(),
    onback: vi.fn(),
    onopen: vi.fn(),
    onblockedopen: vi.fn(),
    onrename: vi.fn(),
    onduplicate: vi.fn(),
    ondelete: vi.fn(),
  };
}

/* Three decks the whole suite reuses: k1 and k3 legal, k2 not, and the illegal
   one carries the newest stamp so the ordering it lands in can only come from
   the rank function rather than from the sort. */
function decks() {
  return [
    tile({
      key: "k1",
      name: "Aurora Fleet",
      updatedAt: "2026-08-20T10:00:00.000Z",
    }),
    tile({
      key: "k2",
      name: "Blaze Circuit",
      legal: false,
      blockReason: "Main Deck needs 5 more card(s).",
      updatedAt: "2026-08-21T10:00:00.000Z",
    }),
    tile({
      key: "k3",
      name: "Cracked Relic",
      updatedAt: "2026-08-19T10:00:00.000Z",
    }),
  ];
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    mode: "duel-start" as const,
    eyebrow: "Free play",
    title: "Choose your deck",
    tiles: decks(),
    selectedKey: null,
    opponent: {
      id: "vault-warden",
      name: "Vault Warden",
      line: "Locks the board, then closes it out.",
      locked: false,
    },
    opponentDeck: tile({ key: "o1", name: "Warden Vault", bundled: true }),
    playerDeck: null,
    ...handlers(),
    ...overrides,
  };
}

describe("DeckSelectScreen", () => {
  it("focuses deck filter on initial mount", () => {
    render(DeckSelectScreen, props());

    expect(document.activeElement).toBe(cy("deck-select-filter"));
  });

  it("name press opens rename without selecting tile", async () => {
    const values = handlers();
    render(DeckSelectScreen, props(values));

    await userEvent.setup().click(cy("deck-tile-name-k1"));

    expect(find("deck-select-rename-dialog")).not.toBeNull();
    expect(values.onselect).not.toHaveBeenCalled();
    expect(values.onopen).not.toHaveBeenCalled();
  });

  it("rename rejects trimmed exact sibling duplicate before host callback", async () => {
    const values = handlers();
    render(
      DeckSelectScreen,
      props({
        ...values,
        tiles: [
          tile({ key: "k1", name: "Alpha" }),
          tile({ key: "k2", name: "Beta" }),
        ],
      }),
    );
    const user = userEvent.setup();

    await user.click(cy("deck-tile-name-k1"));
    const input = cy("deck-select-rename-input");
    await user.clear(input);
    await user.type(input, " Beta ");

    expect(cy("deck-select-rename-error").textContent).toBe(
      "A deck with this name already exists.",
    );
    expect(button("deck-select-rename-submit").disabled).toBe(true);
    expect(values.onrename).not.toHaveBeenCalled();
  });

  it("orders tiles with live count", () => {
    render(DeckSelectScreen, props());

    expect(cy("deck-select-eyebrow").textContent).toBe("Free play");
    expect(cy("deck-select-title").textContent).toBe("Choose your deck");
    expect(gridOrder()).toEqual([
      "deck-tile-k1",
      "deck-tile-k3",
      "deck-tile-k2",
    ]);
    expect(cy("deck-select-count").textContent).toBe("3/3");
  });

  it("reports two filtered decks out of eight", async () => {
    render(
      DeckSelectScreen,
      props({
        tiles: [
          ...decks(),
          tile({ key: "k4", name: "Aurora Reserve" }),
          tile({ key: "k5", name: "Cipher Wing" }),
          tile({ key: "k6", name: "Dragon Wake" }),
          tile({ key: "k7", name: "Ember Guard" }),
          tile({ key: "k8", name: "Frost Archive" }),
        ],
      }),
    );

    await userEvent.setup().type(cy("deck-select-filter"), "aurora");

    expect(gridOrder()).toEqual(["deck-tile-k1", "deck-tile-k4"]);
    expect(cy("deck-select-count").textContent).toBe("2/8");
  });

  it("press selects, local dblclick opens", async () => {
    const values = handlers();
    render(DeckSelectScreen, props(values));
    const user = userEvent.setup();

    await user.click(cy("deck-tile-press-k3"));
    expect(values.onselect).toHaveBeenCalledWith("k3");
    expect(values.onopen).not.toHaveBeenCalled();

    await user.dblClick(cy("deck-tile-press-k3"));
    expect(values.onopen).toHaveBeenCalledWith("k3");
    expect(values.onblockedopen).not.toHaveBeenCalled();
  });

  it("reports bundled dblclick once without opening", async () => {
    const values = handlers();
    const bundled = tile({ key: "preset", bundled: true });
    render(DeckSelectScreen, props({ ...values, tiles: [bundled] }));

    await fireEvent.dblClick(cy("deck-tile-press-preset"));

    expect(values.onblockedopen).toHaveBeenCalledExactlyOnceWith(bundled);
    expect(values.onopen).not.toHaveBeenCalled();
  });

  it("moves the filled default star after the host refreshes tiles", async () => {
    const onsetdefault = vi.fn();
    const first = decks().map((candidate) => ({
      ...candidate,
      isDefault: candidate.key === "k1",
    }));
    const base = props({ tiles: first, onsetdefault });
    const { rerender } = render(DeckSelectScreen, base);

    expect(button("deck-tile-default-star-k1").disabled).toBe(true);
    expect(button("deck-tile-default-star-k3").disabled).toBe(false);
    await userEvent.setup().click(cy("deck-tile-default-star-k3"));
    expect(onsetdefault).toHaveBeenCalledExactlyOnceWith("k3");

    await rerender({
      ...base,
      tiles: first.map((candidate) => ({
        ...candidate,
        isDefault: candidate.key === "k3",
      })),
    });
    expect(button("deck-tile-default-star-k1").disabled).toBe(false);
    expect(button("deck-tile-default-star-k3").disabled).toBe(true);
  });

  it("renders no default star for bundled presets", () => {
    render(
      DeckSelectScreen,
      props({ tiles: [tile({ key: "preset", bundled: true })] }),
    );

    expect(find("deck-tile-default-star-preset")).toBeNull();
  });

  it("bundled kebab keeps Open disabled and names the reason", async () => {
    render(
      DeckSelectScreen,
      props({ tiles: [tile({ key: "preset", bundled: true })] }),
    );

    await userEvent.setup().click(cy("deck-tile-menu-preset"));

    const open = button("deck-tile-menu-open-preset");
    const reason = cy("deck-tile-menu-open-reason-preset");
    expect(open.disabled).toBe(true);
    expect(open.textContent?.trim()).toBe("Open in deck builder");
    expect(open.getAttribute("aria-describedby")).toBe(reason.id);
    expect(reason.textContent?.trim()).toBe("Bundled deck: cannot be modified");
  });

  it("kebab flow reaches rename with new name", async () => {
    const values = handlers();
    render(DeckSelectScreen, props(values));
    const user = userEvent.setup();

    await user.click(cy("deck-tile-menu-k1"));
    await user.click(cy("deck-tile-menu-rename-k1"));

    const field = cy("deck-select-rename-input");
    await user.clear(field);
    await user.type(field, "Renamed");
    await user.click(cy("deck-select-rename-submit"));

    expect(values.onrename).toHaveBeenCalledWith("k1", "Renamed");
    expect(find("deck-select-rename-dialog")).toBeNull();
  });

  it("kebab delete goes through confirm", async () => {
    const values = handlers();
    render(DeckSelectScreen, props(values));
    const user = userEvent.setup();

    await user.click(cy("deck-tile-menu-k1"));
    await user.click(cy("deck-tile-menu-delete-k1"));
    expect(values.ondelete).not.toHaveBeenCalled();

    await user.click(cy("deck-select-delete-confirm-button"));

    expect(values.ondelete).toHaveBeenCalledWith("k1");
    expect(find("deck-select-delete-confirm")).toBeNull();
  });

  /* The way out names where it goes rather than the direction it goes in: the
     host owns the origin's name, and the screen owns the sentence. */
  it("the return button names the origin it goes back to", async () => {
    const base = props();
    const { rerender } = render(DeckSelectScreen, base);

    expect(cy("deck-select-back").textContent).toBe("← Return to Menu");

    await rerender({ ...base, backLabel: "Map" });

    expect(cy("deck-select-back").textContent).toBe("← Return to Map");
  });

  /* Creating a deck is the host's operation, not the screen's, so the button
     exists exactly when a host offered somewhere for it to land. */
  it("create renders with exact copy, raises its handler and sizes from the same copy", async () => {
    const oncreate = vi.fn();
    const base = props({ oncreate });
    const { rerender } = render(DeckSelectScreen, base);
    const create = button("deck-select-create");

    expect(create.textContent?.trim()).toBe("Create");
    expect(create.getAttribute("aria-label")).toBe("Create");
    expect(cy("deck-select-footer-probe-create").textContent?.trim()).toBe(
      "Create",
    );
    await userEvent.setup().click(create);
    expect(oncreate).toHaveBeenCalledTimes(1);

    await rerender({ ...base, oncreate: null });
    expect(find("deck-select-create")).toBeNull();
  });

  /* Create is the cluster's last word: the destructive actions read first,
     Open stays neutral, and the one that adds a deck closes the row. */
  it("the manage cluster orders its actions", () => {
    render(DeckSelectScreen, props({ oncreate: vi.fn() }));

    expect(manageOrder()).toEqual([
      "deck-select-delete",
      "deck-select-rename",
      "deck-select-duplicate",
      "deck-select-open",
      "deck-select-create",
    ]);
  });

  it("footer management disabled without selection", () => {
    render(DeckSelectScreen, props({ selectedKey: null }));

    expect(button("deck-select-delete").disabled).toBe(true);
    expect(button("deck-select-rename").disabled).toBe(true);
    expect(button("deck-select-duplicate").disabled).toBe(true);
  });

  it("footer delete disabled for undeletable pick", () => {
    render(
      DeckSelectScreen,
      props({
        tiles: [tile({ key: "b1", bundled: true, deletable: false })],
        selectedKey: "b1",
      }),
    );

    expect(button("deck-select-delete").disabled).toBe(true);
    expect(button("deck-select-rename").disabled).toBe(false);
    expect(button("deck-select-duplicate").disabled).toBe(false);
  });

  /* The story commits to an encounter on this screen, so it renders no way
     back at all — and the two controls go together, because they are one
     affordance the layout shows at two widths. */
  it("showBack=false hides both back controls", async () => {
    const base = props();
    const { rerender } = render(DeckSelectScreen, base);

    expect(find("deck-select-back")).not.toBeNull();
    expect(find("deck-select-back-icon")).not.toBeNull();

    await rerender({ ...base, showBack: false });

    expect(find("deck-select-back")).toBeNull();
    expect(find("deck-select-back-icon")).toBeNull();
  });

  /* A scope whose decks are managed somewhere else renders none of the
     management affordances: the footer cluster and every tile's kebab go with
     it, while Open and Start — the ways off this screen — stay. */
  it("manageable=false hides the manage cluster and the kebabs", () => {
    render(
      DeckSelectScreen,
      props({ selectedKey: "k1", manageable: false, oncreate: vi.fn() }),
    );

    expect(find("deck-select-manage")).toBeNull();
    expect(find("deck-select-delete")).toBeNull();
    expect(find("deck-select-rename")).toBeNull();
    expect(find("deck-select-duplicate")).toBeNull();
    /* A scope that manages its decks elsewhere creates them there too, so the
       handler is not enough to put Create on this footer. */
    expect(find("deck-select-create")).toBeNull();
    for (const key of ["k1", "k2", "k3"])
      expect(find(`deck-tile-menu-${key}`)).toBeNull();
    /* The picking half of the screen is untouched: this hides operations on a
       deck, not the deck itself. */
    expect(find("deck-tile-press-k1")).not.toBeNull();
    expect(find("deck-select-open")).not.toBeNull();
    expect(find("deck-select-start")).not.toBeNull();
  });

  it("library mode hides Open and Start", () => {
    render(
      DeckSelectScreen,
      props({ mode: "library", title: "Deck library", selectedKey: "k1" }),
    );

    expect(find("deck-select-open")).toBeNull();
    expect(find("deck-select-start")).toBeNull();
    expect(find("deck-select-back")).not.toBeNull();
    expect(find("deck-select-rename")).not.toBeNull();
  });

  it("start stays unique in the wide pane and narrow footer", async () => {
    const values = handlers();
    const base = props({ ...values, selectedKey: "k1", canStart: false });
    const { rerender } = render(DeckSelectScreen, base);

    expect(button("deck-select-start").disabled).toBe(true);
    expect(button("deck-select-start").textContent).toBe("Start the duel");
    expect(
      cy("duel-start-seat-panel").contains(button("deck-select-start")),
    ).toBe(true);
    expect(
      document.querySelectorAll('[data-cy="deck-select-start"]'),
    ).toHaveLength(1);

    await rerender({ ...base, canStart: true, forceNarrow: true });
    expect(button("deck-select-start").disabled).toBe(false);
    expect(cy("deck-select-footer").contains(button("deck-select-start"))).toBe(
      true,
    );
    expect(
      document.querySelectorAll('[data-cy="deck-select-start"]'),
    ).toHaveLength(1);

    await userEvent.setup().click(cy("deck-select-start"));
    expect(values.onstart).toHaveBeenCalledTimes(1);
  });

  it("slash focuses filter", async () => {
    render(DeckSelectScreen, props());

    await fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(cy("deck-select-filter"));
  });

  it("arrows skip illegal decks", async () => {
    const values = handlers();
    render(DeckSelectScreen, props({ ...values, selectedKey: "k1" }));

    await fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(values.onselect).toHaveBeenCalledWith("k3");

    /* k1 is the first legal deck, so there is nowhere above it to go: the pick
       stays put rather than wrapping onto the illegal tail. */
    await fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(values.onselect).toHaveBeenCalledTimes(1);
  });

  it("opponent seat mode paints selected grid tile orange and badges yours", () => {
    const pool = decks();
    render(
      DeckSelectScreen,
      props({
        selectedKey: "k1",
        seat: "opponent",
        opponent: {
          id: "vault-warden",
          name: "Vault Warden",
          line: "Locks the board, then closes it out.",
          locked: false,
        },
        opponentDeck: pool[1],
        playerDeck: pool[0],
      }),
    );

    /* Your own deck is on its seat card as well as in the grid, so each
       assertion asks the grid for its copy. */
    const grid = cy("deck-select-grid");
    const theirs = grid.querySelector('[data-cy="deck-tile-k2"]');
    expect(theirs?.classList).toContain("halo-focus");
    expect(grid.querySelector('[data-cy="deck-tile-check-k2"]')).toBeNull();

    const yours = grid.querySelector('[data-cy="deck-tile-k1"]');
    expect(yours?.classList).not.toContain("halo-you");
    expect(
      grid.querySelector('[data-cy="deck-tile-tags-k1"]')?.textContent,
    ).toContain("Yours");
  });

  /* The header and the tools row are one bar: identity leads, controls follow,
     and the result count closes the filter group it describes. */
  it("places the result count immediately after the filter in full and compact bars", async () => {
    const base = props({ forceCompact: false });
    const { rerender } = render(DeckSelectScreen, base);

    const order = () =>
      [...cy("deck-select-titlebar").children].map(
        (child) => child.getAttribute("data-cy") ?? "",
      );
    expect(order()).toEqual([
      "deck-select-back-icon",
      "deck-select-eyebrow",
      "deck-select-title",
      "deck-select-titlebar-sep",
      "deck-select-sort-field",
      "deck-select-filter-field",
      "deck-select-count",
    ]);

    await rerender({ ...base, forceCompact: true });
    expect(order()).toEqual([
      "deck-select-back-icon",
      "deck-select-title",
      "deck-select-sort-field",
      "deck-select-filter-field",
      "deck-select-count",
    ]);
    expect(find("deck-select-header")).toBeNull();
    expect(find("deck-select-heading")).toBeNull();
    expect(find("deck-select-tools")).toBeNull();
  });

  /* The bar is shared markup, so the library gets it too — with its own mode
     and title, and nothing else about it different. */
  it("library mode renders the same titlebar", () => {
    render(
      DeckSelectScreen,
      props({
        mode: "library",
        eyebrow: "Deck builder",
        title: "Deck library",
        selectedKey: "k1",
      }),
    );

    const bar = cy("deck-select-titlebar");
    for (const value of [
      "deck-select-eyebrow",
      "deck-select-title",
      "deck-select-count",
      "deck-select-sort-field",
      "deck-select-filter-field",
    ])
      expect(bar.contains(cy(value)), value).toBe(true);
    expect(find("deck-select-tools")).toBeNull();
  });

  /* jsdom lays nothing out, so the stretch is read off the rule that declares
     it; the pixel it produces is measured in a browser. */
  it("filter stretches to the pane edge and the column keeps three rows", () => {
    const source = readFileSync(
      "src/deck-select/DeckSelectScreen.svelte",
      "utf8",
    );

    const filter =
      /\.titlebar input\[type="search"\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(filter).toContain("flex: 1 1 auto");
    expect(filter).toContain("min-width: 6rem");

    const screen = /\.screen\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(screen).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  });

  it("block notice renders", () => {
    render(DeckSelectScreen, props({ blockNotice: "No decks yet" }));

    const notice = cy("deck-select-block-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toBe("No decks yet");
  });
});
