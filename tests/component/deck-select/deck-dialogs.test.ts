// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeleteDeckConfirm from "../../../src/deck-select/DeleteDeckConfirm.svelte";
import RenameDeckDialog from "../../../src/deck-select/RenameDeckDialog.svelte";

afterEach(() => cleanup());

function cy(value: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-cy="${value}"]`);
  if (element === null) throw new Error(`No element with data-cy "${value}"`);
  return element;
}

describe("RenameDeckDialog", () => {
  it("is a modal dialog prefilled with the deck name", () => {
    render(RenameDeckDialog, { deckName: "Blue Fleet" });

    const dialog = cy("deck-select-rename-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const input = cy("deck-select-rename-input") as HTMLInputElement;
    expect(input.value).toBe("Blue Fleet");
    expect(input.maxLength).toBe(64);
  });

  it("submits the trimmed name", async () => {
    const onsubmit = vi.fn();
    render(RenameDeckDialog, { deckName: "Blue Fleet", onsubmit });
    const user = userEvent.setup();

    const input = cy("deck-select-rename-input");
    await user.clear(input);
    await user.type(input, " New Name ");
    await user.click(cy("deck-select-rename-submit"));

    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(onsubmit).toHaveBeenCalledWith("New Name");
  });

  it("rejects exact duplicate names before callback", async () => {
    const onsubmit = vi.fn();
    render(RenameDeckDialog, {
      deckName: "Blue Fleet",
      unavailableNames: ["Alpha"],
      onsubmit,
    });
    const user = userEvent.setup();
    const input = cy("deck-select-rename-input") as HTMLInputElement;

    await user.clear(input);
    await user.type(input, " Alpha ");

    const error = cy("deck-select-rename-error");
    const submit = cy("deck-select-rename-submit") as HTMLButtonElement;
    expect(error.textContent).toBe("A deck with this name already exists.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      "deck-select-rename-error",
    );
    expect(submit.disabled).toBe(true);

    await user.click(submit);
    await fireEvent.submit(cy("deck-select-rename-form"));
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it("allows case variants and own unchanged name", async () => {
    const variantSubmit = vi.fn();
    const variant = render(RenameDeckDialog, {
      deckName: "Blue Fleet",
      unavailableNames: ["Alpha"],
      onsubmit: variantSubmit,
    });
    const user = userEvent.setup();
    const variantInput = cy("deck-select-rename-input");
    await user.clear(variantInput);
    await user.type(variantInput, "alpha");
    await user.click(cy("deck-select-rename-submit"));
    expect(variantSubmit).toHaveBeenCalledWith("alpha");
    variant.unmount();

    const ownSubmit = vi.fn();
    render(RenameDeckDialog, {
      deckName: "Alpha",
      unavailableNames: [],
      onsubmit: ownSubmit,
    });
    await user.click(cy("deck-select-rename-submit"));
    expect(ownSubmit).toHaveBeenCalledWith("Alpha");
  });

  it("submit is disabled while the trimmed name is empty", async () => {
    render(RenameDeckDialog, { deckName: "Blue Fleet" });
    const submit = cy("deck-select-rename-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    const user = userEvent.setup();
    await user.clear(cy("deck-select-rename-input"));
    expect(submit.disabled).toBe(true);

    await user.type(cy("deck-select-rename-input"), "   ");
    expect(submit.disabled).toBe(true);
  });

  it("cancel and Escape both cancel without submitting", async () => {
    const oncancel = vi.fn();
    const onsubmit = vi.fn();
    const { unmount } = render(RenameDeckDialog, {
      deckName: "Blue Fleet",
      oncancel,
      onsubmit,
    });

    await userEvent.setup().click(cy("deck-select-rename-cancel"));
    expect(oncancel).toHaveBeenCalledTimes(1);
    unmount();

    render(RenameDeckDialog, { deckName: "Blue Fleet", oncancel, onsubmit });
    await fireEvent.keyDown(cy("deck-select-rename-dialog"), { key: "Escape" });

    expect(oncancel).toHaveBeenCalledTimes(2);
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it("honours a shorter maxLength", () => {
    render(RenameDeckDialog, { deckName: "Blue Fleet", maxLength: 12 });
    expect((cy("deck-select-rename-input") as HTMLInputElement).maxLength).toBe(
      12,
    );
  });
});

describe("DeleteDeckConfirm", () => {
  it("names the deck and confirms", async () => {
    const onconfirm = vi.fn();
    render(DeleteDeckConfirm, { deckName: "Blue Fleet", onconfirm });

    expect(cy("deck-select-delete-confirm").textContent).toContain(
      "Blue Fleet",
    );
    await userEvent.setup().click(cy("deck-select-delete-confirm-button"));

    expect(onconfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel and Escape both cancel without confirming", async () => {
    const oncancel = vi.fn();
    const onconfirm = vi.fn();
    const { unmount } = render(DeleteDeckConfirm, {
      deckName: "Blue Fleet",
      oncancel,
      onconfirm,
    });

    await userEvent.setup().click(cy("deck-select-delete-cancel"));
    expect(oncancel).toHaveBeenCalledTimes(1);
    unmount();

    render(DeleteDeckConfirm, { deckName: "Blue Fleet", oncancel, onconfirm });
    await fireEvent.keyDown(cy("deck-select-delete-confirm"), {
      key: "Escape",
    });

    expect(oncancel).toHaveBeenCalledTimes(2);
    expect(onconfirm).not.toHaveBeenCalled();
  });
});
