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
