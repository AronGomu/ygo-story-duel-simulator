import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_SHARD_COUNT,
  catalogShardName,
  createFetchShardReader,
  loadRuntimeCatalog,
  runtimeCatalog,
  setRuntimeCatalogForTests,
  type CatalogShardReader,
} from "../../../src/decks/catalog/runtime-catalog.ts";
import { resetRuntimeCatalog } from "../../fixtures/active-catalog.ts";
import {
  PROTOTYPE_CATALOG,
  PROTOTYPE_CATALOG_ASSETS,
  PROTOTYPE_CATALOG_TEXTS,
} from "../../../src/deck-editor/fixtures/catalog.ts";

/* The runtime shards are bucketed by `code % 64`, so a reader standing in for
   them buckets the same way. A loader that asked for the wrong shard would
   still build a catalog against a reader that answered every path with every
   card, and the test would pass while production returned nothing. */
function shardRows(relativePath: string): unknown[] {
  const shard = relativePath.slice(-7, -5);
  const inShard = ({ code }: { code: number }) =>
    catalogShardName(code % CATALOG_SHARD_COUNT) === shard;
  return relativePath.includes("/texts/")
    ? PROTOTYPE_CATALOG_TEXTS.filter(inShard)
    : PROTOTYPE_CATALOG_ASSETS.filter(inShard);
}

interface RecordingReader extends CatalogShardReader {
  readonly paths: readonly string[];
}

function recordingReader(
  failOn?: string,
  onRead?: () => void,
): RecordingReader {
  const paths: string[] = [];
  return {
    paths,
    readJson<T>(relativePath: string): Promise<T> {
      paths.push(relativePath);
      onRead?.();
      if (relativePath === failOn)
        return Promise.reject(new Error(`unreadable: ${relativePath}`));
      return Promise.resolve(shardRows(relativePath) as T);
    },
  };
}

function shardPaths(): readonly string[] {
  return Array.from({ length: CATALOG_SHARD_COUNT }, (_, shard) => [
    `assets/current/catalog/cards/${catalogShardName(shard)}.json`,
    `assets/current/catalog/texts/en/${catalogShardName(shard)}.json`,
  ]).flat();
}

const SNAPSHOT_ID = "a".repeat(64);
const MANIFEST_URL = "/app/runtime/current/manifest.json";

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface SnapshotServer {
  readonly pin: {
    readonly expectedManifestSha256: string;
    readonly expectedSnapshotId: string;
  };
  readonly urls: readonly string[];
  fetch(url: string): Promise<Response>;
}

/**
 * A server that answers the runtime asset URLs the way a real build does:
 * a manifest naming every shard with its true digest, and shard bodies that
 * digest to what the manifest says. `damage` rewrites one body after the
 * manifest was built, which is exactly the stale-cache case.
 */
async function snapshotServer(options?: {
  readonly damage?: string;
  readonly manifestSnapshotId?: string;
  readonly extraCardShards?: number;
  readonly missingStatus?: Readonly<Record<string, number>>;
}): Promise<SnapshotServer> {
  const bodies = new Map<string, string>();
  for (const relative of shardPaths())
    bodies.set(
      relative.slice("assets/current/".length),
      JSON.stringify(shardRows(relative)),
    );

  const files = await Promise.all(
    [...bodies].map(async ([path, body]) => ({
      path,
      bytes: body.length,
      sha256: await sha256Hex(body),
    })),
  );
  for (let extra = 0; extra < (options?.extraCardShards ?? 0); extra += 1)
    files.push({
      path: `catalog/cards/${(CATALOG_SHARD_COUNT + extra).toString(16)}.json`,
      bytes: 2,
      sha256: await sha256Hex("[]"),
    });

  const manifestBody = JSON.stringify({
    schemaVersion: 1,
    snapshotId: options?.manifestSnapshotId ?? SNAPSHOT_ID,
    assets: { files },
  });
  if (options?.damage !== undefined)
    bodies.set(options.damage, JSON.stringify([{ code: 1, name: "Impostor" }]));

  const urls: string[] = [];
  return {
    pin: {
      expectedManifestSha256: await sha256Hex(manifestBody),
      expectedSnapshotId: SNAPSHOT_ID,
    },
    urls,
    fetch(url: string): Promise<Response> {
      urls.push(url);
      const status = options?.missingStatus?.[url];
      if (status !== undefined)
        return Promise.resolve(new Response("", { status }));
      if (url === MANIFEST_URL)
        return Promise.resolve(new Response(manifestBody, { status: 200 }));
      const body = bodies.get(url.slice("/app/runtime/assets/current/".length));
      return Promise.resolve(
        body === undefined
          ? new Response("", { status: 404 })
          : new Response(body, { status: 200 }),
      );
    },
  };
}

