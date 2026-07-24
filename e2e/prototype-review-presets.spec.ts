import { expect, test, type Page } from "@playwright/test";
import {
  REVIEW_PRESETS,
  type ReviewPreset,
} from "../src/prototype/review/review-presets.ts";

const EXPECTED_PRESET_IDS = [
  "launcher-fresh",
  "launcher-progress",
  "title-new",
  "title-continue",
  "load-standard",
  "load-corrupt",
  "narrative-narration",
  "narrative-dialogue",
  "narrative-thought",
  "narrative-two-characters",
  "narrative-long",
  "narrative-missing",
  "choice-default",
  "choice-resolved",
  "history-empty",
  "history-entries",
  "settings-default",
  "settings-changed",
  "settings-reset",
  "settings-audio",
  "map-available",
  "map-locked",
  "map-hidden",
  "map-completed",
  "map-available-completed",
  "prebattle-ready",
  "battle-ready",
  "battle-win",
  "battle-loss",
  "battle-abort",
  "battle-failure",
  "outcome-win",
  "outcome-loss",
  "outcome-recovery",
  "reward-new",
  "reward-acknowledged",
  "save-idle",
  "save-saving",
  "save-success",
  "save-overwrite",
  "save-failure",
  "motion-default",
  "motion-reduced",
] as const;

test("review preset inventory remains complete", () => {
  expect(REVIEW_PRESETS.map(([id]) => id)).toEqual(EXPECTED_PRESET_IDS);
});

for (const [preset, label] of REVIEW_PRESETS) {
  test(`review preset: ${label}`, async ({ page }) => {
    await page.goto("./prototype.html");
    await page.getByRole("button", { name: "Reviewer tools" }).click();
    await page.getByLabel("State matrix preset").selectOption(preset);
    await assertPreset(page, preset);
  });
}

async function assertPreset(page: Page, preset: ReviewPreset): Promise<void> {
  if (preset.startsWith("launcher-")) {
    await expect(
      page.getByRole("heading", { name: "Visual novel prototype" }),
    ).toBeVisible();
    await expect(page.getByText(/Mock progress available/)).toHaveCount(
      preset === "launcher-progress" ? 1 : 0,
    );
    return;
  }
  if (preset.startsWith("title-")) {
    await expect(
      page.getByRole("heading", { name: "Echoes of the Draw" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(
      preset === "title-continue" ? 1 : 0,
    );
    return;
  }
  if (preset.startsWith("load-")) {
    await expect(page.getByRole("heading", { name: "Load" })).toBeVisible();
    await expect(page.getByText(/incompatible or corrupt/i)).toHaveCount(
      preset === "load-corrupt" ? 1 : 0,
    );
    return;
  }
  const narrativeText: Partial<Record<ReviewPreset, RegExp>> = {
    "narrative-narration": /Rain turned/,
    "narrative-dialogue": /You came/,
    "narrative-thought": /Rin said midnight/,
    "narrative-two-characters": /Or run/,
    "narrative-long": /complete duel/,
  };
  if (preset in narrativeText) {
    await expect(page.getByText(narrativeText[preset]!)).toBeVisible();
    return;
  }
  if (preset === "narrative-missing") {
    await expect(
      page.getByRole("img", { name: /Missing character art/ }),
    ).toBeVisible();
    return;
  }
  if (preset === "choice-default" || preset === "choice-resolved") {
    await expect(
      preset === "choice-default"
        ? page.getByRole("heading", { name: "Choose your response" })
        : page.getByRole("status").filter({ hasText: /earn that trust/ }),
    ).toBeVisible();
    return;
  }
  if (preset.startsWith("history-")) {
    const dialog = page.getByRole("dialog", { name: "Dialogue history" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(
      preset === "history-empty" ? 0 : 6,
    );
    return;
  }
  if (preset.startsWith("settings-")) {
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    const expected = preset
      .slice("settings-".length)
      .replace("audio", "audio unavailable");
    await expect(page.getByText(`Reviewer state: ${expected}`)).toBeVisible();
    return;
  }
  if (preset.startsWith("map-")) {
    await expect(
      page.getByRole("heading", { name: "City signal map" }),
    ).toBeVisible();
    const oldArena = page
      .getByLabel("Location list")
      .getByRole("button", { name: /Old Arena/ });
    if (preset === "map-hidden") await expect(oldArena).toHaveCount(0);
    else {
      await expect(oldArena).toBeVisible();
      if (preset.includes("completed"))
        await expect(oldArena).toHaveAccessibleName(/completed/);
      if (preset === "map-locked" || preset === "map-completed")
        await expect(oldArena).toHaveAttribute("aria-disabled", "true");
      else {
        await expect(oldArena).toHaveAttribute("aria-disabled", "false");
        await expect(oldArena).toHaveAccessibleName(/available/);
      }
    }
    return;
  }
  if (preset === "prebattle-ready") {
    await expect(
      page.getByRole("heading", { name: "Rin's Echo" }),
    ).toBeVisible();
    return;
  }
  if (preset.startsWith("battle-")) {
    await expect(
      page.getByRole("heading", {
        name: "Existing duel experience placeholder",
      }),
    ).toBeVisible();
    if (preset === "battle-ready")
      await expect(page.getByRole("status")).toHaveCount(0);
    else {
      const expected: Record<string, RegExp> = {
        "battle-win": /Player win normalized/,
        "battle-loss": /Player loss normalized/,
        "battle-abort": /No progression granted/,
        "battle-failure": /not a story defeat/,
      };
      await expect(page.getByRole("status")).toContainText(expected[preset]!);
      if (preset === "battle-abort" || preset === "battle-failure") {
        await expect(
          page.getByRole("button", { name: "Retry mock duel" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Return to map" }),
        ).toBeVisible();
      }
    }
    return;
  }
  if (preset.startsWith("outcome-")) {
    const heading =
      preset === "outcome-win"
        ? "Signal broken"
        : preset === "outcome-loss"
          ? "Signal endures"
          : "Connection interrupted";
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    return;
  }
  if (preset === "reward-new") {
    await expect(
      page.getByRole("heading", { name: "Signal Cipher" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Autosave complete at stable story boundary/),
    ).toBeVisible();
    return;
  }
  if (preset === "reward-acknowledged") {
    await expect(page.getByText(/Archive available/)).toBeVisible();
    return;
  }
  if (preset.startsWith("save-")) {
    await expect(
      page.getByRole("dialog", { name: "Save and load" }),
    ).toBeVisible();
    const expected: Record<string, RegExp> = {
      "save-idle": /Save to manual slot/,
      "save-saving": /Saving prototype state/,
      "save-success": /Save complete/,
      "save-overwrite": /Overwrite manual slot/,
      "save-failure": /Storage unavailable/,
    };
    await expect(page.getByText(expected[preset]!)).toBeVisible();
    return;
  }
  await expect(page.getByTestId("narrative-stage")).toBeVisible();
  await expect(page.locator(".prototype-app")).toHaveClass(
    preset === "motion-reduced"
      ? /force-reduced-motion/
      : /^(?!.*force-reduced-motion)/,
  );
}
