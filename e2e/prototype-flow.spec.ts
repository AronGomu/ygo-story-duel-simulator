import { expect, test, type Page } from "@playwright/test";

async function reachChoice(page: Page): Promise<void> {
  await page.goto("./prototype.html");
  await page.getByRole("button", { name: "Start full flow" }).click();
  await page.getByRole("button", { name: "New Game" }).click();
  for (let index = 0; index < 13; index += 1)
    await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Choose your response" }),
  ).toBeVisible();
}

test("full flow reaches updated map, save, and end", async ({ page }) => {
  await reachChoice(page);
  await page.getByRole("button", { name: /I trust you/ }).click();
  await expect(page.getByText(/earn that trust/)).toBeVisible();
  for (let index = 0; index < 17; index += 1)
    await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "City signal map" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Earlier choice:.*remembers your trust/),
  ).toBeVisible();
  await page
    .getByLabel("Location list")
    .getByRole("button", { name: /Old Arena/ })
    .click();
  await expect(page.getByRole("heading", { name: "Rin's Echo" })).toBeVisible();
  await page.getByRole("button", { name: "Start Duel" }).click();
  await page.getByRole("button", { name: "Simulate Player Win" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal broken" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue story" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal Cipher" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to updated map" }).click();
  await expect(page.getByText(/Archive available/)).toBeVisible();
  await page.getByRole("button", { name: "Save progress" }).click();
  await page.getByRole("button", { name: "Confirm overwrite" }).click();
  await expect(page.getByText(/Save complete/)).toBeVisible();
  await page.getByRole("button", { name: "Close Save and load" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Visual novel prototype" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start full flow" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Archive available/)).toBeVisible();
  await page.getByRole("button", { name: "End prototype" }).click();
  await expect(
    page.getByRole("heading", { name: "Prototype complete" }),
  ).toBeVisible();
});

