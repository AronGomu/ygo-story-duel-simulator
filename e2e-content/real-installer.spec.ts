import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Exact private producer run is required, never silently replace it with fixtures.
test("installer real Chapter 1 producer/consumer roundtrip without Worker startup", async ({
  page,
}, testInfo) => {
  const run = process.env.CONTENT_RUN;
  expect(run, "CONTENT_RUN must name a verified T3 run").toMatch(
    /^generated\/asset-delivery\/runs\/[a-f0-9-]{36}$/,
  );
  const candidate = JSON.parse(
    await readFile(path.join(run!, "candidate.json"), "utf8"),
  ) as { snapshot: { key: string; sha256: string } };
  const snapshot = JSON.parse(
    await readFile(path.join(run!, "objects", candidate.snapshot.key), "utf8"),
  ) as {
    prod: {
      index: { sha256: string; bytes: number };
      runtimeSnapshotId: string;
    };
  };
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.goto("/#/install-content");
  await expect(
    page.locator('[data-cy="install-content-install-chapter-01"]'),
  ).toBeEnabled();
  const bootstrap = await (
    await page.request.get("/core-bootstrap.json")
  ).json();
  expect(bootstrap.delivery.index).toEqual({
    sha256: snapshot.prod.index.sha256,
    bytes: snapshot.prod.index.bytes,
  });
  await page.locator('[data-cy="install-content-install-chapter-01"]').click();
  await expect(
    page.locator('[data-cy="install-content-ready-chapter-01"]'),
  ).toContainText("Verified installed", { timeout: 240_000 });
  const evidence = await page.evaluate(async () => {
    const { openContentReader } = await import(
      /* @vite-ignore */ String("/src/content/index.ts")
    );
    const { readInstalledRuntimeReceipt } = await import(
      /* @vite-ignore */ String(
        "/src/battle/storage/installed-runtime-receipt.ts",
      )
    );
    const opened = await openContentReader();
    if (opened.kind !== "ok") return opened;
    const state = await opened.value.current();
    if (state.kind !== "ok" || !state.value.current) return state;
    const ref = state.value.current;
    const receipt = await readInstalledRuntimeReceipt(
      ref.snapshot,
      ref.runtime,
    );
    return {
      state,
      receipt,
      jobs: await new Promise((resolve, reject) => {
        const request = indexedDB.open("ygo-story-content");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const rows = db.transaction("jobs").objectStore("jobs").getAll();
          rows.onerror = () => {
            db.close();
            reject(rows.error);
          };
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result);
          };
        };
      }),
    };
  });
  expect(evidence).toMatchObject({
    state: {
      kind: "ok",
      value: {
        generation: 1,
        current: {
          catalogSha256: snapshot.prod.index.sha256,
          snapshot: { runtimeSnapshotId: snapshot.prod.runtimeSnapshotId },
        },
      },
    },
    receipt: {
      kind: "ok",
      value: { schemaVersion: 1, kind: "installed-runtime-v1" },
    },
    jobs: [{ progress: { phase: "complete" } }],
  });
  expect(workers).toEqual([]);
  await testInfo.attach("exact-input-and-installed-receipt", {
    body: JSON.stringify(
      { run, candidate, bootstrap, evidence, workers },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.screenshot({
    path: "artifacts/CORE_ACCEPTANCE/T4/real-installed.png",
  });
  await page.locator('[data-cy="install-content-back"]').click();
  await expect(page.locator('[data-cy="main-menu-screen"]')).toBeVisible();
  await page.goto("/#/free-play");
  await expect(
    page.locator('[data-cy="install-content-screen"]'),
  ).toBeVisible();
  expect(workers).toEqual([]);
});
