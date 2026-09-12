import { describe, expect, it, vi } from "vitest";
import { deckId } from "../../src/decks/index.ts";
import {
  coreGateMessage,
  loadCoreStartup,
  routeForCoreGate,
  type CoreGate,
} from "../../src/shell/core/core-gate.ts";
import {
  INSTALL_CONTENT_ROUTE,
  type AppRoute,
} from "../../src/shell/routes.ts";

const bootstrap = {
  schemaVersion: 1,
  appSchemaVersion: 1,
  contentSchemaVersion: 2,
  hashAlgorithm: "SHA-256",
  delivery: null,
  chapters: [
    {
      id: "chapter-01",
      title: "DM",
      description: "Current Chapter 1 prototype.",
    },
  ],
} as const;

const locked: CoreGate = { kind: "locked", reason: "content-required" };
const ready: CoreGate = {
  kind: "ready",
  chapterIds: ["chapter-01"],
  generation: 1,
};

const gameplayRoutes: readonly AppRoute[] = [
  { kind: "free-play" },
  { kind: "free-play-decks" },
  { kind: "free-play-deck", deckId: deckId("one") },
  { kind: "free-play-collection" },
  { kind: "story" },
  { kind: "story-decks" },
  { kind: "story-deck", deckId: deckId("one") },
  { kind: "story-collection" },
  { kind: "duel-session", handoffId: "session" as never },
  { kind: "admin" },
];

describe("CORE startup gate", () => {
  it("treats delivery:null as content unavailable, not a network failure", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(bootstrap), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const startup = await loadCoreStartup(
      fetch,
      "http://127.0.0.1:4202/game/",
      {} as IDBFactory,
    );

    expect(startup).toStrictEqual({ bootstrap, gate: locked });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4202/game/core-bootstrap.json",
      {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      },
    );
    expect(coreGateMessage(startup.gate)).toContain("Content is required");
  });

  it("reports malformed bootstrap as content-invalid", async () => {
    const startup = await loadCoreStartup(
      async () => new Response("{}", { status: 200 }),
      "https://example.test/game/",
      {} as IDBFactory,
    );

    expect(startup).toStrictEqual({
      bootstrap: null,
      gate: { kind: "locked", reason: "content-invalid" },
    });
  });

  it("reports missing browser storage only for an available delivery", async () => {
    const available = {
      ...bootstrap,
      delivery: {
        baseUrl: "https://cdn.example.test/",
        index: { sha256: "a".repeat(64), bytes: 123 },
      },
    };
    const startup = await loadCoreStartup(
      async () => new Response(JSON.stringify(available), { status: 200 }),
      "https://example.test/game/",
      undefined,
    );

    expect(startup.gate).toStrictEqual({
      kind: "locked",
      reason: "storage-unavailable",
    });
  });

  it.each([{ kind: "checking" } as CoreGate, locked])(
    "projects every gameplay route to installer while $kind",
    (gate) => {
      for (const route of gameplayRoutes)
        expect(routeForCoreGate(route, gate), route.kind).toBe(
          INSTALL_CONTENT_ROUTE,
        );
    },
  );

  it("keeps CORE routes available while locked", () => {
    expect(routeForCoreGate({ kind: "home" }, locked)).toStrictEqual({
      kind: "home",
    });
    expect(routeForCoreGate(INSTALL_CONTENT_ROUTE, locked)).toBe(
      INSTALL_CONTENT_ROUTE,
    );
  });

  it("keeps gameplay routes unchanged only when ready", () => {
    for (const route of gameplayRoutes)
      expect(routeForCoreGate(route, ready)).toBe(route);
  });
});