afterEach(() => {
  resetRuntimeCatalog();
  vi.unstubAllGlobals();
});

describe("catalogShardName", () => {
  it("names shards as lowercase two-digit hex", () => {
    expect(catalogShardName(0)).toBe("00");
    expect(catalogShardName(7)).toBe("07");
    expect(catalogShardName(CATALOG_SHARD_COUNT - 1)).toBe("3f");
  });
});

describe("loadRuntimeCatalog", () => {
  it("reads all sixty-four card and text shards", async () => {
    const reader = recordingReader();
    await loadRuntimeCatalog(reader, "/");
    expect(reader.paths).toHaveLength(2 * CATALOG_SHARD_COUNT);
    expect([...reader.paths].sort()).toEqual([...shardPaths()].sort());
  });

  it("gives every card a conventional image url", async () => {
    const cards = await loadRuntimeCatalog(recordingReader(), "/app/");
    expect(cards).toHaveLength(PROTOTYPE_CATALOG_ASSETS.length);
    for (const card of cards)
      expect(card.imageUrl).toBe(`/app/runtime/images/${card.code}.jpg`);
  });

  it("loads cards in exact English name and code order", async () => {
    const cards = await loadRuntimeCatalog(recordingReader(), "/");
    const collator = new Intl.Collator("en", { sensitivity: "base" });
    expect(cards).toEqual(
      [...cards].sort(
        (left, right) =>
          collator.compare(left.name, right.name) || left.code - right.code,
      ),
    );
  });

  it("rejects with the name of the shard that failed", async () => {
    const reader = recordingReader("assets/current/catalog/cards/07.json");
    await expect(loadRuntimeCatalog(reader, "/")).rejects.toThrow(
      "assets/current/catalog/cards/07.json",
    );
  });
});

