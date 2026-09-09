import { expect, test, type Page } from "@playwright/test";

const WIDE_VIEWPORT = { width: 1600, height: 900 } as const;
/* Measured against the shipped production build after pane-only Start was
   removed from the footer probe: 789px is full, 788px compacts. */
const MEASURED_COMPACT_WIDTH = 788;

async function openFreePlayDeckSelect(page: Page): Promise<void> {
  await page.goto("./#/free-play");
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator('[data-cy="deck-select-start"]')).toBeEnabled({
    timeout: 120_000,
  });
}

/* Layout evidence needs exact sparse/dense counts, independent of whichever
   bundled decks the product snapshot contains. Clones exercise shipped CSS;
   interaction behavior remains covered against the original Svelte nodes. */
async function showTileCount(page: Page, count: number): Promise<void> {
  await page
    .locator('[data-cy="deck-select-grid"]')
    .evaluate((grid, targetCount) => {
      const tile = grid.firstElementChild;
      if (tile === null)
        throw new Error("Deck-select grid has no tile template");
      while (grid.children.length > 1) grid.lastElementChild?.remove();
      while (grid.children.length < targetCount)
        grid.append(tile.cloneNode(true));
    }, count);
}

async function gridGeometry(page: Page) {
  return page.locator('[data-cy="deck-select-grid"]').evaluate((grid) => {
    const gridRect = grid.getBoundingClientRect();
    const tiles = [...grid.children].map((tile) =>
      tile.getBoundingClientRect(),
    );
    const firstRow = tiles.filter(
      (tile) => Math.round(tile.top) === Math.round(tiles[0]!.top),
    );
    const rowLeft = Math.min(...firstRow.map((tile) => tile.left));
    const rowRight = Math.max(
      ...firstRow.map((tile) => tile.left + tile.width),
    );
    return {
      documentFits: document.documentElement.scrollWidth <= innerWidth,
      gridFits: grid.scrollWidth <= grid.clientWidth,
      rows: new Set(tiles.map((tile) => Math.round(tile.top))).size,
      widths: tiles.map((tile) => tile.width),
      rowCenterDelta: Math.abs(
        (rowLeft + rowRight) / 2 - (gridRect.left + gridRect.width / 2),
      ),
    };
  });
}

test("twin pane geometry", async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  const pane = page.locator('[data-cy="duel-start-seat-panel"]');
  const player = page.locator('[data-cy="seat-section-player"]');
  const opponent = page.locator('[data-cy="seat-section-opponent"]');
  const filter = page.locator('[data-cy="deck-select-filter"]');
  const count = page.locator('[data-cy="deck-select-count"]');
  const titlebar = page.locator('[data-cy="deck-select-titlebar"]');

  const [
    paneBox,
    playerBox,
    opponentBox,
    filterBox,
    countBox,
    titlebarBox,
    rootFont,
  ] = await Promise.all([
    pane.boundingBox(),
    player.boundingBox(),
    opponent.boundingBox(),
    filter.boundingBox(),
    count.boundingBox(),
    titlebar.boundingBox(),
    page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    ),
  ]);
  expect(paneBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(opponentBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(countBox).not.toBeNull();
  expect(titlebarBox).not.toBeNull();

  expect(Math.abs(paneBox!.width - 38 * rootFont)).toBeLessThanOrEqual(2);
  expect(playerBox!.x).toBeLessThan(opponentBox!.x);
  await expect(page.locator('[data-cy="deck-select-start"]')).toBeVisible();
  expect(countBox!.x - (filterBox!.x + filterBox!.width)).toBeCloseTo(12, 0);
  expect(countBox!.x + countBox!.width).toBeCloseTo(
    titlebarBox!.x + titlebarBox!.width,
    0,
  );
  expect(paneBox!.x - (countBox!.x + countBox!.width)).toBeCloseTo(12, 0);

  await page.locator('[data-cy="deck-select-start"]').click();
  await expect(page.locator('[data-cy="duel-field"]')).toBeVisible({
    timeout: 120_000,
  });
});

test("sparse, dense and mobile grids fit without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  for (const count of [1, 2, 4]) {
    await showTileCount(page, count);
    const geometry = await gridGeometry(page);
    expect(Math.max(...geometry.widths)).toBeLessThanOrEqual(420.5);
    expect(Math.min(...geometry.widths)).toBeGreaterThan(192);
    expect(geometry.rowCenterDelta).toBeLessThanOrEqual(12);
    expect(geometry.documentFits).toBe(true);
    expect(geometry.gridFits).toBe(true);
  }

  await showTileCount(page, 20);
  const dense = await gridGeometry(page);
  expect(dense.rows).toBeGreaterThan(1);
  expect(dense.documentFits).toBe(true);
  expect(dense.gridFits).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await showTileCount(page, 4);
  const mobile = await gridGeometry(page);
  expect(mobile.rows).toBe(4);
  expect(mobile.documentFits).toBe(true);
  expect(mobile.gridFits).toBe(true);
});

