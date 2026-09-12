import { expect, test, type Page } from "@playwright/test";
import { contentInstallFixture } from "../tests/fixtures/content-install-fixture.ts";
import type {
  ContentInstaller,
  CoreBootstrap,
  InstalledRuntimeReceipt,
  ManifestRef,
  RuntimeSnapshotRef,
} from "../src/content/index.ts";

declare global {
  interface Window {
    contentInstaller: ContentInstaller;
    preparation: unknown;
    preparedReceipt: InstalledRuntimeReceipt;
    releaseLease: () => void;
    legacyBattle: IDBDatabase;
    battleBlocked: boolean;
    installAbort: AbortController;
  }
}
async function boot(page: Page, realActivation = false) {
  const fixture = await contentInstallFixture({ realRuntime: realActivation });
  fixture.bootstrap = {
    ...fixture.bootstrap,
    delivery: {
      ...fixture.bootstrap.delivery!,
      baseUrl: "http://127.0.0.1:4402/",
    },
  };
  await page.route("http://127.0.0.1:4402/content/**", async (route) => {
    const bytes = fixture.objects.get(
      new URL(route.request().url()).pathname.slice(1),
    );
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : "missing",
    });
  });
  await page.goto("/");
  await initialize(page, fixture.bootstrap, realActivation);
  return fixture;
}
async function initialize(
  page: Page,
  bootstrap: CoreBootstrap,
  realActivation = false,
) {
  return page.evaluate(
    async ({ bootstrap, realActivation }) => {
      const api = await import(
        /* @vite-ignore */ String("/src/content/index.ts")
      );
      const result = await api.createContentInstaller({
        bootstrap,
        savedRefs: { read: async () => ({ kind: "ok", value: [] }) },
        activation: realActivation
          ? (
              await import(
                /* @vite-ignore */ String("/src/battle/content-activation.ts")
              )
            ).createRuntimeActivationPort()
          : {
              prepare: async (ref: unknown) => ({ kind: "ok", value: ref }),
            },
      });
      if (result.kind !== "ok") throw new Error(JSON.stringify(result));
      window.contentInstaller = result.value;
    },
    { bootstrap, realActivation },
  );
}
const install = (page: Page) =>
  page.evaluate(() =>
    window.contentInstaller.download(
      { kind: "chapter", chapterId: "chapter-01" },
      () => undefined,
    ),
  );

test("installer commits whole closure only in real Cache/IDB", async ({
  page,
}) => {
  const fixture = await boot(page);
  expect(await install(page)).toEqual({
    kind: "complete",
    content: fixture.content,
  });
  expect(await page.evaluate(() => window.contentInstaller.current())).toEqual({
    kind: "ok",
    value: { generation: 1, current: fixture.content, previous: null },
  });
  await page.reload();
  await initialize(page, fixture.bootstrap);
  expect(
    await page.evaluate(() => window.contentInstaller.inspect("chapter-01")),
  ).toMatchObject({ kind: "ready" });
  await page.screenshot({
    path: "artifacts/CORE_ACCEPTANCE/T4/installer-core-locked.png",
  });
});

test("quota Cache.put failure leaves real current unchanged", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const native = Cache.prototype.put;
    Cache.prototype.put = function (request, response) {
      if (String(request).includes("/__content/files/"))
        return Promise.reject(
          new DOMException("Injected quota", "QuotaExceededError"),
        );
      return native.call(this, request, response);
    };
  });
  expect(await install(page)).toMatchObject({
    kind: "failed",
    code: "CONTENT_QUOTA_EXCEEDED",
  });
  expect(
    await page.evaluate(() => window.contentInstaller.current()),
  ).toMatchObject({ value: { generation: 0, current: null } });
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("ygo-story-content");
        r.onsuccess = () => resolve(r.result);
      });
      const count = await new Promise<number>((resolve) => {
        const r = db.transaction("receipts").objectStore("receipts").count();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return count;
    }),
  ).toBe(0);
});

test("quota IDB receipt write aborts whole install transaction", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "receipts")
        throw new DOMException("Injected IDB quota", "QuotaExceededError");
      return key === undefined
        ? native.call(this, value)
        : native.call(this, value, key);
    };
  });
  expect(await install(page)).toMatchObject({ code: "CONTENT_QUOTA_EXCEEDED" });
  expect(
    await page.evaluate(() => window.contentInstaller.current()),
  ).toMatchObject({ value: { generation: 0, current: null } });
  expect(
    await page.evaluate(() => window.contentInstaller.listJobs()),
  ).toMatchObject({
    kind: "ok",
    value: [
      {
        progress: { phase: "failed" },
        failure: { code: "CONTENT_QUOTA_EXCEEDED" },
      },
    ],
  });
});