describe("createFetchShardReader", () => {
  it("reads a shard from below the runtime asset root", async () => {
    const server = await snapshotServer();
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    const rows = await createFetchShardReader("/app/", server.pin).readJson(
      "assets/current/catalog/cards/00.json",
    );
    expect(server.urls).toContain(
      "/app/runtime/assets/current/catalog/cards/00.json",
    );
    expect(rows).toEqual(shardRows("assets/current/catalog/cards/00.json"));
  });

  it("names the shard when the response is not ok", async () => {
    const server = await snapshotServer({
      missingStatus: {
        "/app/runtime/assets/current/catalog/cards/07.json": 404,
      },
    });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    await expect(
      createFetchShardReader("/app/", server.pin).readJson(
        "assets/current/catalog/cards/07.json",
      ),
    ).rejects.toThrow(
      "Runtime catalog shard failed: assets/current/catalog/cards/07.json",
    );
  });

  /* The runtime URLs carry no content hash, so a stale Cache Storage entry or a
     deploy caught half-rolled answers them with another snapshot's cards. The
     editor would offer those codes and the Worker would refuse the deck they
     built, which is the one disagreement the shared catalog exists to prevent. */
  it("refuses a shard body that is not the one the manifest declares", async () => {
    const server = await snapshotServer({
      damage: "catalog/cards/03.json",
    });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    await expect(
      createFetchShardReader("/app/", server.pin).readJson(
        "assets/current/catalog/cards/03.json",
      ),
    ).rejects.toThrow(
      "Runtime catalog shard failed: assets/current/catalog/cards/03.json",
    );
  });

  it("refuses a manifest that is not the digest this build pinned", async () => {
    const server = await snapshotServer();
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    await expect(
      createFetchShardReader("/app/", {
        ...server.pin,
        expectedManifestSha256: "b".repeat(64),
      }).readJson("assets/current/catalog/cards/00.json"),
    ).rejects.toThrow("Runtime catalog shard failed");
  });

  it("refuses a manifest that describes another snapshot", async () => {
    const server = await snapshotServer({
      manifestSnapshotId: "c".repeat(64),
    });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    await expect(
      createFetchShardReader("/app/", server.pin).readJson(
        "assets/current/catalog/cards/00.json",
      ),
    ).rejects.toThrow("Runtime catalog shard failed");
  });

  /* The Worker refuses a script index bucketed any other way. Sixty-four of a
     hundred and twenty-eight buckets is half a database that looks whole, and
     the duel picker validates against the same catalog, so the duel would
     agree with the editor about the missing half. */
  it("refuses a snapshot bucketed into more shards than it reads", async () => {
    const server = await snapshotServer({ extraCardShards: 1 });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    const failure = await createFetchShardReader("/app/", server.pin)
      .readJson("assets/current/catalog/cards/00.json")
      .catch((error: unknown) => error as Error);
    expect((failure as Error).cause).toMatchObject({
      message: `Unsupported catalog shard count: ${CATALOG_SHARD_COUNT + 1}`,
    });
  });

  /* A connection accepted and never answered has no default deadline, so the
     editor sat on its loading skeleton and the duel listed no local deck, with
     neither reaching the error branch that offers a retry. */
  it("gives up on a connection that is never answered", async () => {
    const server = await snapshotServer();
    /* A server that accepts and then says nothing at all: this promise settles
       only because the request carries a deadline of its own. */
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason as Error),
            );
          }),
      ),
    );
    const failure = (await createFetchShardReader("/app/", server.pin, 20)
      .readJson("assets/current/catalog/cards/00.json")
      .catch((error: unknown) => error)) as Error;
    expect(failure.message).toBe(
      "Runtime catalog shard failed: assets/current/catalog/cards/00.json",
    );
    expect((failure.cause as Error).name).toBe("TimeoutError");
  });
});

describe("runtimeCatalog", () => {
  it("loads the catalog once per page", async () => {
    const server = await snapshotServer();
    vi.stubGlobal(
      "__RUNTIME_MANIFEST_SHA256__",
      server.pin.expectedManifestSha256,
    );
    vi.stubGlobal("__RUNTIME_SNAPSHOT_ID__", SNAPSHOT_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => server.fetch(url.replace(/^\//, "/app/"))),
    );
    const [first, second] = await Promise.all([
      runtimeCatalog(),
      runtimeCatalog(),
    ]);
    expect(server.urls).toHaveLength(1 + 2 * CATALOG_SHARD_COUNT);
    expect(second).toBe(first);
    expect(await runtimeCatalog()).toBe(first);
    expect(server.urls).toHaveLength(1 + 2 * CATALOG_SHARD_COUNT);
  });

  /* One transient failure in the duel used to leave `#/decks` dead on arrival
     in the same page load, never even attempting a fetch of its own. */
  it("does not keep a rejection, so the next caller retries", async () => {
    const server = await snapshotServer();
    vi.stubGlobal(
      "__RUNTIME_MANIFEST_SHA256__",
      server.pin.expectedManifestSha256,
    );
    vi.stubGlobal("__RUNTIME_SNAPSHOT_ID__", SNAPSHOT_ID);
    let offline = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        offline
          ? Promise.reject(new Error("offline"))
          : server.fetch(url.replace(/^\//, "/app/")),
      ),
    );

    await expect(runtimeCatalog()).rejects.toThrow(
      "Runtime catalog shard failed",
    );

    offline = false;
    await expect(runtimeCatalog()).resolves.toHaveLength(
      PROTOTYPE_CATALOG_ASSETS.length,
    );
  });

  it("serves the fixture a test installed instead of fetching", async () => {
    setRuntimeCatalogForTests(PROTOTYPE_CATALOG);
    vi.stubGlobal("fetch", () => {
      throw new Error("a test seam must not reach the network");
    });
    await expect(runtimeCatalog()).resolves.toBe(PROTOTYPE_CATALOG);
  });
});
