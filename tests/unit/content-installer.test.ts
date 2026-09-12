import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDB, openDB } from "idb";
import { contentInstallFixture } from "../fixtures/content-install-fixture.ts";
import { fileKey } from "../../src/content/storage/content-cache.ts";
import { extractVerifiedPart } from "../../src/content/install/verified-archive.ts";
import { fetchVerified } from "../../src/content/install/verified-fetch.ts";
import { manifestClosure } from "../../src/content/install/manifest-closure.ts";
import { createRuntimeActivationPort } from "../../src/battle/content-activation.ts";
import { ContentReader } from "../../src/content/storage/content-reader.ts";
import { openContentDatabase } from "../../src/content/storage/content-database.ts";
import { readInstalledRuntimeReceipt } from "../../src/battle/storage/installed-runtime-receipt.ts";
import { contentErrorCopy } from "../../src/shell/content/content-error-copy.ts";
import * as content from "../../src/content/index.ts";

let installer: content.ContentInstaller | undefined;
let stores: Map<string, Map<string, Response>>;
let locked = false;
beforeEach(() => {
  stores = new Map();
  locked = false;
  vi.stubGlobal("location", { origin: "http://localhost" });
  vi.stubGlobal("navigator", {
    locks: {
      async request(
        _name: string,
        _options: unknown,
        run: (lock: object | null) => Promise<unknown>,
      ) {
        if (locked) return run(null);
        locked = true;
        try {
          return await run({});
        } finally {
          locked = false;
        }
      },
    },
  });
  vi.stubGlobal("caches", {
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return {
        async match(key: string) {
          return store.get(key)?.clone();
        },
        async put(key: string, response: Response) {
          store.set(key, response.clone());
        },
      };
    },
  });
});
afterEach(async () => {
  installer?.close();
  installer = undefined;
  vi.unstubAllGlobals();
  await deleteDB("ygo-story-content");
  await deleteDB("ygo-story-duel");
});
async function setup(
  prepare: content.RuntimeActivationPort["prepare"] = async (ref) => ({
    kind: "ok",
    value: ref,
  }),
  options: Parameters<typeof contentInstallFixture>[0] = {},
) {
  const fixture = await contentInstallFixture(options);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const bytes = fixture.objects.get(new URL(url).pathname.slice(1));
      return new Response(bytes?.slice() ?? null, {
        status: bytes ? 200 : 404,
      });
    }),
  );
  const result = await content.createContentInstaller({
    bootstrap: fixture.bootstrap,
    savedRefs: { read: async () => ({ kind: "ok", value: [] }) },
    activation: { prepare },
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw result;
  installer = result.value;
  return fixture;
}
describe("verified installer", () => {
  it("exports initial installation without premature lifecycle controls", () => {
    expect(content).toHaveProperty("createContentInstaller");
    expect(content).toHaveProperty("openContentReader");
    expect(content).not.toHaveProperty("createContentService");
  });
  it("installer commits whole closure only; staging remains private", async () => {
    let publicBefore: content.ContentResult<Blob> | undefined;
    const fixture = await setup(async (ref, runtime, reader) => {
      expect(
        (await reader.readFile(runtime, "runtime/current/manifest.json")).kind,
      ).toBe("ok");
      publicBefore = await installer!.readFile(
        runtime,
        "runtime/current/manifest.json",
      );
      expect(await reader.acquireSession(fixture.content)).toMatchObject({
        kind: "failed",
        code: "CONTENT_BUSY",
      });
      expect(await reader.current()).toEqual({
        kind: "ok",
        value: { generation: 0, current: null, previous: null },
      });
      return { kind: "ok", value: ref };
    });
    const phases: string[] = [];
    const result = await installer!.download(
      { kind: "chapter", chapterId: "chapter-01" },
      (p) => phases.push(p.phase),
    );
    expect(result).toEqual({ kind: "complete", content: fixture.content });
    expect(publicBefore).toMatchObject({
      kind: "failed",
      code: "CONTENT_MISSING",
    });
    expect(await installer!.current()).toEqual({
      kind: "ok",
      value: { generation: 1, current: fixture.content, previous: null },
    });
    expect((await installer!.inspect("chapter-01")).kind).toBe("ready");
    expect(phases).toContain("extracting");
    expect(phases.at(-1)).toBe("complete");
    expect(await installer!.listJobs()).toMatchObject({
      kind: "ok",
      value: [{ progress: { phase: "complete" } }],
    });
  });
  it("chapter demands cannot be hidden by an empty runtime support declaration", async () => {
    const prepare = vi.fn(createRuntimeActivationPort().prepare);
    await setup(prepare, {
      realRuntime: true,
      runtimeCardCodes: [],
      indexedScript: true,
      omitScript: true,
      omitImages: true,
    });
    expect(
      await installer!.download({ kind: "all-published" }, () => undefined),
    ).toMatchObject({ kind: "failed", code: "CONTENT_INCOMPATIBLE" });
    expect(prepare).not.toHaveBeenCalled();
    expect(await installer!.current()).toMatchObject({
      value: { generation: 0, current: null },
    });
    expect(
      (await indexedDB.databases()).some((db) => db.name === "ygo-story-duel"),
    ).toBe(false);
  });
  it("preparation rejects indexed script omissions outside declared support before writing receipt", async () => {
    const fixture = await setup(undefined, {
      realRuntime: true,
      runtimeCardCodes: Array.from({ length: 13 }, (_, i) => i + 2),
      indexedScript: true,
      omitScript: true,
    });
    const cache = await caches.open("ygo-content-files-v1");
    const keys = new Set<string>();
    for (const part of fixture.runtime.manifest.parts)
      await extractVerifiedPart(
        fixture.objects.get(`content/parts/${part.sha256}.zip`)!,
        fixture.runtime.manifest.files.filter(
          (f) => f.partSha256 === part.sha256,
        ),
        async (file, bytes) => {
          const key = fileKey(fixture.runtime.ref, file.path);
          keys.add(key);
          await cache.put(key, new Response(bytes.slice()));
        },
      );
    const reader = new ContentReader(await openContentDatabase(), cache, keys);
    try {
      expect(
        await createRuntimeActivationPort().prepare(
          fixture.content.snapshot,
          fixture.runtime.ref,
          reader,
        ),
      ).toMatchObject({ kind: "failed", code: "CONTENT_INTEGRITY_FAILED" });
      expect(
        await readInstalledRuntimeReceipt(
          fixture.content.snapshot,
          fixture.runtime.ref,
        ),
      ).toMatchObject({ code: "CONTENT_MISSING" });
    } finally {
      reader.close();
    }
  });
  it.each([
    { indexedScript: true, omitScript: true },
    { omitImages: true },
    { omitGlobal: true },
  ])(
    "missing supported script/image/global fails before receipt: %j",
    async (missing) => {
      const fixture = await setup(createRuntimeActivationPort().prepare, {
        realRuntime: true,
        ...missing,
      });
      expect(
        await installer!.download({ kind: "all-published" }, () => undefined),
      ).toMatchObject({ kind: "failed", code: "CONTENT_INTEGRITY_FAILED" });
      expect(
        await readInstalledRuntimeReceipt(
          fixture.content.snapshot,
          fixture.runtime.ref,
        ),
      ).toMatchObject({ code: "CONTENT_MISSING" });
      expect(await installer!.current()).toMatchObject({
        value: { generation: 0, current: null },
      });
    },
  );
  for (const name of ["constant.lua", "utility.lua"]) {
    it.each([undefined, "", null, " \n "])(
      `required ${name} must contain non-empty source: %j`,
      async (source) => {
        const globals: Record<string, unknown> = {
          "constant.lua": "-- fixture constants",
          "utility.lua": "-- fixture utilities",
        };
        if (source === undefined) delete globals[name];
        else globals[name] = source;
        const fixture = await setup(createRuntimeActivationPort().prepare, {
          realRuntime: true,
          globals,
          globalIndex: Object.keys(globals),
        });
        expect(
          await installer!.download({ kind: "all-published" }, () => undefined),
        ).toMatchObject({ kind: "failed", code: "CONTENT_INTEGRITY_FAILED" });
        expect(
          await readInstalledRuntimeReceipt(
            fixture.content.snapshot,
            fixture.runtime.ref,
          ),
        ).toMatchObject({ code: "CONTENT_MISSING" });
        expect(await installer!.current()).toMatchObject({
          value: { generation: 0, current: null },
        });
      },
    );
  }
  it("normal monsters need no fictitious individual script", async () => {
    const fixture = await setup(createRuntimeActivationPort().prepare, {
      realRuntime: true,
    });
    expect(
      (await installer!.download({ kind: "all-published" }, () => undefined))
        .kind,
    ).toBe("complete");
    expect(
      await readInstalledRuntimeReceipt(
        fixture.content.snapshot,
        fixture.runtime.ref,
      ),
    ).toMatchObject({ kind: "ok", value: { kind: "installed-runtime-v1" } });
  });
  it("page abort settles while activation preparation is still pending", async () => {
    let finish: (() => void) | undefined;
    await setup(
      (ref) =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: "ok", value: ref });
        }),
    );
    const abort = new AbortController();
    const pending = installer!.download(
      { kind: "all-published" },
      () => undefined,
      abort.signal,
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    abort.abort();
    try {
      expect(
        await Promise.race([
          pending,
          new Promise((resolve) => setTimeout(() => resolve(null), 100)),
        ]),
      ).toMatchObject({ kind: "paused" });
      expect(await installer!.current()).toMatchObject({
        value: { generation: 0, current: null },
      });
    } finally {
      finish?.();
      await pending;
    }
    expect(await installer!.current()).toMatchObject({
      value: { generation: 0, current: null },
    });
  });
  it("page interruption retains verified parts without activating", async () => {
    await setup();
    const controller = new AbortController();
    const result = await installer!.download(
      { kind: "chapter", chapterId: "chapter-01" },
      (p) => {
        if (p.phase === "extracting") controller.abort();
      },
      controller.signal,
    );
    expect(result.kind).toBe("paused");
    expect(stores.get("ygo-content-staging-v1")?.size).toBe(1);
    expect(await installer!.current()).toMatchObject({
      kind: "ok",
      value: { generation: 0, current: null },
    });
    expect(await installer!.listJobs()).toMatchObject({
      kind: "ok",
      value: [{ progress: { phase: "paused" } }],
    });
  });
  it("mid-body network failure retains its fixed network code", async () => {
    const fixture = await setup();
    const part = fixture.runtime.manifest.parts[0]!;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("private transport details"));
            },
          }),
        ),
    );
    await expect(
      fetchVerified(
        fixture.bootstrap.delivery!.baseUrl,
        "parts",
        part,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({
      kind: "failed",
      code: "CONTENT_NETWORK_FAILED",
      path: null,
    });
  });
  it("single Web Lock rejects competing mutation", async () => {
    await setup();
    locked = true;
    expect(
      await installer!.download({ kind: "all-published" }, () => undefined),
    ).toMatchObject({ code: "CONTENT_BUSY" });
  });
  it("quota failure never creates receipts or active content", async () => {
    await setup();
    const native = caches.open.bind(caches);
    vi.stubGlobal("caches", {
      open: async (name: string) =>
        name === "ygo-content-staging-v1"
          ? {
              put: () => {
                throw new DOMException("quota", "QuotaExceededError");
              },
            }
          : native(name),
    });
    expect(
      await installer!.download({ kind: "all-published" }, () => undefined),
    ).toMatchObject({ code: "CONTENT_QUOTA_EXCEEDED" });
    expect(await installer!.current()).toMatchObject({
      value: { current: null, generation: 0 },
    });
  });
  it.each([
    { kind: "failed", code: "NOT_A_CONTENT_CODE", packId: null, path: null },
    {
      kind: "failed",
      code: "CONTENT_NETWORK_FAILED",
      packId: null,
      path: "../unsafe",
    },
    {
      kind: "failed",
      code: "CONTENT_NETWORK_FAILED",
      packId: null,
      path: null,
      extra: "unsafe detail",
    },
    false,
    null,
    undefined,
  ])(
    "persisted invalid markers normalize malformed failure without unsafe copy: %j",
    async (invalid) => {
      const fixture = await setup();
      expect(
        (await installer!.download({ kind: "all-published" }, () => undefined))
          .kind,
      ).toBe("complete");
      const db = await openDB("ygo-story-content");
      try {
        await db.put("invalid", invalid, fixture.chapter.ref.sha256);
        const result = await installer!.readFile(
          fixture.chapter.ref,
          "chapters/chapter-01/gameplay.json",
        );
        expect(result).toEqual({
          kind: "failed",
          code: "CONTENT_INTEGRITY_FAILED",
          packId: null,
          path: null,
        });
        expect(await installer!.current()).toEqual(result);
        if (result.kind !== "failed") throw new Error("Expected fixed failure");
        expect(contentErrorCopy(result.code)).toBe(
          "Content verification failed. Retry installation.",
        );
        expect((await db.get("active", "current")).generation).toBe(1);
        const job = (await db.getAll("jobs"))[0];
        await db.put("jobs", { ...job, failure: invalid }, job.jobId);
        if (invalid !== null)
          expect(await installer!.listJobs()).toMatchObject({
            kind: "ok",
            value: [
              { failure: { code: "CONTENT_INTEGRITY_FAILED", path: null } },
            ],
          });
      } finally {
        db.close();
      }
    },
  );
  it("unknown runtime failure code still has fixed UI copy", () => {
    expect(contentErrorCopy("UNRECOGNIZED" as content.ContentFailureCode)).toBe(
      "Content verification failed. Retry installation.",
    );
  });
  it("cache-only SHA check fails closed after eviction or corruption", async () => {
    const fixture = await setup();
    expect(
      (await installer!.download({ kind: "all-published" }, () => undefined))
        .kind,
    ).toBe("complete");
    const key = fileKey(fixture.runtime.ref, "runtime/current/manifest.json");
    stores.get("ygo-content-files-v1")!.set(key, new Response("corrupt"));
    expect(
      await installer!.readFile(
        fixture.runtime.ref,
        "runtime/current/manifest.json",
      ),
    ).toMatchObject({ code: "CONTENT_INTEGRITY_FAILED" });
    expect((await installer!.current()).kind).toBe("failed");
    expect(
      await installer!.readFile(fixture.runtime.ref, "../secret"),
    ).toMatchObject({ code: "CONTENT_INVALID_MANIFEST", path: null });
  });
  it("invalid archive, truncation and wrong metadata SHA never activate", async () => {
    const fixture = await setup();
    const part = fixture.runtime.manifest.parts[0]!;
    const bytes = fixture.objects.get(`content/parts/${part.sha256}.zip`)!;
    await expect(
      extractVerifiedPart(
        bytes.subarray(0, bytes.length - 1),
        fixture.runtime.manifest.files,
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "CONTENT_ARCHIVE_REJECTED" });
    fixture.objects.set(
      `content/parts/${part.sha256}.zip`,
      new Uint8Array(part.bytes),
    );
    expect(
      await installer!.download({ kind: "all-published" }, () => undefined),
    ).toMatchObject({ code: "CONTENT_INTEGRITY_FAILED" });
    expect(await installer!.current()).toMatchObject({
      value: { generation: 0 },
    });
  });
  it("saved-ref read failure never assumes an empty retention set", async () => {
    const fixture = await setup();
    installer!.close();
    const created = await content.createContentInstaller({
      bootstrap: fixture.bootstrap,
      savedRefs: {
        read: async () => ({
          kind: "failed",
          code: "CONTENT_STORAGE_UNAVAILABLE",
          packId: null,
          path: null,
        }),
      },
      activation: { prepare: async (ref) => ({ kind: "ok", value: ref }) },
    });
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok") throw created;
    installer = created.value;
    expect(
      await installer.download({ kind: "all-published" }, () => undefined),
    ).toMatchObject({ code: "CONTENT_STORAGE_UNAVAILABLE" });
    expect(await installer.listJobs()).toEqual({ kind: "ok", value: [] });
  });
  it("corrupt persisted generation never activates or rewrites old current", async () => {
    await setup();
    const db = await openDB("ygo-story-content");
    const corrupt = { generation: "broken", current: null, previous: null };
    try {
      await db.put("active", corrupt, "current");
      expect(
        await installer!.download({ kind: "all-published" }, () => undefined),
      ).toMatchObject({ code: "CONTENT_INTEGRITY_FAILED" });
      expect(await db.get("active", "current")).toEqual(corrupt);
    } finally {
      db.close();
    }
  });
  it("unsafe archive names, aliases, bombs and symlink attributes reject", async () => {
    const fixture = await setup();
    const part = fixture.runtime.manifest.parts[0]!;
    const bytes = fixture.objects.get(`content/parts/${part.sha256}.zip`)!;
    const directory = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(bytes.length - 6, true);
    for (const mutate of [
      (view: DataView) => view.setUint32(directory + 38, 0xa0000000, true),
      (view: DataView) => view.setUint32(directory + 24, 33554433, true),
      (view: DataView) => view.setUint8(directory + 46, 47),
      (view: DataView) => view.setUint16(directory + 8, 0x801, true),
    ]) {
      const bad = bytes.slice();
      mutate(new DataView(bad.buffer));
      await expect(
        extractVerifiedPart(
          bad,
          fixture.runtime.manifest.files,
          async () => undefined,
        ),
      ).rejects.toMatchObject({ code: "CONTENT_ARCHIVE_REJECTED" });
    }
    await expect(
      extractVerifiedPart(
        bytes,
        [...fixture.runtime.manifest.files, fixture.runtime.manifest.files[0]!],
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "CONTENT_ARCHIVE_REJECTED" });
  });
  it("dependency cycles and conflicting refs reject before extraction", async () => {
    const fixture = await setup();
    await expect(
      manifestClosure([fixture.chapter.ref], async () => ({
        ...fixture.chapter.manifest,
        dependencies: [fixture.chapter.ref],
      })),
    ).rejects.toMatchObject({ code: "CONTENT_INCOMPATIBLE" });
  });
});