test("atomic IDB abort during CAS preserves old current plus receipts/job", async ({
  page,
}) => {
  const fixture = await boot(page);
  expect((await install(page)).kind).toBe("complete");
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request =
        key === undefined
          ? native.call(this, value)
          : native.call(this, value, key);
      if (this.name === "active" && value.generation === 2)
        this.transaction.abort();
      return request;
    };
  });
  expect(await install(page)).toMatchObject({
    kind: "failed",
    code: "CONTENT_STORAGE_UNAVAILABLE",
  });
  await page.reload();
  await initialize(page, fixture.bootstrap);
  expect(await page.evaluate(() => window.contentInstaller.current())).toEqual({
    kind: "ok",
    value: { generation: 1, current: fixture.content, previous: null },
  });
  expect(
    await page.evaluate(() => window.contentInstaller.listJobs()),
  ).toMatchObject({
    kind: "ok",
    value: expect.arrayContaining([
      expect.objectContaining({
        progress: expect.objectContaining({ phase: "failed" }),
      }),
    ]),
  });
});

test("installer page interruption retains verified parts after reload", async ({
  page,
}) => {
  const fixture = await boot(page);
  const result = await page.evaluate(async () => {
    const abort = new AbortController();
    const native = window.fetch.bind(window);
    let parts = 0;
    window.fetch = async (input, init) => {
      const response = await native(input, init);
      if (!String(input).includes("/content/parts/") || ++parts !== 2)
        return response;
      const body = response.body!.getReader();
      return new Response(
        new ReadableStream({
          async pull(controller) {
            const chunk = await body.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value.subarray(0, 8));
          },
          cancel() {
            return body.cancel();
          },
        }),
      );
    };
    let partialBytes = 0;
    const result = await window.contentInstaller.download(
      { kind: "all-published" },
      (p) => {
        if (
          p.phase === "downloading" &&
          p.verifiedDownloadBytes > 0 &&
          p.currentPartReceivedBytes > 0
        ) {
          partialBytes = p.currentPartReceivedBytes;
          abort.abort();
        }
      },
      abort.signal,
    );
    return { ...result, partialBytes };
  });
  expect(result.partialBytes).toBe(8);
  expect(result.kind).toBe("paused");
  await page.reload();
  await initialize(page, fixture.bootstrap);
  expect(
    await page.evaluate(() => window.contentInstaller.listJobs()),
  ).toMatchObject({ kind: "ok", value: [{ progress: { phase: "paused" } }] });
  expect(
    await page.evaluate(
      async () =>
        (await (await caches.open("ygo-content-staging-v1")).keys()).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() => window.contentInstaller.current()),
  ).toMatchObject({ value: { current: null, generation: 0 } });
});

test("archive digest corruption rejects before public bytes become readable", async ({
  page,
}) => {
  const fixture = await boot(page);
  const part = fixture.runtime.manifest.parts[0]!;
  fixture.objects.set(
    `content/parts/${part.sha256}.zip`,
    new Uint8Array(part.bytes),
  );
  expect(await install(page)).toMatchObject({
    code: "CONTENT_INTEGRITY_FAILED",
  });
  expect(
    await page.evaluate(
      (ref) =>
        window.contentInstaller.readFile(ref, "runtime/current/manifest.json"),
      fixture.runtime.ref,
    ),
  ).toMatchObject({ code: "CONTENT_MISSING" });
});

