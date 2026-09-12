import { expect, test } from "@playwright/test";

interface BootstrapDelivery {
  readonly baseUrl: string;
  readonly index: { readonly sha256: string; readonly bytes: number };
}

test("verified Chapter 1 index is pinned and browser-readable", async ({
  page,
  request,
}) => {
  await page.goto("./");
  await expect(page.locator('[data-cy="main-menu-screen"]')).toBeVisible();
  const bootstrapResponse = await request.get("./core-bootstrap.json");
  expect(bootstrapResponse.ok()).toBe(true);
  const bootstrap = (await bootstrapResponse.json()) as {
    readonly delivery: BootstrapDelivery | null;
  };
  expect(bootstrap.delivery).not.toBeNull();
  const indexPath = `./content/indexes/${bootstrap.delivery!.index.sha256}.json`;
  const browserResult = await page.evaluate(async (path) => {
    const response = await fetch(path);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return {
      ok: response.ok,
      bytes: bytes.byteLength,
      sha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      index: JSON.parse(new TextDecoder().decode(bytes)) as {
        readonly schemaVersion: number;
        readonly chapters: readonly {
          readonly id: string;
          readonly status: string;
        }[];
      },
    };
  }, indexPath);
  expect(browserResult.ok).toBe(true);
  expect(browserResult.bytes).toBe(bootstrap.delivery!.index.bytes);
  expect(browserResult.sha256).toBe(bootstrap.delivery!.index.sha256);
  expect(browserResult.index.schemaVersion).toBe(2);
  expect(browserResult.index.chapters).toContainEqual(
    expect.objectContaining({ id: "chapter-01", status: "published" }),
  );
  expect((await request.post(indexPath)).status()).toBe(405);
});
