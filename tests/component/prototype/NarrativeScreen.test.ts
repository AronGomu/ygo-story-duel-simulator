// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROLOGUE } from "../../../src/prototype/content/prologue.ts";
import NarrativeScreen from "../../../src/prototype/screens/NarrativeScreen.svelte";

afterEach(() => cleanup());

describe("NarrativeScreen", () => {
  it("renders narration, dialogue, thought, compositions, expression, exit, background, and full wrapped text", async () => {
    const rendered = render(NarrativeScreen, { beat: PROLOGUE.beats[0]! });
    expect(screen.getByText(/Rain turned/)).toBeTruthy();
    await rendered.rerender({ beat: PROLOGUE.beats[2]! });
    expect(screen.getByText("Rin")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Rin neutral/i })).toBeTruthy();
    await rendered.rerender({ beat: PROLOGUE.beats[9]! });
    expect(
      within(screen.getByLabelText("Characters present")).getAllByRole("img"),
    ).toHaveLength(2);
    await rendered.rerender({ beat: PROLOGUE.beats[8]! });
    expect(screen.getByRole("img", { name: /Rin smile/i })).toBeTruthy();
    await rendered.rerender({ beat: PROLOGUE.beats[21]! });
    expect(screen.getByText(/complete duel/)).toBeTruthy();
    expect(
      screen
        .getByTestId("narrative-background")
        .getAttribute("data-background"),
    ).toBe("arena");
    await rendered.rerender({ beat: PROLOGUE.beats[1]! });
    expect(
      screen
        .getByText("Protagonist")
        .closest("article")
        ?.getAttribute("data-kind"),
    ).toBe("thought");
  });

  it("advances once from Enter, Space, and scene click while controls block global advance", async () => {
    const onadvance = vi.fn();
    render(NarrativeScreen, { beat: PROLOGUE.beats[0]!, onadvance });
    await fireEvent.keyDown(window, { key: "Enter", repeat: false });
    await fireEvent.keyDown(window, { key: "Enter", repeat: true });
    await fireEvent.keyDown(window, { key: " " });
    await userEvent.setup().click(screen.getByTestId("narrative-stage"));
    expect(onadvance).toHaveBeenCalledTimes(3);
    onadvance.mockClear();
    await userEvent.setup().dblClick(screen.getByTestId("narrative-stage"));
    expect(onadvance).toHaveBeenCalledTimes(1);
    const history = screen.getByRole("button", { name: "History" });
    history.focus();
    await fireEvent.keyDown(history, { key: "Enter" });
    expect(onadvance).toHaveBeenCalledTimes(1);
  });

  it("renders semantic choices without prior advance selecting one", async () => {
    const onchoose = vi.fn();
    const onadvance = vi.fn();
    render(NarrativeScreen, {
      beat: PROLOGUE.beats[13]!,
      choices: PROLOGUE.choices,
      onchoose,
      onadvance,
    });
    const first = screen.getByRole("button", { name: /I trust you/ });
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(first.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.keyDown(window, { key: "Enter" });
    await userEvent.setup().click(screen.getByTestId("narrative-stage"));
    expect(onadvance).not.toHaveBeenCalled();
    await userEvent.setup().click(first);
    expect(onchoose).toHaveBeenCalledWith("trust-rin");
  });

  it("hides and restores UI without mutating cursor and shows asset fallback", async () => {
    const onadvance = vi.fn();
    render(NarrativeScreen, {
      beat: PROLOGUE.beats[2]!,
      narrativeIndex: 7,
      missingAssets: true,
      onadvance,
    });
    expect(
      screen.getByRole("img", { name: /Missing character art/i }),
    ).toBeTruthy();
    expect(
      screen.getByTestId("narrative-background").getAttribute("data-fallback"),
    ).toBe("true");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Hide UI" }));
    expect(screen.queryByText(/You came/)).toBeNull();
    await fireEvent.keyDown(window, { key: "Enter" });
    await userEvent.setup().click(screen.getByTestId("narrative-stage"));
    expect(onadvance).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show UI" }));
    expect(screen.getByTestId("narrative-cursor").textContent).toContain("8");
    expect(screen.getByText(/You came/).getAttribute("aria-live")).toBe("off");
  });
});
