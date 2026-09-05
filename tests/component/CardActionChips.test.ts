// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardActionChips from "../../src/battle/app/components/duel-field/CardActionChips.svelte";
import { choiceId } from "../../src/battle/duel/contracts/ids.ts";
import type { InteractionChoice } from "../../src/battle/app/prompts/interaction-spec.ts";

afterEach(() => {
  cleanup();
});

const ACTIVATE: InteractionChoice = {
  id: choiceId("choice-activate"),
  label: "Activate Mystical Space Typhoon",
  action: "activate",
};

const SET: InteractionChoice = {
  id: choiceId("choice-setSpellTrap"),
  label: "Set Mystical Space Typhoon",
  action: "setSpellTrap",
};

function renderChips(
  overrides: {
    readonly choices?: readonly InteractionChoice[];
    readonly disabled?: boolean;
  } = {},
) {
  const onchoose = vi.fn();
  const ondismiss = vi.fn();
  const rendered = render(CardActionChips, {
    cardId: "card-1",
    cardLabel: "Mystical Space Typhoon in Your Hand",
    choices: overrides.choices ?? [ACTIVATE, SET],
    disabled: overrides.disabled ?? false,
    onchoose,
    ondismiss,
  });
  return { rendered, onchoose, ondismiss };
}

function chips(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-cy^="card-action-chip-"]',
    ),
  ];
}

describe("CardActionChips", () => {
  it("renders one button per choice", () => {
    const { rendered } = renderChips();
    expect(
      rendered.container.querySelector('[data-cy="card-action-chips-card-1"]'),
    ).not.toBeNull();
    expect(chips()).toHaveLength(2);
  });

  /* Only the hand zoom overlay asks for the stacked rows. The field's own
     pinned menu and the zone list keep the inline row they were designed as,
     so the stack has to be opt-in at the call site. */
  it("chips keep their row layout for the field menu", () => {
    const { rendered } = renderChips();
    const container = rendered.container.querySelector(
      '[data-cy="card-action-chips-card-1"]',
    );
    expect(container?.classList.contains("is-stacked")).toBe(false);
  });

  it("stacks one chip per row when the caller asks for the stacked layout", () => {
    const rendered = render(CardActionChips, {
      cardId: "card-1",
      cardLabel: "Mystical Space Typhoon in Your Hand",
      choices: [ACTIVATE, SET],
      layout: "stack",
      onchoose: vi.fn(),
      ondismiss: vi.fn(),
    });

    const container = rendered.container.querySelector(
      '[data-cy="card-action-chips-card-1"]',
    );
    expect(container?.classList.contains("is-stacked")).toBe(true);
    // The scoped `data-cy` values are what the e2e locators address; a layout
    // switch may not rename them.
    expect(chips()).toHaveLength(2);
  });

  it("labels a chip with the action word and keeps the engine text accessible", () => {
    renderChips({ choices: [ACTIVATE] });
    const chip = chips()[0];
    if (chip === undefined) throw new Error("Missing chip");
    expect(chip.textContent?.trim()).toBe("Activate");
    expect(chip.getAttribute("title")).toBe(ACTIVATE.label);
    expect(chip.getAttribute("aria-label")).toBe(ACTIVATE.label);
    expect(screen.getByRole("button", { name: ACTIVATE.label })).toBe(chip);
  });

  it("excludes inspect and close entries", () => {
    renderChips();
    for (const chip of chips())
      expect(chip.textContent ?? "").not.toMatch(/inspect|close/i);
    expect(screen.queryByRole("button", { name: /inspect|close/i })).toBeNull();
  });

  it("reports the chosen choice once", async () => {
    const user = userEvent.setup();
    const { onchoose } = renderChips();
    const chip = chips()[0];
    if (chip === undefined) throw new Error("Missing chip");
    await user.click(chip);
    expect(onchoose).toHaveBeenCalledTimes(1);
    expect(onchoose).toHaveBeenCalledWith(ACTIVATE);
  });

  it("moves between chips with arrow keys", async () => {
    const user = userEvent.setup();
    renderChips();
    const [first, second] = chips();
    if (first === undefined || second === undefined)
      throw new Error("Missing chips");
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(second);
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    const { ondismiss } = renderChips();
    const chip = chips()[0];
    if (chip === undefined) throw new Error("Missing chip");
    chip.focus();
    await user.keyboard("{Escape}");
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it("disables every chip while a response is pending", () => {
    renderChips({ disabled: true });
    expect(chips()).toHaveLength(2);
    for (const chip of chips()) expect(chip.disabled).toBe(true);
  });

  it("does not emit a choice from a disabled chip", async () => {
    const user = userEvent.setup();
    const { onchoose } = renderChips({ disabled: true });

    await user.click(chips()[0]!);

    expect(onchoose).not.toHaveBeenCalled();
  });

  it("renders list actions plus local Details without fabricating a choice", async () => {
    const onchoose = vi.fn();
    const ondetails = vi.fn();
    render(CardActionChips, {
      cardId: "card-1",
      cardLabel: "Mystical Space Typhoon",
      choices: [ACTIVATE],
      variant: "list",
      ondetails,
      onchoose,
      ondismiss: vi.fn(),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: ACTIVATE.label }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(onchoose).toHaveBeenCalledWith(ACTIVATE);
    expect(ondetails).toHaveBeenCalledOnce();
    expect(onchoose).toHaveBeenCalledOnce();
  });

  it("renders local action chips after prompt chips and fires onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onchoose = vi.fn();
    render(CardActionChips, {
      cardId: "card-1",
      cardLabel: "Xyz host",
      choices: [ACTIVATE],
      localActions: [{ id: "materials", label: "Materials", onSelect }],
      onchoose,
      ondismiss: vi.fn(),
    });

    const rendered = chips();
    expect(rendered).toHaveLength(2);
    const local = rendered[1];
    if (local === undefined) throw new Error("Missing local chip");
    expect(local.dataset.cy).toBe("card-action-chip-local-materials");
    expect(local.classList.contains("card-action-chip--local")).toBe(true);
    expect(local.textContent?.trim()).toBe("Materials");

    await user.click(local);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onchoose).not.toHaveBeenCalled();
  });

  /* An empty pill is still a hover target and still paints: the component has
     to mount nothing at all when it has nothing to show. */
  it("renders nothing when there are no prompt choices and no local actions", () => {
    render(CardActionChips, {
      cardId: "card-1",
      cardLabel: "Xyz host",
      choices: [],
      localActions: [],
      variant: "field",
      onchoose: vi.fn(),
      ondismiss: vi.fn(),
    });

    expect(document.querySelector(".card-action-chips")).toBeNull();
  });

  it("focuses the first chip through the instance binding", async () => {
    const { rendered } = renderChips();
    (
      rendered.component as unknown as { focusFirstChip: () => void }
    ).focusFirstChip();
    await waitFor(() => expect(document.activeElement).toBe(chips()[0]));
  });
});