test("installer exact shared leases protect refs without blocking unrelated mutations", async ({
  page,
}) => {
  const fixture = await boot(page);
  expect((await install(page)).kind).toBe("complete");
  const observed = await page.evaluate(async (content) => {
    const lease = await window.contentInstaller.acquireSession(content);
    if (lease.kind !== "ok") return lease;
    window.releaseLease = lease.value.release;
    return {
      runtimeExclusive: await navigator.locks.request(
        `ygo-content-ref:${content.runtime.sha256}`,
        { mode: "exclusive", ifAvailable: true },
        (lock) => lock !== null,
      ),
      unrelatedMutation: await navigator.locks.request(
        "ygo-content-installer-v1",
        { mode: "exclusive", ifAvailable: true },
        (lock) => lock !== null,
      ),
      held: (await navigator.locks.query()).held
        ?.map((lock) => ({ name: lock.name, mode: lock.mode }))
        .sort((a, b) => a.name!.localeCompare(b.name!)),
    };
  }, fixture.content);
  expect(observed).toEqual({
    runtimeExclusive: false,
    unrelatedMutation: true,
    held: [fixture.content.runtime, ...fixture.content.chapters]
      .map((r) => ({ name: `ygo-content-ref:${r.sha256}`, mode: "shared" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  await page.evaluate(() => {
    window.releaseLease();
    window.releaseLease();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async (sha) =>
          navigator.locks.request(
            `ygo-content-ref:${sha}`,
            { mode: "exclusive", ifAvailable: true },
            (lock) => lock !== null,
          ),
        fixture.content.runtime.sha256,
      ),
    )
    .toBe(true);
});

test("installer prepared receipt orphan never grants readiness after page crash", async ({
  page,
  context,
}) => {
  const fixture = await boot(page);
  await page.evaluate(async (bootstrap) => {
    window.contentInstaller.close();
    const api = await import(
      /* @vite-ignore */ String("/src/content/index.ts")
    );
    const receipts = await import(
      /* @vite-ignore */ String(
        "/src/battle/storage/installed-runtime-receipt.ts",
      )
    );
    const result = await api.createContentInstaller({
      bootstrap,
      savedRefs: { read: async () => ({ kind: "ok", value: [] }) },
      activation: {
        prepare: async (
          ref: RuntimeSnapshotRef,
          runtime: ManifestRef,
          reader: ContentInstaller,
        ) => {
          const receipt: InstalledRuntimeReceipt = {
            schemaVersion: 1,
            kind: "installed-runtime-v1",
            snapshot: ref,
            runtimePack: runtime,
            runtimeManifestFile: {
              path: "runtime/current/manifest.json",
              bytes: 16,
              sha256: ref.runtimeManifestSha256,
            },
            assetManifestFile: {
              path: "runtime/assets/current/manifest.json",
              bytes: 1,
              sha256: "a".repeat(64),
            },
            engineManifestFile: {
              path: "runtime/engine/vendor-manifest.json",
              bytes: 1,
              sha256: "b".repeat(64),
            },
            verifiedAt: Date.now(),
          };
          const saved = await receipts.writeInstalledRuntimeReceipt(receipt);
          window.preparation = {
            saved,
            privateFile: (
              await reader.readFile(runtime, "runtime/current/manifest.json")
            ).kind,
            publicFile: await window.contentInstaller.readFile(
              runtime,
              "runtime/current/manifest.json",
            ),
          };
          await new Promise(() => undefined);
          return { kind: "ok", value: ref };
        },
      },
    });
    if (result.kind !== "ok") throw new Error(JSON.stringify(result));
    window.contentInstaller = result.value;
    void result.value.download({ kind: "all-published" }, () => undefined);
  }, fixture.bootstrap);
  await expect
    .poll(() => page.evaluate(() => window.preparation))
    .toMatchObject({
      saved: { kind: "ok" },
      privateFile: "ok",
      publicFile: { code: "CONTENT_MISSING" },
    });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await initialize(reopened, fixture.bootstrap);
  expect(
    await reopened.evaluate(() => window.contentInstaller.current()),
  ).toMatchObject({ value: { generation: 0, current: null } });
  expect(
    await reopened.evaluate(() => window.contentInstaller.listJobs()),
  ).toMatchObject({ kind: "ok", value: [{ progress: { phase: "paused" } }] });
  expect(
    await reopened.evaluate(async (content) => {
      const receipts = await import(
        /* @vite-ignore */ String(
          "/src/battle/storage/installed-runtime-receipt.ts",
        )
      );
      return receipts.readInstalledRuntimeReceipt(
        content.snapshot,
        content.runtime,
      );
    }, fixture.content),
  ).toMatchObject({ kind: "ok", value: { kind: "installed-runtime-v1" } });
});

for (const abort of [false, true]) {
  test(`atomic Battle v3 blocked legacy tab ${abort ? "abort settles" : "fails bounded"} without late upgrade`, async ({
    page,
  }) => {
    const legacy = await page.context().newPage();
    await legacy.goto("/");
    await legacy.evaluate(async () => {
      window.battleBlocked = false;
      window.legacyBattle = await new Promise<IDBDatabase>(
        (resolve, reject) => {
          const request = indexedDB.open("ygo-story-duel", 2);
          request.onupgradeneeded = () => {
            for (const [name, keyPath] of [
              ["snapshots", "snapshotId"],
              ["pointers", "name"],
              ["preferences", "key"],
              ["debugRuns", "id"],
            ] as const)
              request.result.createObjectStore(name, { keyPath });
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        },
      );
      window.legacyBattle.onversionchange = () => {
        window.battleBlocked = true;
      };
      const tx = window.legacyBattle.transaction("preferences", "readwrite");
      tx.objectStore("preferences").put({ key: "legacy", value: "preserved" });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await boot(page, true);
    await page.evaluate((abort) => {
      window.installAbort = new AbortController();
      if (abort) {
        const original = indexedDB.open.bind(indexedDB);
        indexedDB.open = function (name: string, version?: number) {
          const request =
            version === undefined ? original(name) : original(name, version);
          if (name === "ygo-story-duel" && version === 3)
            request.addEventListener("blocked", () =>
              window.installAbort.abort(),
            );
          return request;
        };
      }
    }, abort);
    const pending = page.evaluate(() =>
      window.contentInstaller.download(
        { kind: "all-published" },
        () => undefined,
        window.installAbort.signal,
      ),
    );
    try {
      await expect
        .poll(() => legacy.evaluate(() => window.battleBlocked))
        .toBe(true);
      const result = await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      expect(result).toMatchObject(
        abort
          ? { kind: "paused" }
          : { kind: "failed", code: "CONTENT_STORAGE_UNAVAILABLE" },
      );
      expect(
        await page.evaluate(() => window.contentInstaller.current()),
      ).toMatchObject({ value: { generation: 0, current: null } });
      expect(await page.evaluate(() => navigator.locks.query())).toMatchObject({
        held: [],
      });
      if (!abort) {
        const read = page.evaluate(
          async ({ snapshot, runtime }) =>
            (
              await import(
                /* @vite-ignore */ String(
                  "/src/battle/storage/installed-runtime-receipt.ts",
                )
              )
            ).readInstalledRuntimeReceipt(snapshot, runtime),
          { snapshot: fixture.content.snapshot, runtime: fixture.runtime.ref },
        );
        expect(
          await Promise.race([
            read,
            new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
          ]),
        ).toMatchObject({
          kind: "failed",
          code: "CONTENT_STORAGE_UNAVAILABLE",
        });
      }
    } finally {
      await legacy.close();
      await pending;
    }
    const state = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("ygo-story-duel");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("preferences", "readonly");
            const row = tx.objectStore("preferences").get("legacy");
            tx.oncomplete = () => {
              resolve({
                version: db.version,
                receiptStore: db.objectStoreNames.contains(
                  "installedRuntimeReceipts",
                ),
                preference: row.result,
              });
              db.close();
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
    );
    expect(state).toEqual({
      version: 2,
      receiptStore: false,
      preference: { key: "legacy", value: "preserved" },
    });
    expect(errors).toEqual([]);
    expect((await install(page)).kind).toBe("complete");
    expect(
      await page.evaluate(() => window.contentInstaller.current()),
    ).toMatchObject({ value: { generation: 1 } });
    expect(errors).toEqual([]);
  });
}

test("installer rejects present undefined invalid marker in real IndexedDB", async ({
  page,
}) => {
  const fixture = await boot(page);
  expect((await install(page)).kind).toBe("complete");
  const result = await page.evaluate(async (content) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ygo-story-content");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const write = db.transaction("invalid", "readwrite");
      write.objectStore("invalid").put(undefined, content.chapters[0]!.sha256);
      await new Promise<void>((resolve, reject) => {
        write.oncomplete = () => resolve();
        write.onabort = () => reject(write.error);
      });
      const read = db.transaction(["invalid", "active"], "readonly");
      const count = read
        .objectStore("invalid")
        .count(content.chapters[0]!.sha256);
      const value = read
        .objectStore("invalid")
        .get(content.chapters[0]!.sha256);
      const current = read.objectStore("active").get("current");
      await new Promise<void>((resolve, reject) => {
        read.oncomplete = () => resolve();
        read.onabort = () => reject(read.error);
      });
      return {
        count: count.result,
        storedType: typeof value.result,
        storedGeneration: current.result.generation,
        file: await window.contentInstaller.readFile(
          content.chapters[0]!,
          "chapters/chapter-01/gameplay.json",
        ),
        current: await window.contentInstaller.current(),
        inspected: await window.contentInstaller.inspectContent(content),
      };
    } finally {
      db.close();
    }
  }, fixture.content);
  const failed = {
    kind: "failed",
    code: "CONTENT_INTEGRITY_FAILED",
    packId: null,
    path: null,
  };
  expect(result).toEqual({
    count: 1,
    storedType: "undefined",
    storedGeneration: 1,
    file: failed,
    current: failed,
    inspected: failed,
  });
});
