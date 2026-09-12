# ADR-051: Main menu, Free Play mode and route contexts

Status: accepted · 2026-08-20 · Shipped: `7638f24` (T14), `a9cdd43` (T15), `21acd24` (T16), `22f868b` (T17) · Plan commit: `9d8b8a7`
Superseded in part by ADR-054: the free-play menu described below is gone, and `#/free-play` renders the match setup itself. Everything else here stands.
Relates: ADR-022 (modular monolith), ADR-049 (save-owned decks)
Amended by [ADR-084](084_ADR_asset_free_core_boot.md) and [ADR-086](086_ADR_installed_chapters_own_gameplay_catalog.md): asset-free CORE gates gameplay; Free Play collection uses installed chapter union, not whole runtime DB.

## Context

The shell home screen listed Story, Decks and Duel as three peers, then the story's own title screen listed New Game, Continue, Load — two menus in a row, the second one the real one.

Two things broke the peer model:

1. **The game has a front door.** The visual novel's title is what a player should meet first; "Duel" as a top-level entry is a developer's view of the app, not a game's.
2. **"Decks" now means two things** (ADR-049): a save's decks, or the free-play library. A single `#/decks` route cannot say which, and a bookmarked link would mean whichever mode you happened to be in.

Constraint: the shell loads each domain on demand (`domain-loaders.ts`) and `build:verify` enforces a byte budget per domain chunk. Making the story's title screen the app root would pull the whole visual novel into first paint.

## Decision

**The main menu is a shell screen, styled like the story's title.** New Game, Continue, Load, Settings, then **Free Play last**. The story domain stays lazy; the menu reads save presence through the story-saves database _name_ (a string constant), never by importing a story component.

**Free Play is an explicit mode.** `#/free-play` offers Start a match, Deck builder and Return. A match picks both decks — yours and the opponent's, from bundled presets or your own free-play builds — and remembers the pairing. (ADR-054 replaced that menu with the deck seats themselves; the mode, the pairing and the memory of it are unchanged.)

**Routes carry their context:**

| Route                       | Meaning                      |
| --------------------------- | ---------------------------- |
| `#/`                        | main menu                    |
| `#/story`                   | the visual novel             |
| `#/story/decks(/:id)`       | the loaded save's decks      |
| `#/story/collection`        | the loaded save's collection |
| `#/free-play`               | free-play match setup        |
| `#/free-play/decks(/:id)`   | the free-play library        |
| `#/free-play/collection`    | the whole card database      |
| `#/duel/session/:handoffId` | a duel the shell is running  |
| `#/admin`                   | admin console                |

`#/duel` redirects to `#/free-play` and `#/decks(/:id)` to `#/free-play/decks(/:id)`, so old bookmarks and the PWA start URL keep working. Settings is a dialog reachable from any menu, never a route.

A story-scoped route reached with no save loaded returns to the main menu rather than rendering an empty screen.

## Consequences

- One front door; the duplicate menu is gone.
- A URL always names its context, so a deep link cannot silently mean the wrong deck list, and the E2E suite can address either world directly.
- The entry chunk keeps its budget: the menu is shell code, and story, deck-editor and battle all stay behind their loaders.
- `AppRoute` grew from 7 kinds to 11 — the table above, one kind per row and one more for each `(/:id)`. `duel`, `decks` and `deck` left the union rather than joining it: nothing can produce a kind whose only hash now parses to another one. `formatAppRoute`'s exhaustive switch and `ROUTE_INDEX` in the admin console both fail to compile on a missing case, which is the intended pressure.
- Cost: the main menu is authored twice in spirit — the shell's menu and the story's in-playthrough title treatment. Accepted as the price of keeping the visual novel lazy.
