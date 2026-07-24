// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import HistoryOverlay from "../../../src/prototype/overlays/HistoryOverlay.svelte";
import PauseOverlay from "../../../src/prototype/overlays/PauseOverlay.svelte";
import SaveLoadOverlay from "../../../src/prototype/overlays/SaveLoadOverlay.svelte";
import SettingsOverlay from "../../../src/prototype/overlays/SettingsOverlay.svelte";

afterEach(() => cleanup());

describe("prototype utility overlays", () => {
  it("shows ordered history and empty state", () => {
    const rendered = render(HistoryOverlay, {
      entries: [
        { speaker: "Rin", text: "First" },
        { speaker: "Kael", text: "Second" },
      ],
    });
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["RinFirst", "KaelSecond"]);
    rendered.unmount();
    render(HistoryOverlay, { entries: [] });
    expect(screen.getByText(/No dialogue in this scene yet/)).toBeTruthy();
  });

  it("changes and resets settings while audio remains disabled", async () => {
    render(SettingsOverlay);
    const textSpeed = screen.getByLabelText("Text speed") as HTMLInputElement;
    await userEvent.setup().clear(textSpeed);
    await userEvent.setup().type(textSpeed, "80");
    expect(textSpeed.value).toBe("80");
    const autoSpeed = screen.getByLabelText("Auto speed") as HTMLInputElement;
    const transitions = screen.getByLabelText(
      "Transitions",
    ) as HTMLSelectElement;
    await fireEvent.input(autoSpeed, { target: { value: "7" } });
    await userEvent.setup().selectOptions(transitions, "off");
    expect(autoSpeed.value).toBe("7");
    expect(transitions.value).toBe("off");
    expect(
      (screen.getByLabelText("Music volume") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Audio not included/)).toBeTruthy();
    expect(screen.getByText(/Fullscreen (supported|unavailable)/)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reset settings" }));
    expect(textSpeed.value).toBe("40");
    expect(autoSpeed.value).toBe("3");
    expect(transitions.value).toBe("standard");
  });

  it("Escape closes top overlay and restores invoking control", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open history";
    document.body.append(trigger);
    trigger.focus();
    const onclose = vi.fn();
    render(HistoryOverlay, { onclose, restoreFocusTo: trigger });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onclose).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("pause offers expected actions and confirms unsaved return", async () => {
    const onaction = vi.fn();
    render(PauseOverlay, { unsaved: true, onaction });
    for (const name of [
      "Resume",
      "Save",
      "Load",
      "Settings",
      "Return to Title",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    const user = userEvent.setup();
    for (const [button, action] of [
      ["Resume", "resume"],
      ["Save", "save"],
      ["Load", "load"],
      ["Settings", "settings"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: button }));
      expect(onaction).toHaveBeenCalledWith(action);
    }
    await user.click(screen.getByRole("button", { name: "Return to Title" }));
    expect(
      screen.getByRole("alertdialog", { name: "Return without saving?" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Stay in story" }));
    expect(onaction).not.toHaveBeenCalledWith("title");
    await user.click(screen.getByRole("button", { name: "Return to Title" }));
    await user.click(
      screen.getByRole("button", { name: "Return without saving" }),
    );
    expect(onaction).toHaveBeenCalledWith("title");
  });

  it.each(["success", "overwrite", "failure"] as const)(
    "exposes %s save feedback",
    async (mode) => {
      render(SaveLoadOverlay, { mode });
      expect(
        screen.getByRole("dialog", { name: /Save and load/ }),
      ).toBeTruthy();
      if (mode === "success")
        expect(screen.getByText(/Save complete/)).toBeTruthy();
      if (mode === "overwrite")
        expect(screen.getByText(/Overwrite manual slot/)).toBeTruthy();
      if (mode === "failure") {
        expect(screen.getByText(/Storage unavailable/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "Continue Without Saving" }),
        ).toBeTruthy();
      }
      expect(screen.getByText(/Auto and Skip are experimental/)).toBeTruthy();
    },
  );
});
