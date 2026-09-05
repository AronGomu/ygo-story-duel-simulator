// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/deck-editor/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";

vi.mock("../../../src/deck-editor/advanced-search-loader.ts", () => ({
  loadAdvancedSearch: () => {
    throw new Error("load failed");
  },
}));

afterEach(() => cleanup());

describe("advanced search loading", () => {
  it("shows a recoverable error when the lazy module rejects", async () => {
    render(CardCatalog, {
      cards: PROTOTYPE_CATALOG,
      ruleset: PROTOTYPE_RULESET,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Advanced Search" }));

    const retry = await screen.findByRole("button", {
      name: "Advanced Search failed. Retry",
    });
    await user.click(retry);
    expect(
      screen.getAllByRole("button", {
        name: "Advanced Search failed. Retry",
      }),
    ).toHaveLength(1);
  });
});
