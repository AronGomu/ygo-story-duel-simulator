// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
  type ChoiceId,
} from "../../src/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
  PromptKind,
} from "../../src/duel/contracts/player-prompt.ts";
import PromptControls from "../../src/app/prompts/PromptControls.svelte";

afterEach(() => cleanup());

function choice(
  id: string,
  label: string,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return {
    id: choiceId(id),
    label,
    action: "select",
    ...overrides,
  };
}

function prompt(
  kind: PromptKind,
  overrides: Partial<PlayerPrompt> = {},
): PlayerPrompt {
  return {
    id: promptId(`${kind}-component-prompt`),
    kind,
    player: 0,
    title: `Test ${kind}`,
    choices: [choice("first", "First"), choice("second", "Second")],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
    ...overrides,
  };
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("PromptControls", () => {
  it("submits a single keyboard choice once and disables every active control", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("yesNo", {
        choices: [
          choice("yes", "Yes", { action: "yes" }),
          choice("no", "No", { action: "no" }),
        ],
      }),
      onsubmit,
    });

    const yes = button("Yes");
    yes.focus();
    await user.keyboard("{Enter}{Enter}");

    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(onsubmit).toHaveBeenCalledWith([choiceId("yes")]);
    expect(yes.disabled).toBe(true);
    expect(button("No").disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Response sent");
  });

  it("accepts field-selection intent through the Svelte control layer and renders card art", async () => {
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => boolean>(
      () => true,
    );
    const value = prompt("selectCard", {
      choices: [
        choice("card", "Select card", {
          card: {
            instanceId: cardInstanceId("field-card"),
            code: cardCode(97590747),
            controller: 0,
            location: "monster",
            sequence: 0,
            position: "faceUpAttack",
          },
        }),
      ],
    });
    const rendered = render(PromptControls, {
      prompt: value,
      disabled: false,
      onsubmit,
      choiceIntent: null,
      resolveCardImage: () => "https://example.test/card.jpg",
    });
    await userEvent.setup().click(screen.getByText(/Inspect/));
    expect(
      screen.getByRole("img", { name: "Card 97590747" }).getAttribute("src"),
    ).toBe("https://example.test/card.jpg");

    await rendered.rerender({
      choiceIntent: { id: choiceId("card"), nonce: 1 },
    });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
    await userEvent.setup().click(button("Confirm selection"));
    expect(onsubmit).toHaveBeenCalledWith(["card"]);
  });

  it("re-enables the same prompt after a recoverable response rejection", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => boolean>(
      () => true,
    );
    const value = prompt("yesNo", {
      choices: [
        choice("yes", "Yes", { action: "yes" }),
        choice("no", "No", { action: "no" }),
      ],
    });
    const rendered = render(PromptControls, {
      prompt: value,
      disabled: false,
      onsubmit,
    });

    await user.click(button("Yes"));
    expect(button("No").disabled).toBe(true);
    await rendered.rerender({ disabled: true });
    await rendered.rerender({ disabled: false });
    await waitFor(() => expect(button("No").disabled).toBe(false));
    await user.click(button("No"));
    expect(onsubmit).toHaveBeenCalledTimes(2);
  });

  it("enforces multi-card bounds and supports explicit cancellation", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("selectCard", {
        choices: [
          choice("one", "Card one"),
          choice("two", "Card two"),
          choice("three", "Card three"),
        ],
        minimum: 2,
        maximum: 3,
        cancelable: true,
      }),
      onsubmit,
    });

    const confirm = button("Confirm selection");
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Card one" }));
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Card two" }));
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(onsubmit).toHaveBeenCalledWith([choiceId("one"), choiceId("two")]);
  });

  it("shows exact-sum and mandatory constraints and permits an alternative contribution", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("selectSum", {
        choices: [
          choice("sum-card", "Sum card", {
            card: {
              instanceId: cardInstanceId("sum-card-instance"),
              code: cardCode(97590747),
              name: "La Jinn",
              description: "A mystical genie.",
              controller: 0,
              location: "hand",
              sequence: 0,
              contribution: 2,
              alternativeContribution: 3,
            },
          }),
        ],
        minimum: 1,
        maximum: 1,
        requiredTotal: 4,
        sumMode: "exact",
        mandatoryContributions: [{ contribution: 1 }],
      }),
      onsubmit,
    });

    expect(screen.getByText(/total exactly 4/i)).toBeTruthy();
    expect(screen.getByText(/Mandatory contributions: 1/i)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /Sum card/i }));
    expect(button("Confirm selection").disabled).toBe(false);
    await user.click(button("Confirm selection"));
    expect(onsubmit).toHaveBeenCalledWith([choiceId("sum-card")]);
  });

  it("renders iterative select/unselect state without auto-answering", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("selectUnselectCard", {
        choices: [
          choice("toggle", "La Jinn", {
            selected: true,
            card: {
              instanceId: cardInstanceId("toggle-card"),
              controller: 0,
              location: "monster",
              sequence: 0,
            },
          }),
          choice("finish", "Finish", { action: "finish" }),
        ],
      }),
      onsubmit,
    });

    expect(onsubmit).not.toHaveBeenCalled();
    expect(button(/La Jinn/).getAttribute("aria-pressed")).toBe("true");
    await user.click(button("Finish"));
    expect(onsubmit).toHaveBeenCalledWith([choiceId("finish")]);
  });

  it("allows keyboard-accessible reordering and submits every item exactly once", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("sortCard", {
        choices: [choice("one", "One"), choice("two", "Two")],
        minimum: 2,
        maximum: 2,
        ordered: true,
        cancelable: true,
      }),
      onsubmit,
    });

    const moveDown = button("Move One down");
    moveDown.focus();
    await user.keyboard("{Enter}");
    await user.click(button("Confirm order"));
    expect(onsubmit).toHaveBeenCalledWith([choiceId("two"), choiceId("one")]);
  });

  it("bounds counter allocation by each explicit capacity", async () => {
    const user = userEvent.setup();
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    render(PromptControls, {
      prompt: prompt("selectCounter", {
        choices: [
          choice("one", "First card", { allocationMaximum: 2 }),
          choice("two", "Second card", { allocationMaximum: 1 }),
        ],
        minimum: 3,
        maximum: 3,
      }),
      onsubmit,
    });

    await user.click(button("Add one counter to First card"));
    await user.click(button("Add one counter to First card"));
    expect(button("Add one counter to First card").disabled).toBe(true);
    await user.click(button("Add one counter to Second card"));
    expect(button("Confirm allocation").disabled).toBe(false);
    await user.click(button("Confirm allocation"));
    expect(onsubmit).toHaveBeenCalledWith([
      choiceId("one"),
      choiceId("one"),
      choiceId("two"),
    ]);
  });

  it("provides effect-text inspection from public prompt data", async () => {
    const user = userEvent.setup();
    render(PromptControls, {
      prompt: prompt("effectYesNo", {
        contextCard: {
          instanceId: cardInstanceId("effect-card"),
          code: cardCode(97590747),
          name: "La Jinn",
          description: "A mystical genie with great power.",
          controller: 0,
          location: "monster",
          sequence: 0,
        },
        choices: [
          choice("yes", "Yes", { action: "yes" }),
          choice("no", "No", { action: "no" }),
        ],
      }),
      onsubmit: vi.fn(),
    });

    await user.click(screen.getByText("Inspect La Jinn"));
    expect(screen.getByText("A mystical genie with great power.")).toBeTruthy();
  });

  it("restores focus to the heading when a new prompt replaces the old one", async () => {
    const onsubmit = vi.fn<(choiceIds: readonly ChoiceId[]) => void>();
    const rendered = render(PromptControls, {
      prompt: prompt("option", { title: "First prompt" }),
      onsubmit,
    });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("First prompt"),
    );

    await rendered.rerender({
      prompt: prompt("announceNumber", {
        id: promptId("replacement-prompt"),
        title: "Replacement prompt",
      }),
    });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain(
        "Replacement prompt",
      ),
    );
  });
});
