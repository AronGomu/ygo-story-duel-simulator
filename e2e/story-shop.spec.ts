import { expect, test, type Page } from "@playwright/test";

const BEATS_BEFORE_CHOICE = 13;
const BEATS_AFTER_CHOICE = 17;

const STORY_REGION = '[data-cy="shell-region-story"]';

async function openStory(page: Page): Promise<void> {
  await page.goto("./#/story");
  await expect(page.locator(STORY_REGION)).toBeVisible();
}

async function startNarrative(page: Page): Promise<void> {
  await openStory(page);
  const newGame = page.getByRole("button", { name: "New Game" });
  if ((await newGame.count()) > 0) await newGame.click();
  await expect(page.getByText(/Rain turned/)).toBeVisible();
}

async function reachMap(page: Page): Promise<void> {
  await startNarrative(page);
  for (let index = 0; index < BEATS_BEFORE_CHOICE; index += 1)
    await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Choose your response" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /I trust you/ }).click();
  await expect(page.getByText(/earn that trust/)).toBeVisible();
  for (let index = 0; index < BEATS_AFTER_CHOICE; index += 1)
    await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "City signal map" }),
  ).toBeVisible();
}

async function advanceThroughGreeting(page: Page): Promise<void> {
  await page.locator('[data-cy="story-shop-greeting-cue"]').click();
  await page.locator('[data-cy="story-shop-greeting-cue"]').click();
  await expect(
    page.locator('[data-cy="story-shop-greeting-menu"]'),
  ).toBeVisible();
}