test("autosave persists reward independently and retries after simulated failure", async ({
  page,
}) => {
  await page.goto("./prototype.html?screen=battle-mock");
  await page.getByRole("button", { name: "Simulate Player Win" }).click();
  await page.getByRole("button", { name: "Continue story" }).click();
  await expect(page.getByText(/Autosave complete/)).toBeVisible();
  await page.goto("./prototype.html");
  await page.getByRole("button", { name: "Start full flow" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal Cipher" }),
  ).toBeVisible();

  await page.goto("./prototype.html?screen=battle-mock&storage=1");
  await page.getByRole("button", { name: "Simulate Player Win" }).click();
  await page.getByRole("button", { name: "Continue story" }).click();
  await expect(page.getByText(/Autosave failed/)).toBeVisible();
  await page.getByRole("button", { name: "Reviewer tools" }).click();
  await page.getByLabel("Storage failure preview").uncheck();
  await page.getByRole("button", { name: "Retry autosave" }).click();
  await expect(page.getByText(/Autosave complete/)).toBeVisible();
});

test("manual delete removes only manual progress across reload", async ({
  page,
}) => {
  await page.goto("./prototype.html?screen=narrative");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save to manual slot 1" }).click();
  await expect(page.getByText(/Save complete/)).toBeVisible();
  await page.getByRole("button", { name: "Close Save and load" }).click();
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Delete manual slot 1" }).click();
  await page.getByRole("button", { name: "Delete save" }).click();
  await expect(
    page.getByRole("heading", { name: "Manual slot 1 · Empty" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Load game" }).click();
  await page.goto("./prototype.html");
  await page.getByRole("button", { name: "Start full flow" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("Load path reaches narrative", async ({ page }) => {
  await page.goto("./prototype.html?screen=title");
  await page.getByRole("button", { name: "Load" }).click();
  await page.getByRole("button", { name: "Load manual slot 1" }).click();
  await expect(
    page.getByText(/At the arena, we listen before we answer/),
  ).toBeVisible();
});

test("loss reaches distinct outcome and continues", async ({ page }) => {
  await page.goto("./prototype.html?screen=battle-mock");
  await page.getByRole("button", { name: "Simulate Player Loss" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal endures" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue story" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal Cipher" }),
  ).toBeVisible();
});

for (const [result, heading] of [
  ["Abort", "Duel paused"],
  ["Technical Failure", "Connection interrupted"],
] as const) {
  test(`${result} offers recovery without reward`, async ({ page }) => {
    await page.goto("./prototype.html?screen=battle-mock");
    await page.getByRole("button", { name: `Simulate ${result}` }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry duel" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Return to map" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry duel" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Existing duel experience placeholder",
      }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.getByRole("button", { name: `Simulate ${result}` }).click();
    await page.getByRole("button", { name: "Return to map" }).click();
    await expect(
      page.getByRole("heading", { name: "City signal map" }),
    ).toBeVisible();
    await expect(page.getByText("Signal Cipher")).toHaveCount(0);
  });
}

test("hotspot and location list both reach briefing", async ({ page }) => {
  await page.goto("./prototype.html?screen=map");
  await page
    .getByLabel("Map hotspots")
    .getByRole("button", { name: /Old Arena/ })
    .click();
  await expect(page.getByRole("heading", { name: "Rin's Echo" })).toBeVisible();
  await page.goto("./prototype.html?screen=map");
  await page
    .getByLabel("Location list")
    .getByRole("button", { name: /Old Arena/ })
    .click();
  await expect(page.getByRole("heading", { name: "Rin's Echo" })).toBeVisible();
});

test("missing assets and save failure retain playable recovery", async ({
  page,
}) => {
  await page.goto("./prototype.html?screen=narrative&missing=1&storage=1");
  await expect(
    page.getByRole("img", { name: /Missing background art/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save to manual slot 1" }).click();
  await expect(page.getByText(/Storage unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Continue Without Saving" }).click();
  await expect(page.getByText(/Rain turned/)).toBeVisible();
});

test("reviewer presets expose matrix-only overlay and state variants", async ({
  page,
}) => {
  await page.goto("./prototype.html");
  await page.getByRole("button", { name: "Reviewer tools" }).click();
  const presets = page.getByLabel("State matrix preset");
  await presets.selectOption("history-empty");
  await expect(
    page.getByRole("dialog", { name: "Dialogue history" }),
  ).toBeVisible();
  await expect(page.getByText(/No dialogue in this scene yet/)).toBeVisible();
  await page.getByRole("button", { name: "Close Dialogue history" }).click();
  await presets.selectOption("settings-changed");
  await expect(page.getByLabel("Text speed")).toHaveValue("80");
  await expect(page.getByLabel("Transitions")).toHaveValue("off");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await presets.selectOption("save-saving");
  await expect(page.getByText(/Saving prototype state/)).toBeVisible();
  await page.getByRole("button", { name: "Close Save and load" }).click();
  await presets.selectOption("map-hidden");
  await expect(
    page.getByRole("heading", { name: "City signal map" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Location list").getByText("Old Arena"),
  ).toHaveCount(0);
  await presets.selectOption("battle-win");
  await expect(page.getByRole("status")).toContainText(/Player win normalized/);
  await presets.selectOption("battle-ready");
  await expect(page.getByRole("status")).toHaveCount(0);
  await presets.selectOption("load-standard");
  await page.getByRole("button", { name: "Delete manual slot 1" }).click();
  await page.getByRole("button", { name: "Delete save" }).click();
  await expect(
    page.getByRole("heading", { name: "Manual slot 1 · Empty" }),
  ).toBeVisible();
  await presets.selectOption("load-standard");
  await expect(
    page.getByRole("button", { name: "Delete manual slot 1" }),
  ).toBeVisible();
  await presets.selectOption("narrative-narration");
  await page.getByRole("button", { name: "Reviewer tools" }).click();
  await page.getByRole("button", { name: "Hide UI" }).click();
  await page.getByRole("button", { name: "Reviewer tools" }).click();
  await presets.selectOption("narrative-dialogue");
  await expect(page.getByText(/You came/)).toBeVisible();
  await presets.selectOption("narrative-missing");
  await expect(
    page.getByRole("img", { name: /Missing character art/ }),
  ).toBeVisible();
  await presets.selectOption("narrative-dialogue");
  await expect(
    page.getByRole("img", { name: /Missing character art/ }),
  ).toHaveCount(0);
  await presets.selectOption("motion-reduced");
  await expect(page.locator(".prototype-app")).toHaveClass(
    /force-reduced-motion/,
  );
  await presets.selectOption("motion-default");
  await expect(page.locator(".prototype-app")).not.toHaveClass(
    /force-reduced-motion/,
  );
  await presets.selectOption("save-failure");
  await expect(page.getByText(/Storage unavailable/)).toBeVisible();
  await page.getByRole("button", { name: "Close Save and load" }).click();
  await presets.selectOption("save-idle");
  await expect(
    page.getByRole("button", { name: "Save to manual slot 1" }),
  ).toBeVisible();
});

test("reset returns pristine launcher", async ({ page }) => {
  await page.goto("./prototype.html?screen=map&choice=trust-rin");
  await page.getByRole("button", { name: "Reviewer tools" }).click();
  await page.getByRole("button", { name: "Reset prototype" }).click();
  await expect(
    page.getByRole("heading", { name: "Visual novel prototype" }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("root remains direct-duel entry", async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "YGO Story Duel Simulator" }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
});
