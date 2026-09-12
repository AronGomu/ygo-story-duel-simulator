import { expect, test, type Page } from "@playwright/test";

const apps = [
  { name: "root", url: "http://127.0.0.1:4400/" },
  {
    name: "subpath",
    url: "http://127.0.0.1:4401/ygo-story-duel/",
  },
] as const;

async function assertCoreOnly(page: Page, requests: readonly string[]) {
  await expect(page.locator('[data-cy="main-menu-screen"]')).toBeVisible();
  for (const cy of [
    "main-menu-new-game",
    "main-menu-continue",
    "main-menu-load",
    "main-menu-free-play",
  ])
    await expect(page.locator(`[data-cy="${cy}"]`)).toBeDisabled();
  await expect(page.locator('[data-cy="core-gate-status"]')).toContainText(
    "Content is required",
  );
  expect(
    requests.filter((url) =>
      /(?:\/runtime\/|duel\.worker|\/src\/(?:battle|story|deck-editor)\/index\.ts|FreePlayMatchSetup|free-play-deck-listing|AdminConsole|shop-sets)/.test(
        url,
      ),
    ),
  ).toEqual([]);
}

for (const app of apps) {
  test(`${app.name} source-only CORE keeps gameplay gated with zero Worker`, async ({
    page,
  }) => {
    const requests: string[] = [];
    let workerCount = 0;
    page.on("request", (request) => requests.push(request.url()));
    page.on("worker", () => workerCount++);

    await page.goto(app.url);
    await assertCoreOnly(page, requests);

    const freePlay = page.locator('[data-cy="main-menu-free-play"]');
    await freePlay.hover({ force: true });
    await freePlay.focus();
    await expect.poll(() => workerCount).toBe(0);
    await assertCoreOnly(page, requests);

    await page.locator('[data-cy="main-menu-settings"]').click();
    await expect(
      page.locator('[data-cy="shell-settings-content-status"]'),
    ).toContainText("Content is required");
    await page.locator('[data-cy="shell-settings-close"]').click();

    await page.locator('[data-cy="main-menu-install-content"]').click();
    await expect(page).toHaveURL(`${app.url}#/install-content`);
    await expect(
      page.locator('[data-cy="install-content-screen"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-cy="install-content-chapter-chapter-01"]'),
    ).toContainText("DM");
    expect(workerCount).toBe(0);
    expect(
      requests.filter((url) =>
        /(?:\/runtime\/|duel\.worker|\/src\/(?:battle|story|deck-editor)\/index\.ts|FreePlayMatchSetup|free-play-deck-listing|AdminConsole|shop-sets)/.test(
          url,
        ),
      ),
    ).toEqual([]);
  });

  test(`${app.name} direct gameplay hashes and Back cannot bypass CORE`, async ({
    page,
  }) => {
    let workerCount = 0;
    page.on("worker", () => workerCount++);
    await page.goto(app.url);
    await expect(page.locator('[data-cy="main-menu-screen"]')).toBeVisible();
    await page.evaluate(() => {
      location.hash = "#/story";
    });
    await expect(page).toHaveURL(`${app.url}#/install-content`);
    await expect(
      page.locator('[data-cy="install-content-screen"]'),
    ).toBeVisible();

    await page.goBack();
    await expect(page.locator('[data-cy="main-menu-screen"]')).toBeVisible();

    await page.goto(`${app.url}#/admin`);
    await expect(page).toHaveURL(`${app.url}#/install-content`);
    await expect(page.locator('[data-cy="admin-title"]')).toHaveCount(0);
    expect(workerCount).toBe(0);
  });
}
