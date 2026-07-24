import { expect, test } from "@playwright/test";

test("isolated visual novel prototype entry loads without changing root duel", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let count = 0;
    class CountingWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        count += 1;
      }
    }
    Object.defineProperty(window, "Worker", { value: CountingWorker });
    Object.defineProperty(window, "__prototypeWorkerCount", {
      get: () => count,
    });
  });
  await page.goto("./prototype.html");
  await expect(
    page.getByRole("heading", { name: "Visual novel prototype" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start full flow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Jump to screen or state" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { readonly __prototypeWorkerCount: number })
          .__prototypeWorkerCount,
    ),
  ).toBe(0);
  expect(requests.some((url) => /\/runtime\/|\.wasm(?:$|\?)/.test(url))).toBe(
    false,
  );

  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "YGO Story Duel Simulator" }),
  ).toBeVisible({ timeout: 120_000 });
});