test("hover docks preview", async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  const wrapper = page.locator(
    '[data-cy="deck-select-seat-list-player-wrapper"]',
  );
  const rows = wrapper.locator("li.row");
  await expect(rows.first()).toBeVisible({ timeout: 120_000 });
  const rowIds = () =>
    rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-cy")),
    );
  const restingRows = await rowIds();

  await page
    .locator('[data-cy="deck-tile-preset:chapter-one-practice"]')
    .hover();
  await expect(wrapper).toHaveClass(/previewing/);
  await expect.poll(rowIds).not.toEqual(restingRows);
  await expect(page.locator('[data-cy="deck-select-hover-float"]')).toHaveCount(
    0,
  );

  await page.locator('[data-cy="deck-select-titlebar"]').hover();
  await expect(wrapper).not.toHaveClass(/previewing/);
  await expect.poll(rowIds).toEqual(restingRows);
});

test("bundled deck refuses editor open with disabled reason and toast", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  const key = "preset:chapter-one-starter";
  await page.locator(`[data-cy="deck-tile-menu-${key}"]`).click();
  const open = page.locator(`[data-cy="deck-tile-menu-open-${key}"]`);
  const reason = page.locator(`[data-cy="deck-tile-menu-open-reason-${key}"]`);
  await expect(open).toBeDisabled();
  await expect(open).toHaveAttribute(
    "aria-describedby",
    (await reason.getAttribute("id")) as string,
  );
  await expect(reason).toHaveText("Bundled deck: cannot be modified");

  await page.keyboard.press("Escape");
  await page.locator(`[data-cy="deck-tile-press-${key}"]`).dblclick();
  await expect(page.locator('[data-cy^="shell-toast-message-"]')).toHaveText(
    "Bundled deck: cannot be modified",
  );
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/free-play");
});

test("local deck still opens its builder on dblclick", async ({ page }) => {
  await page.goto("./#/free-play/decks");
  await expect(page.locator('[data-cy="deck-library-screen"]')).toBeVisible({
    timeout: 120_000,
  });

  await page.goto("./#/free-play");
  await expect(
    page.locator('[data-cy^="deck-tile-press-local:"]').first(),
  ).toBeVisible({ timeout: 120_000 });
  await page.locator('[data-cy^="deck-tile-press-local:"]').first().dblclick();

  await expect(page).toHaveURL(/#\/free-play\/decks\/.+$/);
  await expect(page.locator('[data-cy="deck-editor-layout"]')).toBeVisible({
    timeout: 120_000,
  });
});

test("footer actions", async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  const footer = page.locator('[data-cy="deck-select-footer"]');
  const actions = footer.locator("button:visible");
  await expect(actions.first()).toHaveAttribute("data-cy", "deck-select-back");
  await expect(actions.last()).toHaveAttribute("data-cy", "deck-select-create");
  await expect(page.locator('[data-cy="deck-select-back"]')).toHaveText(
    "← Return to Menu",
  );
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toHaveText("Create");

  const colors = await page.evaluate(() => {
    function resolvedColor(value: string): string {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }
    const back = document.querySelector('[data-cy="deck-select-back"]');
    const create = document.querySelector('[data-cy="deck-select-create"]');
    if (!(back instanceof HTMLElement) || !(create instanceof HTMLElement))
      throw new Error("Deck-select footer actions are missing");
    return {
      back: getComputedStyle(back).color,
      danger: resolvedColor("var(--danger)"),
      create: getComputedStyle(create).backgroundColor,
      legal: resolvedColor("var(--legal)"),
    };
  });
  expect(colors.back).toBe(colors.danger);
  expect(colors.create).toBe(colors.legal);
});

test("compaction", async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 900 });
  await openFreePlayDeckSelect(page);

  await expect(page.locator('[data-cy="deck-select-title"]')).toHaveText(
    "Choose your deck",
  );
  await expect(page.locator('[data-cy="deck-select-eyebrow"]')).toBeVisible();
  await expect(page.locator('[data-cy="deck-select-kebab"]')).toHaveCount(0);

  await page.setViewportSize({ width: MEASURED_COMPACT_WIDTH, height: 900 });
  await expect(page.locator('[data-cy="deck-select-title"]')).toHaveText(
    "Select Deck",
  );
  await expect(page.locator('[data-cy="deck-select-eyebrow"]')).toHaveCount(0);
  await page.locator('[data-cy="deck-select-kebab"]').click();
  const menu = page.locator('[data-cy="deck-select-kebab-menu"]');
  await expect(menu).toBeVisible();
  const menuItems = menu.locator('[role="menuitem"]');
  await expect(menuItems).toHaveCount(5);
  expect(
    await menuItems.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-cy")),
    ),
  ).toEqual([
    "deck-select-delete",
    "deck-select-rename",
    "deck-select-duplicate",
    "deck-select-open",
    "deck-select-create",
  ]);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-cy="deck-select-kebab"]')).toBeFocused();
});

test("copies chip", async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await openFreePlayDeckSelect(page);

  const singles = page
    .locator('[data-cy^="deck-select-seat-list-player-row-copies-"]')
    .filter({ hasText: /^1$/ });
  await expect(singles.first()).toHaveText("1", { timeout: 120_000 });
});
