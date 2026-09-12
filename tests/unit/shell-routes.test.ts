import { describe, expect, it } from "vitest";
import { deckId } from "../../src/decks/index.ts";
import {
  collectionRoute,
  deckRoute,
  deckRouteContext,
  formatAppRoute,
  handoffId,
  HOME_ROUTE,
  parseAppRoute,
  routeLabel,
  type AppRoute,
} from "../../src/shell/routes.ts";

const KNOWN_ROUTES: ReadonlyArray<readonly [string, AppRoute]> = [
  ["", HOME_ROUTE],
  ["#", HOME_ROUTE],
  ["#/", HOME_ROUTE],
  ["#/install-content", { kind: "install-content" }],
  ["#/free-play", { kind: "free-play" }],
  ["#/free-play/decks", { kind: "free-play-decks" }],
  ["#/free-play/decks/abc", { kind: "free-play-deck", deckId: deckId("abc") }],
  ["#/free-play/collection", { kind: "free-play-collection" }],
  ["#/story", { kind: "story" }],
  ["#/story/decks", { kind: "story-decks" }],
  ["#/story/decks/abc", { kind: "story-deck", deckId: deckId("abc") }],
  ["#/story/collection", { kind: "story-collection" }],
  ["#/duel/session/abc", { kind: "duel-session", handoffId: handoffId("abc") }],
  ["#/admin", { kind: "admin" }],
];

/** Every kind, so the round-trip below covers the whole union. */
const EVERY_ROUTE: readonly AppRoute[] = [
  HOME_ROUTE,
  { kind: "install-content" },
  { kind: "free-play" },
  { kind: "free-play-decks" },
  { kind: "free-play-deck", deckId: deckId("deck-1") },
  { kind: "free-play-collection" },
  { kind: "story" },
  { kind: "story-decks" },
  { kind: "story-deck", deckId: deckId("deck-1") },
  { kind: "story-collection" },
  { kind: "duel-session", handoffId: handoffId("abc") },
  { kind: "admin" },
];

describe("parseAppRoute", () => {
  it("parses every known hash", () => {
    for (const [hash, route] of KNOWN_ROUTES)
      expect(parseAppRoute(hash), hash).toEqual(route);
  });

  it("parses the free-play menu", () => {
    expect(parseAppRoute("#/free-play")).toEqual({ kind: "free-play" });
  });

  it("parses free-play decks and one deck", () => {
    expect(parseAppRoute("#/free-play/decks")).toEqual({
      kind: "free-play-decks",
    });
    expect(parseAppRoute("#/free-play/decks/abc")).toEqual({
      kind: "free-play-deck",
      deckId: deckId("abc"),
    });
  });

  it("parses the story deck routes", () => {
    expect(parseAppRoute("#/story/decks")).toEqual({ kind: "story-decks" });
    expect(parseAppRoute("#/story/decks/abc")).toEqual({
      kind: "story-deck",
      deckId: deckId("abc"),
    });
  });

  it("parses both collection routes", () => {
    expect(parseAppRoute("#/story/collection")).toEqual({
      kind: "story-collection",
    });
    expect(parseAppRoute("#/free-play/collection")).toEqual({
      kind: "free-play-collection",
    });
  });

  /* The pre-context links. A bookmark or a shared URL from before ADR-051
     still names a real screen, so it lands on that screen's new home rather
     than on the menu. */
  it("redirects the old duel route", () => {
    expect(parseAppRoute("#/duel")).toEqual({ kind: "free-play" });
  });

  it("redirects the old decks routes", () => {
    expect(parseAppRoute("#/decks")).toEqual({ kind: "free-play-decks" });
    expect(parseAppRoute("#/decks/abc")).toEqual({
      kind: "free-play-deck",
      deckId: deckId("abc"),
    });
  });

  it("keeps the duel session route", () => {
    expect(parseAppRoute("#/duel/session/h1")).toEqual({
      kind: "duel-session",
      handoffId: handoffId("h1"),
    });
  });

  it("keeps admin", () => {
    expect(parseAppRoute("#/admin")).toEqual({ kind: "admin" });
  });

  it("rejects an id that is not route-safe", () => {
    const unsafe = [
      "#/free-play/decks/a/b",
      "#/free-play/decks/bad id",
      "#/story/decks/a/b",
      "#/decks/bad id",
    ];
    for (const hash of unsafe)
      expect(parseAppRoute(hash), hash).toEqual(HOME_ROUTE);
  });

  it("falls back to home for unknown or malformed hashes", () => {
    const unknown = [
      "#/nope",
      "#/decks/",
      "#//",
      "#/duel/session/",
      "#/duel/session",
      "#/duel/extra",
      "#/decks/deck-1/extra",
      "#decks",
      "#/free-play/nope",
      "#/free-play/decks/",
      "#/story/nope",
      "#/story/collection/extra",
    ];
    for (const hash of unknown)
      expect(parseAppRoute(hash), hash).toEqual(HOME_ROUTE);
  });

  it("rejects oversized ids", () => {
    const oversized = "a".repeat(600);
    expect(parseAppRoute(`#/free-play/decks/${oversized}`)).toEqual(HOME_ROUTE);
    expect(parseAppRoute(`#/story/decks/${oversized}`)).toEqual(HOME_ROUTE);
    expect(parseAppRoute(`#/decks/${oversized}`)).toEqual(HOME_ROUTE);
    expect(parseAppRoute(`#/duel/session/${oversized}`)).toEqual(HOME_ROUTE);
  });
});

