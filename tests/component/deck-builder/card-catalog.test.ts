// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/prototypes/deck-builder/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";

afterEach(() => cleanup());

describe("CardCatalog", () => {
  it("supports only approved name/family/subtype/Attribute/race filters", async () => {
    const user = userEvent.setup();
    render(CardCatalog, {
      cards: PROTOTYPE_CATALOG,
      ruleset: PROTOTYPE_RULESET,
      onselect: vi.fn(),
      ondragcard: vi.fn(),
      onpickup: vi.fn(),
    });
    await user.type(
      screen.getByRole("searchbox", { name: "Name" }),
      "Blue-Eyes",
    );
    expect(
      screen.getByRole("button", { name: /Blue-Eyes White Dragon/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Dark Magician/ })).toBeNull();
    expect(
      screen.queryByLabelText(
        /ATK range|effect text|archetype|format|banlist/i,
      ),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText(/24 results/)).toBeTruthy();
  });

  it("updates pinned selection callback without adding on click", async () => {
    const onselect = vi.fn();
    const ondragcard = vi.fn();
    render(CardCatalog, {
      cards: PROTOTYPE_CATALOG,
      ruleset: PROTOTYPE_RULESET,
      onselect,
      ondragcard,
      onpickup: vi.fn(),
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Raigeki/ }));
    expect(onselect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Raigeki" }),
    );
    expect(ondragcard).not.toHaveBeenCalled();
  });
});
