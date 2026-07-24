import { expect, test, type Locator, type Page } from "@playwright/test";

async function keyboardActivate(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    if (
      await target.evaluate((element) => document.activeElement === element)
    ) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Could not reach keyboard target: ${await target.textContent()}`,
  );
}

const viewports = [
  { width: 1280, height: 720 },
  { width: 768, height: 1024 },
  { width: 375, height: 667 },
  { width: 667, height: 375 },
];

for (const viewport of viewports) {
  test(`prototype has no document overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("./prototype.html?screen=map");
    await expect(
      page.getByRole("heading", { name: "City signal map" }),
    ).toBeVisible();
    const sizes = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.viewportWidth);
    if (viewport.width <= 667) {
      const targets = page.getByLabel("Location list").getByRole("button");
      for (let index = 0; index < (await targets.count()); index += 1) {
        const box = await targets.nth(index).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

test("overlays fit viewport, restore focus, and expose labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("./prototype.html?screen=narrative");
  const pause = page.getByRole("button", { name: "Open pause menu" });
  await pause.click();
  const dialog = page.getByRole("dialog", { name: "Paused" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  const close = page.getByRole("button", { name: "Close Paused" });
  const last = page.getByRole("button", { name: "Return to Title" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pause).toBeFocused();
});

test("load and delete dialogs keep only top overlay active", async ({
  page,
}) => {
  await page.goto("./prototype.html?screen=narrative");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Load game" })).toBeVisible();
  await page.getByRole("button", { name: "Delete manual slot 1" }).click();
  const deletion = page.getByRole("alertdialog", { name: "Delete save?" });
  await expect(deletion).toBeVisible();
  await expect(page.locator("[aria-modal='true']")).toHaveCount(1);
  const cancel = page.getByRole("button", { name: "Cancel delete" });
  const confirm = page.getByRole("button", { name: "Delete save" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deletion).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Load game" })).toBeVisible();
});

test("long content survives 200% text zoom and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./prototype.html?screen=narrative");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.getByText(/Rain turned/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open pause menu" }),
  ).toBeVisible();
  const animation = await page
    .locator("[data-testid=narrative-background]")
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  const durationMs = animation.endsWith("ms")
    ? Number.parseFloat(animation)
    : Number.parseFloat(animation) * 1_000;
  expect(durationMs).toBeLessThanOrEqual(0.01);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("core flow is keyboard reachable and screen changes focus meaningful content", async ({
  page,
}) => {
  await page.goto("./prototype.html");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Start full flow" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Echoes of the Draw" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "New Game" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Rain turned/)).toBeVisible();
  for (let index = 0; index < 13; index += 1)
    await page.keyboard.press("Enter");
  const choice = page.getByRole("button", { name: /I trust you/ });
  await expect(choice).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/earn that trust/)).toBeVisible();
  for (let index = 0; index < 17; index += 1)
    await page.keyboard.press("Enter");
  const mapHeading = page.getByRole("heading", { name: "City signal map" });
  await expect(mapHeading).toBeFocused();
  await keyboardActivate(
    page,
    page.getByLabel("Map hotspots").getByRole("button", { name: /Old Arena/ }),
  );
  await expect(page.getByRole("heading", { name: "Rin's Echo" })).toBeFocused();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Start Duel" }),
  );
  await expect(
    page.getByRole("heading", { name: "Existing duel experience placeholder" }),
  ).toBeFocused();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Simulate Player Win" }),
  );
  await expect(
    page.getByRole("heading", { name: "Signal broken" }),
  ).toBeFocused();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Continue story" }),
  );
  await expect(
    page.getByRole("heading", { name: "Signal Cipher" }),
  ).toBeFocused();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Continue to updated map" }),
  );
  await expect(mapHeading).toBeFocused();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Save progress" }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Confirm overwrite" }),
  );
  await expect(page.getByText(/Save complete/)).toBeVisible();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Close Save and load" }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "End prototype" }),
  );
  await expect(
    page.getByRole("heading", { name: "Prototype complete" }),
  ).toBeFocused();
});
