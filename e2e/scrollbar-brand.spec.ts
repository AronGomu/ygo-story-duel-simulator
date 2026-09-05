import { expect, test, type Page } from "@playwright/test";

async function addOverflowFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.dataset.cy = "scrollbar-brand-fixture";
    Object.assign(scroller.style, {
      position: "fixed",
      top: "1rem",
      left: "1rem",
      width: "160px",
      height: "80px",
      overflow: "scroll",
    });
    const content = document.createElement("div");
    Object.assign(content.style, { width: "480px", height: "320px" });
    scroller.append(content);
    document.body.append(scroller);
  });
}

async function addZoneFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const zone = document.createElement("div");
    zone.dataset.cy = "zone-list-dialog-entries-fixture";
    zone.className = "zone-list-dialog__entries";
    Object.assign(zone.style, {
      position: "fixed",
      top: "6rem",
      left: "1rem",
      width: "160px",
      height: "80px",
    });
    const content = document.createElement("div");
    Object.assign(content.style, { width: "480px", height: "20px" });
    zone.append(content);
    document.body.append(zone);
  });
}

test("every visible native scrollbar uses Basilica Slate chrome", async ({
  page,
}) => {
  await page.goto("./");
  await addOverflowFixture(page);

  const scrollbar = page.locator('[data-cy="scrollbar-brand-fixture"]');
  await expect(scrollbar).toBeVisible();
  await expect
    .poll(() =>
      scrollbar.evaluate((element) => ({
        scrollable:
          element.scrollWidth > element.clientWidth &&
          element.scrollHeight > element.clientHeight,
        width: getComputedStyle(element, "::-webkit-scrollbar").width,
        track: getComputedStyle(element, "::-webkit-scrollbar-track")
          .backgroundColor,
        thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb")
          .backgroundColor,
      })),
    )
    .toEqual({
      scrollable: true,
      width: "12px",
      track: "rgb(11, 20, 36)",
      thumb: "rgb(115, 130, 157)",
    });
});

test("forced colors keeps native scrollbar chrome visible", async ({
  page,
}) => {
  await page.goto("./");
  await page.emulateMedia({ forcedColors: "active" });
  await addOverflowFixture(page);

  await expect
    .poll(() =>
      page
        .locator('[data-cy="scrollbar-brand-fixture"]')
        .evaluate((element) => ({
          scrollable:
            element.scrollWidth > element.clientWidth &&
            element.scrollHeight > element.clientHeight,
          width: getComputedStyle(element, "::-webkit-scrollbar").width,
          track: getComputedStyle(element, "::-webkit-scrollbar-track")
            .backgroundColor,
          thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb")
            .backgroundColor,
        })),
    )
    .toEqual({
      scrollable: true,
      width: "12px",
      track: "rgb(255, 255, 255)",
      thumb: "rgb(0, 0, 0)",
    });
});

test("forced colors keeps overlay thumb visible and zone rail platform-sized", async ({
  page,
}) => {
  await page.goto("./#/decks");
  await expect(page.locator('[data-cy="deck-library"]')).toBeVisible();
  await page.locator('[data-cy="deck-select-create"]').click();
  await page.getByLabel("Deck name").fill("Scrollbar forced colors");
  await page.locator('[data-cy="deck-library-create-submit"]').click();
  await expect(page.locator('[data-cy="deck-editor-layout"]')).toBeVisible();
  await expect(
    page.locator('[data-cy="deck-catalog-results-scrollbar-thumb"]'),
  ).toBeAttached();
  await page.emulateMedia({ forcedColors: "active" });
  await addZoneFixture(page);

  await expect
    .poll(() =>
      page
        .locator('[data-cy="deck-catalog-results-scrollbar-thumb"]')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(0, 0, 0)");
  await expect
    .poll(() =>
      page
        .locator('[data-cy="zone-list-dialog-entries-fixture"]')
        .evaluate((element) => ({
          width: getComputedStyle(element, "::-webkit-scrollbar").width,
          height: getComputedStyle(element, "::-webkit-scrollbar").height,
          track: getComputedStyle(element, "::-webkit-scrollbar-track")
            .backgroundColor,
          thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb")
            .backgroundColor,
        })),
    )
    .toEqual({
      width: "auto",
      height: "auto",
      track: "rgb(255, 255, 255)",
      thumb: "rgb(0, 0, 0)",
    });
});
