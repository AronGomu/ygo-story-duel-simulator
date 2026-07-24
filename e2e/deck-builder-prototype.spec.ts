import { expect, test } from "@playwright/test";

const prototypeUrl = "./#/prototype/deck-builder";

test("default route still starts direct duel", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible();
  await expect(page.getByText("Deck Builder prototype")).toHaveCount(0);
});

test("deck builder prototype persists edits and exposes review states", async ({
  page,
}) => {
  await page.goto(prototypeUrl);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(
        "ygo-story-duel-deck-builder-prototype",
      );
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Deck Library" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByLabel("Deck name").fill("E2E Control");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByLabel("Deck name")).toHaveValue("E2E Control");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("searchbox", { name: "Name" }).fill("Blue-Eyes");
  const blueEyes = page.getByRole("button", {
    name: /Blue-Eyes White Dragon.*Unlimited/,
  });
  await expect(blueEyes).toBeVisible();
  await blueEyes.click();
  await expect(
    page.getByText(
      "This legendary dragon is a powerful engine of destruction.",
    ),
  ).toBeVisible();
  const mainDropArea = page.getByRole("group", {
    name: "Main Deck drop area",
  });
  await blueEyes.dragTo(mainDropArea);
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");
  await expect(page.getByText("Saved locally")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Deck counts")).toContainText("Main 0");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");

  const mainCard = mainDropArea.getByRole("button", {
    name: /Blue-Eyes White Dragon/,
  });
  await mainCard.focus();
  await mainCard.press("Space");
  await page
    .getByRole("button", { name: "Drop picked card in Side Deck" })
    .click();
  await expect(page.getByLabel("Deck counts")).toContainText("Side 1");
  const sideCard = page
    .getByRole("group", { name: "Side Deck drop area" })
    .getByRole("button", { name: /Blue-Eyes White Dragon/ });
  await sideCard.focus();
  await sideCard.press("Space");
  await page
    .getByRole("button", { name: "Drop picked card in Main Deck" })
    .click();
  await mainCard.focus();
  await mainCard.press("Space");
  await page.getByRole("button", { name: "Remove picked card" }).click();
  await expect(page.getByLabel("Deck counts")).toContainText("Main 0");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");
  await expect(page.getByText("Saved locally")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Deck name")).toHaveValue("E2E Control");
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");

  await page.getByText("Prototype review states").click();
  await page.getByLabel("State fixture").selectOption("main-41");
  await expect(page.locator('[data-slots="60"]').first()).toBeVisible();
  await expect(page.locator('[data-columns="12"]').first()).toBeVisible();

  await page.getByLabel("State fixture").selectOption("live");
  await page.getByRole("button", { name: "Import" }).click();
  await page
    .getByLabel("Or paste YDK text")
    .fill("#main\n99999999\n#extra\n!side\n");
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Replace deck cards" }).click();
  await expect(
    page.getByRole("button", { name: /Missing card 99999999/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("alert")).toContainText("invalid");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Missing card 99999999/ }),
  ).toBeVisible();

  await page.getByText("Prototype review states").click();
  await page.getByLabel("State fixture").selectOption("history-50");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  for (const state of [
    "resolver-ready",
    "resolver-invalid",
    "resolver-missing",
  ]) {
    await page.getByLabel("State fixture").selectOption(state);
    await expect(page.locator(`[data-review-state="${state}"]`)).toBeVisible();
  }

  await page.getByLabel("State fixture").selectOption("save-failure");
  await expect(page.getByRole("alert")).toContainText(
    "Review fixture: Save — Failed",
  );
  await expect(
    page.getByRole("button", { name: "Retry autosave" }),
  ).toBeVisible();
  await page.getByLabel("State fixture").selectOption("revision-conflict");
  await expect(
    page.getByRole("button", { name: "Reload newer revision" }),
  ).toBeVisible();
  await page.getByLabel("State fixture").selectOption("live");

  await page.getByRole("button", { name: "Deck Library" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Deck name").fill("E2E Renamed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await expect(page.getByLabel("Deck name")).toHaveValue("E2E Renamed");
  await page.getByRole("button", { name: "Deck Library" }).click();
  await page.getByRole("button", { name: "Duplicate" }).first().click();
  await expect(page.getByLabel("Deck name")).toHaveValue("E2E Renamed Copy");
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");
  await expect(
    page.getByRole("button", { name: /Missing card 99999999/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Deck name")).toHaveValue("E2E Renamed Copy");
  await expect(page.getByLabel("Deck counts")).toContainText("Main 1");
  await page.getByRole("button", { name: "Deck Library" }).click();
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Local deck and retained history",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Delete / })
    .click();
  await expect(
    page.getByRole("button", { name: /E2E Renamed Copy/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /E2E Renamed/ })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /E2E Renamed Copy/ }),
  ).toHaveCount(0);
});

test("Deck Library imports one persisted undoable update", async ({ page }) => {
  await page.goto(prototypeUrl);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(
        "ygo-story-duel-deck-builder-prototype",
      );
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Import YDK" }).click();
  await page.getByLabel("Deck name").fill("Library Import E2E");
  await page
    .getByLabel("Or paste YDK text")
    .fill("#main\n99999999\n#extra\n!side\n");
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Replace deck cards" }).click();
  await expect(page.getByLabel("Deck name")).toHaveValue("Library Import E2E");
  await expect(
    page.getByRole("button", { name: /Missing card 99999999/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Deck name")).toHaveValue("Library Import E2E");
  await expect(
    page.getByRole("button", { name: /Missing card 99999999/ }),
  ).toBeVisible();
});

test("deck builder recovers real save failures and revision conflicts", async ({
  page,
  context,
}) => {
  await page.goto(prototypeUrl);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(
        "ygo-story-duel-deck-builder-prototype",
      );
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByLabel("Deck name").fill("Recovery E2E");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    Object.defineProperty(IDBDatabase.prototype, "transaction", {
      configurable: true,
      value: function (this: IDBDatabase, ...args: unknown[]) {
        const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
        if (args[1] === "readwrite" && stores.includes("decks")) {
          Object.defineProperty(IDBDatabase.prototype, "transaction", {
            configurable: true,
            value: original,
          });
          throw new Error("simulated transaction failure");
        }
        return Reflect.apply(original, this, args);
      },
    });
  });
  await page.getByRole("searchbox", { name: "Name" }).fill("Blue-Eyes");
  const blueEyes = page.getByRole("button", { name: /Blue-Eyes White Dragon/ });
  await blueEyes.focus();
  await blueEyes.press("Space");
  await page
    .getByRole("button", { name: "Drop picked card in Main Deck" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "simulated transaction failure",
  );
  await page.getByRole("button", { name: "Retry autosave" }).click();
  await expect(page.getByText("Saved locally")).toBeVisible();

  const second = await context.newPage();
  await second.goto(prototypeUrl);
  await expect(second.getByLabel("Deck counts")).toContainText("Main 1");

  await page.getByRole("searchbox", { name: "Name" }).fill("Dark Magician");
  const darkMagician = page.getByRole("button", { name: /Dark Magician/ });
  await darkMagician.focus();
  await darkMagician.press("Space");
  await page
    .getByRole("button", { name: "Drop picked card in Main Deck" })
    .click();
  await expect(page.getByText("Saved locally")).toBeVisible();

  await second.getByRole("searchbox", { name: "Name" }).fill("Red-Eyes");
  const redEyes = second.getByRole("button", { name: /Red-Eyes Black Dragon/ });
  await redEyes.focus();
  await redEyes.press("Space");
  await second
    .getByRole("button", { name: "Drop picked card in Main Deck" })
    .click();
  await expect(second.getByRole("alert")).toContainText(
    "changed by another browser context",
  );
  await second
    .getByRole("button", { name: "Preserve local edits as copy" })
    .click();
  await expect(second.getByLabel("Deck name")).toHaveValue(
    "Recovery E2E Recovered Copy",
  );
  await expect(second.getByLabel("Deck counts")).toContainText("Main 2");
  await second.reload();
  await expect(second.getByLabel("Deck name")).toHaveValue(
    "Recovery E2E Recovered Copy",
  );
});

test("deck builder prototype declares desktop-only viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(prototypeUrl);
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByLabel("Deck name").fill("Desktop only");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Desktop viewport required" }),
  ).toBeVisible();
});
