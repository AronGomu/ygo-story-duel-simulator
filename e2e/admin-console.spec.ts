import { expect, test, type Page } from "@playwright/test";
import { DECK_DATABASE_NAME } from "../src/decks/deck-database.ts";

const adminUrl = "./#/admin";

async function deleteDeckDatabase(page: Page) {
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }, DECK_DATABASE_NAME);
}

test("the admin console ships in the production bundle", async ({ page }) => {
  await page.goto(adminUrl);
  await expect(page.locator('[data-cy="admin-title"]')).toBeVisible();
  await expect(page.locator('[data-cy="admin-routes"]')).toBeVisible();
  await expect(page.locator('[data-cy="admin-jumps"]')).toBeVisible();
  await expect(page.locator('[data-cy="admin-resets"]')).toBeVisible();
});

test("the console is not linked from the player-facing main menu", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator('[data-cy="main-menu-title"]')).toBeVisible();
  await expect(page.locator('[data-cy^="admin-"]')).toHaveCount(0);
});

test("the route index navigates to any indexed route", async ({ page }) => {
  await page.goto(adminUrl);
  await page.locator('[data-cy="admin-route-free-play-decks"]').click();
  await expect(
    page.getByRole("heading", { name: "Deck Library" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/free-play/decks");

  await page.goto(adminUrl);
  await page.locator('[data-cy="admin-route-home"]').click();
  await expect(page.locator('[data-cy="main-menu-title"]')).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/");
});

test("seeding fills the deck library and a confirmed reset empties it", async ({
  page,
}) => {
  await page.goto(adminUrl);
  await deleteDeckDatabase(page);
  await page.reload();

  /* The seed jump deep-links at the deck it just wrote, so success is the
     editor open on that deck rather than the library listing it. */
  await page.locator('[data-cy="admin-jump-seed-deck"]').click();
  await expect(page.locator('[data-cy="deck-name-input"]')).toHaveValue(
    "Admin test deck",
  );
  expect(new URL(page.url()).hash).toBe("#/free-play/decks/admin-test-deck");

  await page.goto(adminUrl);
  /* The first click only arms the delete: nothing is removed until the
     separate confirm button that it reveals is clicked. */
  await page.locator('[data-cy="admin-reset-decks"]').click();
  await expect(
    page.locator('[data-cy="admin-reset-decks-confirm"]'),
  ).toBeVisible();
  await page.locator('[data-cy="admin-route-free-play-decks"]').click();
  await expect(page.getByText("Admin test deck")).toBeVisible();

  await page.goto(adminUrl);
  await page.locator('[data-cy="admin-reset-decks"]').click();
  await page.locator('[data-cy="admin-reset-decks-confirm"]').click();
  await expect(page.locator('[data-cy="admin-status"]')).toHaveText(
    "Cleared Free-play deck library.",
  );

  /* The reset deletes the deck database outright, so its absence is the reset
     itself rather than anything a view happens to render. Asserted here, while
     the console is still the open route: the editor seeds a starter deck on
     mount, which recreates the database the moment the deck library opens. */
  const deckDatabaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((entry) => entry.name),
  );
  expect(deckDatabaseNames).not.toContain(DECK_DATABASE_NAME);

  /* Which is why "No local decks" is no longer reachable from here: opening the
     library seeds `Chapter 1 Starter` into the database the reset just removed. The
     deck the seed jump wrote is gone all the same, and nothing else survives
     beside it. */
  await page.locator('[data-cy="admin-route-free-play-decks"]').click();
  await expect(page.getByText("Chapter 1 Starter")).toBeVisible();
  await expect(page.getByText("Admin test deck")).toHaveCount(0);
  await expect(
    page.locator('[data-cy="deck-select-grid"] > [data-cy^="deck-tile-"]'),
  ).toHaveCount(1);
});
