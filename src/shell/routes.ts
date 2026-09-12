import { deckId, type DeckId } from "../decks/index.ts";

/* Route ids travel in the URL hash, so they stay restricted to characters that
   survive a copy-paste without escaping and cannot smuggle a path segment. */
const ROUTE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type HandoffId = string & { readonly __handoffId: unique symbol };

export function handoffId(value: string): HandoffId {
  if (!ROUTE_ID.test(value)) throw new Error("Handoff ID is invalid");
  return value as HandoffId;
}

/** The world a deck or collection route belongs to. Decks mean two different
    things — a loaded save's decks or the free-play library — so the route says
    which, and a deep link cannot silently open the wrong one (ADR-051). */
export type RouteContext = "free-play" | "story";

export type AppRoute =
  | { readonly kind: "home" }
  | { readonly kind: "install-content" }
  | { readonly kind: "free-play" }
  | { readonly kind: "free-play-decks" }
  | { readonly kind: "free-play-deck"; readonly deckId: DeckId }
  | { readonly kind: "free-play-collection" }
  | { readonly kind: "story" }
  | { readonly kind: "story-decks" }
  | { readonly kind: "story-deck"; readonly deckId: DeckId }
  | { readonly kind: "story-collection" }
  | { readonly kind: "duel-session"; readonly handoffId: HandoffId }
  | { readonly kind: "admin" };

export const HOME_ROUTE: AppRoute = { kind: "home" };
export const INSTALL_CONTENT_ROUTE: AppRoute = { kind: "install-content" };

/** The deck route `context` owns: its library when `id` is `null`, that one
    deck otherwise. */
export function deckRoute(context: RouteContext, id: DeckId | null): AppRoute {
  if (context === "story")
    return id === null
      ? { kind: "story-decks" }
      : { kind: "story-deck", deckId: id };
  return id === null
    ? { kind: "free-play-decks" }
    : { kind: "free-play-deck", deckId: id };
}

/** The collection route `context` owns, in the shape `deckRoute` above has for
    decks. It is a function for the same reason that one is: the deck menu that
    offers the collection is one screen serving both worlds, and a route
    hardcoded there would open one world's cards from the other's library
    (ADR-051). */
export function collectionRoute(context: RouteContext): AppRoute {
  return context === "story"
    ? { kind: "story-collection" }
    : { kind: "free-play-collection" };
}

/** The context a deck route names, or `null` when the route names no deck
    library — so one deck-editor region can serve both worlds and hand
    navigation back in the context it was reached from. */
export function deckRouteContext(route: AppRoute): RouteContext | null {
  switch (route.kind) {
    case "free-play-decks":
    case "free-play-deck":
      return "free-play";
    case "story-decks":
    case "story-deck":
      return "story";
    default:
      return null;
  }
}

/** The context a first path segment names, or `null` when it names none. */
function segmentContext(segment: string | undefined): RouteContext | null {
  if (segment === "free-play") return "free-play";
  if (segment === "story") return "story";
  return null;
}

export function parseAppRoute(hash: string): AppRoute {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  if (path === "" || path === "/") return HOME_ROUTE;
  if (!path.startsWith("/")) return HOME_ROUTE;
  const segments = path.slice(1).split("/");
  const [first, second, third] = segments;

  if (segments.length === 1) {
    switch (first) {
      /* `#/duel` and `#/decks` are the links from before routes carried a
         context. They redirect rather than 404 so bookmarks and shared URLs
         keep landing on the screen they named. */
      case "install-content":
        return INSTALL_CONTENT_ROUTE;
      case "duel":
      case "free-play":
        return { kind: "free-play" };
      case "decks":
        return { kind: "free-play-decks" };
      case "story":
        return { kind: "story" };
      case "admin":
        return { kind: "admin" };
      default:
        return HOME_ROUTE;
    }
  }

  const context = segmentContext(first);

  if (segments.length === 2 && context !== null) {
    if (second === "decks") return deckRoute(context, null);
    if (second === "collection") return collectionRoute(context);
    return HOME_ROUTE;
  }

  if (
    segments.length === 3 &&
    context !== null &&
    second === "decks" &&
    third !== undefined &&
    ROUTE_ID.test(third)
  )
    return deckRoute(context, deckId(third));

  if (
    segments.length === 3 &&
    first === "duel" &&
    second === "session" &&
    third !== undefined &&
    ROUTE_ID.test(third)
  )
    return { kind: "duel-session", handoffId: handoffId(third) };

  /* The pre-context single deck, redirected like its library above. */
  if (
    segments.length === 2 &&
    first === "decks" &&
    second !== undefined &&
    ROUTE_ID.test(second)
  )
    return deckRoute("free-play", deckId(second));

  return HOME_ROUTE;
}

export function routeLabel(route: AppRoute): string {
  switch (route.kind) {
    case "home":
      return "Main Menu";
    case "install-content":
      return "Install Content";
    case "free-play":
    case "free-play-decks":
      return "Deck Selection";
    case "free-play-deck":
    case "story-deck":
      return "Deck Builder";
    case "free-play-collection":
    case "story-collection":
      return "Collection";
    case "story":
      return "Story";
    case "story-decks":
      return "Deck Library";
    case "duel-session":
      return "Duel";
    case "admin":
      return "Admin";
  }
}

export function formatAppRoute(route: AppRoute): string {
  switch (route.kind) {
    case "home":
      return "#/";
    case "install-content":
      return "#/install-content";
    case "free-play":
      return "#/free-play";
    case "free-play-decks":
      return "#/free-play/decks";
    case "free-play-deck":
      return `#/free-play/decks/${route.deckId}`;
    case "free-play-collection":
      return "#/free-play/collection";
    case "story":
      return "#/story";
    case "story-decks":
      return "#/story/decks";
    case "story-deck":
      return `#/story/decks/${route.deckId}`;
    case "story-collection":
      return "#/story/collection";
    case "duel-session":
      return `#/duel/session/${route.handoffId}`;
    case "admin":
      return "#/admin";
  }
}
