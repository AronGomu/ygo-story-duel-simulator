// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CardCatalog from "../../../src/deck-editor/components/CardCatalog.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
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
    cards: PROTOTYPE_CATALOG,
    ruleset: PROTOTYPE_RULESET,
    onselect: vi.fn(),
    ondragcard: vi.fn(),
  });
}

describe("AdvancedCardSearch", () => {
  it("starts closed, opens on the workspace bounds and focuses close", async () => {
    renderCatalog();
    expect(
      screen.queryByRole("dialog", { name: "Advanced Search" }),
    ).toBeNull();

    const trigger = screen.getByRole("button", { name: "Advanced Search" });
    await userEvent.setup().click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Advanced Search",
    });
    expect(dialog.hasAttribute("open")).toBe(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close advanced search" }),
      ),
    );
    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>(
          '[data-cy="advanced-search-veil"]',
        )!,
      ).opacity,
    ).toBe("0.34");
  });

  it("applies changes live, resets in place and restores trigger focus", async () => {
    renderCatalog();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Advanced Search" });
    await user.click(trigger);

    await screen.findByRole("dialog", { name: "Advanced Search" });
    const name = document.querySelector<HTMLInputElement>(
      '[data-cy="advanced-search-name-input"]',
    )!;
    await user.type(name, "Dark Magician");
    await user.selectOptions(
      document.querySelector<HTMLSelectElement>(
        '[data-cy="advanced-search-name-match"]',
      )!,
      "exact",
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-cy="advanced-search-result-value"]')
          ?.textContent,
      ).toBe("1"),
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(
      screen.getByRole("dialog", { name: "Advanced Search" }),
    ).not.toBeNull();
    await waitFor(() =>
      expect(
        document.querySelector('[data-cy="advanced-search-result-value"]')
          ?.textContent,
      ).toBe("23"),
    );

    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(
      screen.queryByRole("dialog", { name: "Advanced Search" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("traps Tab, closes on Escape and omits unsupported facets", async () => {
    renderCatalog();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Advanced Search" });
    await user.click(trigger);

    expect(
      screen.queryByText(
        /Archetype|Rarity|Release date|Community signal|Format/,
      ),
    ).toBeNull();
    const apply = await screen.findByRole("button", {
      name: "Apply filters",
    });
    apply.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close advanced search" }),
    );
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(apply);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Advanced Search" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("shows numeric validation errors while matching no cards", async () => {
    renderCatalog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Advanced Search" }));
    await screen.findByRole("dialog", { name: "Advanced Search" });
    await user.selectOptions(
      document.querySelector<HTMLSelectElement>(
        '[data-cy="advanced-attack-operator"]',
      )!,
      "eq",
    );
    expect(screen.getByText("Enter a valid value.")).not.toBeNull();
    expect(
      document.querySelector('[data-cy="advanced-search-result-value"]')
        ?.textContent,
    ).toBe("0");

    await user.selectOptions(
      document.querySelector<HTMLSelectElement>(
        '[data-cy="advanced-attack-operator"]',
      )!,
      "range",
    );
    await user.type(
      document.querySelector<HTMLInputElement>(
        '[data-cy="advanced-attack-minimum"]',
      )!,
      "3000",
    );
    await user.type(
      document.querySelector<HTMLInputElement>(
        '[data-cy="advanced-attack-maximum"]',
      )!,
      "1000",
    );
    expect(screen.getByText("Minimum must not exceed maximum.")).not.toBeNull();
  });
});
