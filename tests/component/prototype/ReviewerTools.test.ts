// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialPrototypeState } from "../../../src/prototype/model/prototype-state.ts";
import ReviewDrawer from "../../../src/prototype/review/ReviewDrawer.svelte";
import { REVIEW_PRESETS } from "../../../src/prototype/review/review-presets.ts";
import ReviewLauncher from "../../../src/prototype/review/ReviewLauncher.svelte";

afterEach(() => cleanup());

describe("reviewer tools", () => {
  it("opens every screen jump within second action", async () => {
    const onjump = vi.fn();
    render(ReviewLauncher, { onjump });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Jump to screen or state" }));
    for (const name of [
      "Title",
      "Load",
      "Narrative",
      "Map",
      "Pre-battle",
      "Battle mock",
      "Outcome",
      "Reward",
      "End",
    ])
      expect(
        screen.getByRole("button", { name: `Jump to ${name}` }),
      ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Jump to Map" }));
    expect(onjump).toHaveBeenCalledWith("map");
  });

  it("exposes choice/map/battle/assets/storage/motion controls, reset, JSON, and separate reviewer chrome", async () => {
    const onchange = vi.fn();
    const onreset = vi.fn();
    render(ReviewDrawer, {
      state: createInitialPrototypeState(),
      onchange,
      onreset,
    });
    expect(
      screen.getByRole("complementary", { name: "Reviewer tools" }),
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reviewer tools" }));
    expect(
      screen.getByLabelText("State matrix preset").querySelectorAll("option"),
    ).toHaveLength(REVIEW_PRESETS.length + 1);
    for (const label of ["Choice result", "Map state", "Battle result"])
      expect(screen.getByLabelText(label)).toBeTruthy();
    for (const text of [
      "available",
      "locked",
      "hidden",
      "completed",
      "available-completed",
    ])
      expect(screen.getByLabelText("Map state").textContent).toContain(text);
    expect(screen.getByLabelText("Missing asset preview")).toBeTruthy();
    expect(screen.getByLabelText("Storage failure preview")).toBeTruthy();
    expect(screen.getByLabelText("Reduced motion preview")).toBeTruthy();
    expect(screen.getByText(/"screen": "launcher"/)).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("State matrix preset"),
      "history-empty",
    );
    expect(onchange).toHaveBeenCalledWith("preset", "history-empty");
    await user.selectOptions(screen.getByLabelText("Jump to screen"), "reward");
    expect(onchange).toHaveBeenCalledWith("screen", "reward");
    await user.selectOptions(
      screen.getByLabelText("Choice result"),
      "challenge-rin",
    );
    expect(onchange).toHaveBeenCalledWith("choice", "challenge-rin");
    await user.selectOptions(
      screen.getByLabelText("Map state"),
      "available-completed",
    );
    expect(onchange).toHaveBeenCalledWith("map", "available-completed");
    await user.selectOptions(screen.getByLabelText("Battle result"), "failure");
    expect(onchange).toHaveBeenCalledWith("outcome", "failure");
    await user.click(screen.getByLabelText("Missing asset preview"));
    await user.click(screen.getByLabelText("Storage failure preview"));
    await user.click(screen.getByLabelText("Reduced motion preview"));
    expect(onchange).toHaveBeenCalledWith("missingAssets", true);
    expect(onchange).toHaveBeenCalledWith("storageFailure", true);
    expect(onchange).toHaveBeenCalledWith("reducedMotion", true);
    await user.click(screen.getByRole("button", { name: "Reset prototype" }));
    expect(onreset).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Copy review link" }),
    ).toBeTruthy();
  });

  it("copies bounded reviewer link and updates URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    render(ReviewDrawer, {
      state: createInitialPrototypeState(),
      copyText: writeText,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reviewer tools" }));
    await user.click(screen.getByRole("button", { name: "Copy review link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("?screen=launcher"),
      ),
    );
    expect(globalThis.location.search).toBe("?screen=launcher");
    expect(screen.getByRole("status").textContent).toMatch(/copied/i);
    history.replaceState(null, "", "/");
  });
});
