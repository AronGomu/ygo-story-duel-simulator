# CORE Installation — Final Implementation Report

Status: **blocked**

Plan: `PLAN_2026_09_12_core_installation`

## Ticket State List

| Ticket | State | Evidence / blocker |
| --- | --- | --- |
| T1 — source readiness | COMPLETE | Worker commit `7621123`; merged by `7f78229`; 193 ticket tests passed in `artifacts/CORE_ACCEPTANCE/T1/validation.json`; parent rerun 86 focused tests passed. |
| T2 — asset-free CORE boot | COMPLETE | Worker commit `4760c7f`; merged by `c31588f`; 68 unit + 5 component + 4 Chromium source-only tests passed; parent rerun 73 focused tests plus typecheck passed. |
| T3 — chapter packs | BLOCKED | YGOPRODeck returned no `set_image` for 19 required promo/participation sets. Contract requires real non-null `ChapterSet.image`; placeholders, nullable refs, silent drops forbidden. Partial work remains uncommitted in `.tmp/worktrees/core-install-t3` on `feat/core-install-t3`. |
| T4 — verified installer | BLOCKED | Depends on complete T3 schema-2 real pack. |
| T5 — installed union | BLOCKED | Depends on T4. |
| T6 — installed Free Play | BLOCKED | Depends on T5. |
| T7 — installed Story/saves | BLOCKED | Depends on T6. |
| T8 — lifecycle | BLOCKED | Depends on T6 + T7. |
| T9 — offline shell | BLOCKED | Depends on T4. |
| T10 — acceptance | BLOCKED | Depends on T8 + T9. |

## Delivered

| Area | Result | Source |
| --- | --- | --- |
| Source normalization | 75 sets; 1,627 cards; approved alias/exclusions enforced; raw source SHA unchanged | `scripts/lib/chapter-source-policy.ts`; `artifacts/CORE_ACCEPTANCE/T1/validation.json` |
| CORE boot | Source-only menu/settings/installer shell; gameplay gate before domain startup; no runtime asset prerequisite | `src/shell/core/core-gate.ts`; `src/shell/screens/InstallContentScreen.svelte`; `playwright.core.config.ts` |
| Build | Normal CORE build no longer requires acquired roots | `vite.config.ts`; `scripts/lib/vite-core-content.ts` |
| Docs | Accepted ADR-084–088 plus setup guide | `docs/ADR/084_ADR_asset_free_core_boot.md`; `docs/assets/core-installation.md` |

## T3 Blocker Evidence

YGOPRODeck query: `https://db.ygoprodeck.com/api/v7/cardsets.php`.

Observed T3 partial pipeline:

- 75 sets, 1,627 cards, 4,514 printing rows.
- 2 decks, 3 opponents, 30 story beats.
- 1,627 full images present.
- 1,627 cropped images present: 1,591 downloaded, 36 cached, 0 missing.
- 56 set images present; 19 required set images absent from provider records.
- `npm run content:catalog` passed.
- `npx tsc --noEmit` passed before hard stop.
- `npx vitest run tests/unit/chapter-gameplay.test.ts` passed 4/4.
- `git diff --check` passed in T3 worktree.

Missing set images:

1. Yu-Gi-Oh! Dark Duel Stories promotional cards
2. Yu-Gi-Oh! The Eternal Duelist Soul promotional cards
3. Yu-Gi-Oh! The Duelists of the Roses promotional cards
4. Yu-Gi-Oh! Worldwide Edition: Stairway to the Destined Duel promotional cards
5. Yu-Gi-Oh! The Sacred Cards promotional cards
6. Hobby League 1 participation cards B
7. Yu-Gi-Oh! World Championship Tournament 2004 promotional cards
8. Yu-Gi-Oh! The Dawn of Destiny promotional cards
9. Yu-Gi-Oh! Reshef of Destruction promotional cards
10. Movie Pack
11. Collectible Tins 2004
12. Hobby League 1 participation cards A
13. Yu-Gi-Oh! Destiny Board Traveler promotional cards
14. Duelist League Series 6 participation card
15. Master Collection Volume 1
16. Hobby League 1 participation cards C
17. Yu-Gi-Oh! 7 Trials to Glory: World Championship Tournament 2005 promotional cards
18. Flaming Eternity Sneak Peek Participation Card
19. Duelist League Series 7 participation card

## Assumptions

### A1 — Contract remains binding

`ChapterSet.image` stays required. No nullable weakening, placeholder art, or silent set removal without explicit approved plan amendment.

### A2 — Private-only scope remains

No public release, remote publish, vendor update, or redistribution-rights claim performed.

### A3 — Partial T3 work stays recoverable

Uncommitted T3 worktree preserved rather than merged as completed work. No incomplete T3 commit pushed.

## User TODO

- [ ] Provide owner-approved authoritative image provider plus source/license policy for 19 named sets, **or** explicitly amend scope to permit nullable set images. Validation: provider yields lawful real media for every listed set, or revised contract names exact fallback behavior.

## Residual Risks

- Graph refresh failed with Gemini API `429 RESOURCE_EXHAUSTED`; existing `graphify-out/graph.json` was not replaced by partial output.
- T3 combined Node suite reached 72/73 before fixture repair; repaired focused test passed, but full final suite was not rerun after hard stop.
- T3 worktree contains 39 Git-visible partial paths. Preserve `.tmp/worktrees/core-install-t3` until blocker resolved.
- `TEST-LOADING-ASSETS.md`, `feedback.md`, raw source, CORE spec, and grill records remain preserved.

## Git State

T1/T2 merged and pushed to `origin/main` at `c31588f`. T3 branch points at same base with uncommitted partial work. No history rewrite, force-push, system apply, deployment, or publication performed.