describe("formatAppRoute", () => {
  it("formats every route", () => {
    expect(formatAppRoute(HOME_ROUTE)).toBe("#/");
    expect(formatAppRoute({ kind: "install-content" })).toBe(
      "#/install-content",
    );
    expect(formatAppRoute({ kind: "free-play" })).toBe("#/free-play");
    expect(formatAppRoute({ kind: "free-play-decks" })).toBe(
      "#/free-play/decks",
    );
    expect(
      formatAppRoute({ kind: "free-play-deck", deckId: deckId("deck-1") }),
    ).toBe("#/free-play/decks/deck-1");
    expect(formatAppRoute({ kind: "free-play-collection" })).toBe(
      "#/free-play/collection",
    );
    expect(formatAppRoute({ kind: "story" })).toBe("#/story");
    expect(formatAppRoute({ kind: "story-decks" })).toBe("#/story/decks");
    expect(
      formatAppRoute({ kind: "story-deck", deckId: deckId("deck-1") }),
    ).toBe("#/story/decks/deck-1");
    expect(formatAppRoute({ kind: "story-collection" })).toBe(
      "#/story/collection",
    );
    expect(
      formatAppRoute({ kind: "duel-session", handoffId: handoffId("abc") }),
    ).toBe("#/duel/session/abc");
    expect(formatAppRoute({ kind: "admin" })).toBe("#/admin");
  });

  it("formats every route back to its canonical hash", () => {
    for (const route of EVERY_ROUTE)
      expect(parseAppRoute(formatAppRoute(route)), route.kind).toEqual(route);
  });
});

describe("routeLabel", () => {
  it("labels every route with stable user-facing copy", () => {
    const expected = [
      "Main Menu",
      "Install Content",
      "Deck Selection",
      "Deck Selection",
      "Deck Builder",
      "Collection",
      "Story",
      "Deck Library",
      "Deck Builder",
      "Collection",
      "Duel",
      "Admin",
    ];

    expect(EVERY_ROUTE.map(routeLabel)).toEqual(expected);
  });

  it("labels an unknown hash through its home fallback", () => {
    expect(routeLabel(parseAppRoute("#/unknown"))).toBe("Main Menu");
  });
});

describe("deckRoute", () => {
  it("names the library of a context when no deck is asked for", () => {
    expect(deckRoute("free-play", null)).toEqual({ kind: "free-play-decks" });
    expect(deckRoute("story", null)).toEqual({ kind: "story-decks" });
  });

  it("keeps a deck inside the context it was reached from", () => {
    expect(deckRoute("free-play", deckId("deck-1"))).toEqual({
      kind: "free-play-deck",
      deckId: deckId("deck-1"),
    });
    expect(deckRoute("story", deckId("deck-1"))).toEqual({
      kind: "story-deck",
      deckId: deckId("deck-1"),
    });
  });
});

describe("collectionRoute", () => {
  it("keeps the collection inside the context it was reached from", () => {
    expect(collectionRoute("free-play")).toEqual({
      kind: "free-play-collection",
    });
    expect(collectionRoute("story")).toEqual({ kind: "story-collection" });
  });
});

describe("deckRouteContext", () => {
  it("reports the context of every deck route", () => {
    expect(deckRouteContext({ kind: "free-play-decks" })).toBe("free-play");
    expect(
      deckRouteContext({ kind: "free-play-deck", deckId: deckId("deck-1") }),
    ).toBe("free-play");
    expect(deckRouteContext({ kind: "story-decks" })).toBe("story");
    expect(
      deckRouteContext({ kind: "story-deck", deckId: deckId("deck-1") }),
    ).toBe("story");
  });

  it("reports nothing for a route that names no deck library", () => {
    for (const route of [
      HOME_ROUTE,
      { kind: "install-content" } as const,
      { kind: "free-play" } as const,
      { kind: "free-play-collection" } as const,
      { kind: "story" } as const,
      { kind: "story-collection" } as const,
      { kind: "admin" } as const,
    ])
      expect(deckRouteContext(route), route.kind).toBeNull();
  });
});

describe("handoffId", () => {
  it("rejects values outside the id shape", () => {
    expect(() => handoffId("")).toThrow();
    expect(() => handoffId("bad id")).toThrow();
    expect(() => handoffId("a".repeat(129))).toThrow();
  });
});
