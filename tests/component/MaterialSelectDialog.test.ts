// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MaterialSelectDialog from "../../src/battle/app/components/duel-field/MaterialSelectDialog.svelte";
import type { CardImageLibrary } from "../../src/battle/app/images/card-image-cache.ts";
import type { InteractionChoice } from "../../src/battle/app/prompts/interaction-spec.ts";
import { cardCode, choiceId } from "../../src/battle/duel/contracts/ids.ts";

afterEach(() => {
  cleanup();
});

const CARD_BACK = "back.png";

function materialChoice(
  id: string,
  overrides: Partial<InteractionChoice> = {},
): InteractionChoice {
  return {
    id: choiceId(id),
    label: `Material ${id}`,
    action: "select",
    cardAddress: { controller: 0, location: "monster", sequence: 2 },
    cardCode: cardCode(97590747),
    ...overrides,
  };
}

/** A material the projector never attested: no code, so no identity to show. */
function concealedChoice(id: string): InteractionChoice {
  return {
    id: choiceId(id),
    label: "Card",
    action: "select",
    cardAddress: { controller: 1, location: "monster", sequence: 0 },
  };
}

function imageLibrary(url = "art.png") {
  return { lease: vi.fn(() => ({ url, release: vi.fn() })) };
}

function renderDialog(
  overrides: {
    readonly choices?: readonly InteractionChoice[];
    readonly minSelections?: number;
    readonly maxSelections?: number;
    readonly imageLibrary?: Pick<CardImageLibrary, "lease"> | null;
    readonly disabled?: boolean;
    readonly onconfirm?: (choiceIds: readonly string[]) => void;
    readonly oncancel?: (() => void) | null;
  } = {},
) {
  const onconfirm = overrides.onconfirm ?? vi.fn();
  const oncancel =
    overrides.oncancel === undefined ? vi.fn() : overrides.oncancel;
  const rendered = render(MaterialSelectDialog, {
    choices: overrides.choices ?? [
      materialChoice("m0"),
      materialChoice("m1"),
      materialChoice("m2"),
    ],
    minSelections: overrides.minSelections ?? 1,
    maxSelections: overrides.maxSelections ?? 1,
    imageLibrary: overrides.imageLibrary ?? imageLibrary(),
    cardBackUrl: CARD_BACK,
    disabled: overrides.disabled ?? false,
    onconfirm,
    oncancel,
  });
  return { rendered, onconfirm, oncancel };
}

function tile(id: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    `[data-cy="material-select-tile-${id}"]`,
  );
  if (element === null) throw new Error(`Missing tile ${id}`);
  return element;
}

function confirmButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    '[data-cy="material-select-confirm"]',
  );
  if (element === null) throw new Error("Missing confirm button");
  return element;
}

describe("MaterialSelectDialog (synthetic contract fixtures)", () => {
  it("renders one art tile per material choice", () => {
    const library = imageLibrary("material-art.png");
    renderDialog({ imageLibrary: library });

    expect(
      document.querySelector('[data-cy="material-select-dialog"]'),
    ).not.toBe(null);
    expect(
      document.querySelectorAll('[data-cy^="material-select-tile-image-"]'),
    ).toHaveLength(3);
    expect(
      document
        .querySelector('[data-cy="material-select-tile-image-m0"]')
        ?.getAttribute("src"),
    ).toBe("material-art.png");
    expect(library.lease).toHaveBeenCalledWith(97590747);
  });

  it("shows the card back for a material the projector never attested", () => {
    renderDialog({ choices: [concealedChoice("hidden")] });

    const image = document.querySelector(
      '[data-cy="material-select-tile-image-hidden"]',
    );
    expect(image?.getAttribute("src")).toBe(CARD_BACK);
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("replaces the pick at a single-selection cap and confirms that id", async () => {
    const user = userEvent.setup();
    const { onconfirm } = renderDialog({ minSelections: 1, maxSelections: 1 });

    await user.click(tile("m0"));
    expect(tile("m0").getAttribute("aria-pressed")).toBe("true");
    await user.click(tile("m1"));
    expect(tile("m0").getAttribute("aria-pressed")).toBe("false");
    expect(tile("m1").getAttribute("aria-pressed")).toBe("true");

    await user.click(confirmButton());
    expect(onconfirm).toHaveBeenCalledWith(["m1"]);
  });

  it("keeps confirm disabled until the minimum is selected", async () => {
    const user = userEvent.setup();
    renderDialog({ minSelections: 2, maxSelections: 2 });

    expect(confirmButton().disabled).toBe(true);
    await user.click(tile("m0"));
    expect(confirmButton().disabled).toBe(true);
    await user.click(tile("m1"));
    expect(confirmButton().disabled).toBe(false);
  });

  it("cancels through the same submission path when the prompt allows it", async () => {
    const user = userEvent.setup();
    const oncancel = vi.fn();
    renderDialog({ oncancel });

    await user.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cy="material-select-cancel"]',
      )!,
    );
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it("offers no cancel for a mandatory prompt", () => {
    renderDialog({ oncancel: null });

    expect(document.querySelector('[data-cy="material-select-cancel"]')).toBe(
      null,
    );
  });

  it("answers nothing while a response is in flight", async () => {
    const user = userEvent.setup();
    const { onconfirm } = renderDialog({ disabled: true });

    await user.click(tile("m0"));
    expect(tile("m0").getAttribute("aria-pressed")).toBe("false");
    expect(confirmButton().disabled).toBe(true);
    expect(onconfirm).not.toHaveBeenCalled();
  });
});