test("shop loop: buy packs, open all, sell cards, singles sanity", async ({
  page,
}) => {
  // Step 1: reach the map via the full prologue
  await reachMap(page);

  // Step 2: enter the shop, advance through greeting beats
  await page.locator('[data-cy="story-map-hotspot-card-shop"]').click();
  await expect(page.locator('[data-cy="story-shop-greeting"]')).toBeVisible();
  await advanceThroughGreeting(page);

  // Step 3: buy 6 Metal Raiders packs (6 × 150 = 900 of the 1000 DP wallet)
  await page.locator('[data-cy="story-shop-greeting-buy"]').click();
  await expect(
    page.locator('[data-cy="story-shop-browse-loading"]'),
  ).not.toBeVisible();
  // The grid itself, not just the absence of the spinner: a data-load failure
  // renders the error block, and asserting on the grid reports that as itself
  // rather than as a locator timeout three steps later.
  await expect(page.locator('[data-cy="story-shop-set-grid"]')).toBeVisible();
  await page.locator('[data-cy="story-shop-set-metal-raiders"]').click();
  await page.locator('[data-cy="story-shop-buy-custom-input"]').fill("6");
  await page.locator('[data-cy="story-shop-buy-custom"]').click();
  await expect(page.locator('[data-cy="story-top-bar-dp"]')).toHaveText(
    "100 DP",
  );

  // Close the set dialog before accessing the top-bar boosters pill
  await page.keyboard.press("Escape");

  // Step 4: open all 6 packs at once, verify all 54 cards arrived, continue
  await expect(page.locator('[data-cy="story-top-bar-boosters"]')).toHaveText(
    "6 packs",
  );
  await page.locator('[data-cy="story-top-bar-boosters"]').click();
  await page.locator('[data-cy="story-shop-open-all"]').click();
  // The recap collapses duplicates into one tile carrying a count, so the tile
  // count is a property of a random pull rather than a constant. What is
  // constant is the accounting: badges plus badge-less tiles total 54, which
  // fails if the grouping drops a card or invents one.
  await expect(page.locator('[data-cy="story-top-bar-title"]')).toContainText(
    "54",
  );
  const openedTotal = await page
    .locator('[data-cy^="story-shop-result-tile-"]')
    .evaluateAll((tiles) =>
      tiles.reduce((sum, tile) => {
        const badge = tile.querySelector(
          '[data-cy^="story-shop-results-quantity-"]',
        );
        return (
          sum +
          (badge === null
            ? 1
            : Number.parseInt(
                (badge.textContent ?? "").replace("\u00d7", ""),
                10,
              ))
        );
      }, 0),
    );
  expect(openedTotal).toBe(54);
  await page.locator('[data-cy="story-shop-results-continue"]').click();

  // Step 5: sell — navigate back through greeting to the sell screen
  await page.locator('[data-cy="story-shop-browse-back"]').click();
  await expect(page.locator('[data-cy="story-shop-greeting"]')).toBeVisible();
  await advanceThroughGreeting(page);
  await page.locator('[data-cy="story-shop-greeting-sell"]').click();
  await expect(page.locator('[data-cy="story-shop-sell"]')).toBeVisible();
  // Dark Magician rather than whichever row happens to sort first: New Game grants
  // two copies with the starter deck, that deck runs both, and no Metal Raiders
  // pack can add a third — so selling one deterministically leaves the deck
  // holding a card the save no longer owns, and must warn before it commits.
  await page.locator('[data-cy="story-shop-sell-plus-46986414"]').click();
  await page.locator('[data-cy="story-shop-sell-confirm"]').click();
  await expect(
    page.locator('[data-cy="story-sell-impact-dialog"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-cy="story-sell-impact-deck-story-starter-deck"]'),
  ).toContainText("Chapter 1 Starter");
  // Cancelling is the half that has to be exact: no sale, no card gone, and the
  // stepper still holding what was selected, so Sell reopens the same warning.
  await page.locator('[data-cy="story-sell-impact-cancel"]').click();
  await expect(
    page.locator('[data-cy="story-sell-impact-dialog"]'),
  ).toBeHidden();
  await expect(page.locator('[data-cy="story-top-bar-dp"]')).toHaveText(
    "100 DP",
  );
  await expect(
    page.locator('[data-cy="story-shop-sell-selected-46986414"]'),
  ).toHaveText("1");
  await page.locator('[data-cy="story-shop-sell-confirm"]').click();
  await expect(
    page.locator('[data-cy="story-sell-impact-dialog"]'),
  ).toBeVisible();
  await page.locator('[data-cy="story-sell-impact-confirm"]').click();
  await expect(
    page.locator('[data-cy="story-sell-impact-dialog"]'),
  ).toBeHidden();
  const dpText = await page
    .locator('[data-cy="story-top-bar-dp"]')
    .textContent();
  const dp = Number.parseInt(dpText ?? "0", 10);
  // 100 DP remained after buying; a completed sale must have added to it.
  expect(dp).toBeGreaterThan(100);

  // Step 6: singles sanity — buy button disabled/enabled consistent with DP
  await page.locator('[data-cy="story-shop-sell-back"]').click();
  await expect(page.locator('[data-cy="story-shop-greeting"]')).toBeVisible();
  await advanceThroughGreeting(page);
  await page.locator('[data-cy="story-shop-greeting-buy"]').click();
  await expect(
    page.locator('[data-cy="story-shop-browse-loading"]'),
  ).not.toBeVisible();
  // The grid itself, not just the absence of the spinner: a data-load failure
  // renders the error block, and asserting on the grid reports that as itself
  // rather than as a locator timeout three steps later.
  await expect(page.locator('[data-cy="story-shop-set-grid"]')).toBeVisible();
  await page.locator('[data-cy="story-shop-set-metal-raiders"]').click();
  await page.locator('[data-cy="story-shop-view-cards"]').click();

  const firstBuyButton = page
    .locator('[data-cy^="story-shop-card-buy-"]')
    .first();
  const priceText = await firstBuyButton.textContent();
  const price = Number.parseInt(priceText ?? "0", 10);
  const isDisabled = await firstBuyButton.evaluate(
    (el) => (el as HTMLButtonElement).disabled,
  );
  expect(isDisabled).toBe(dp < price);
});
