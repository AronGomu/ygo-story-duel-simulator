# CORE Installation — Final Implementation Report

Status: **in progress**

Plan: `PLAN_2026_09_12_core_installation`

## Ticket State List

| Ticket | State | Evidence / next dependency |
| --- | --- | --- |
| T1 — source readiness | COMPLETE | Worker `7621123`; merge `7f78229`; 193 ticket tests; parent 86 focused tests. |
| T2 — asset-free CORE boot | COMPLETE | Worker `4760c7f`; merge `c31588f`; 68 unit + 5 component + 4 Chromium tests; parent 73 focused tests + typecheck. |
| T3 — chapter packs | COMPLETE | Worker `4204cdc`; merge `ad5fecc`; fourth independent review approved; parent 73 Node + 14 Vitest tests + typecheck. Verified pack index `03571be5…08d0`. |
| T4 — verified installer | READY | Depends on complete T2 + T3. |
| T5 — installed union | WAITING | Depends on T4. |
| T6 — installed Free Play | WAITING | Depends on T5. |
| T7 — installed Story/saves | WAITING | Depends on T6. |
| T8 — lifecycle | WAITING | Depends on T6 + T7. |
| T9 — offline shell | WAITING | Depends on T4. |
| T10 — acceptance | WAITING | Depends on T8 + T9. |

## Delivered

| Area | Result | Source |
| --- | --- | --- |
| Source normalization | 75 sets; 1,627 cards; approved alias/exclusions enforced; raw source unchanged | `scripts/lib/chapter-source-policy.ts`; `artifacts/CORE_ACCEPTANCE/T1/validation.json` |
| CORE boot | Source-only menu/settings/installer shell; gameplay gated before domain startup | `src/shell/core/core-gate.ts`; `src/shell/screens/InstallContentScreen.svelte` |
| Chapter packs | Schema-2 real gameplay/story/media producer and verifier; 1,627 full + cropped images | `scripts/lib/asset-delivery/chapter-gameplay.ts`; `scripts/lib/asset-delivery/verify-chapter-gameplay.ts` |
| Set media | 56 verified set images; 19 evidence-backed nullable images; text-only UI fallback | `content/authoring/chapter-one-set-media.json`; `src/story/shop/ShopBrowseScreen.svelte` |
| Browser delivery | Served index bytes verified with browser `crypto.subtle.digest` | `e2e-core/chapter-content-delivery.spec.ts`; `artifacts/CORE_ACCEPTANCE/T3/` |

## Assumptions

### A1 — Nullable set art approved

Owner approved `ChapterSet.image: ChapterFileRef | null` only when pinned authoritative provider evidence proves no image exists. All 75 sets remain. UI uses text-only fallback. Placeholder art forbidden.

### A2 — Private-only scope remains

No public release, remote publish, vendor update, or redistribution-rights claim performed.

### A3 — Exact-source policy remains

Raw card-set source and frozen vendor remain unchanged. Generated chapter payloads derive from normalized/pinned sources.

## User TODO

None for current private loopback implementation.

## Residual Risks

- Public release still requires license, host, and device evidence.
- Graph refresh failed with Gemini API `429 RESOURCE_EXHAUSTED`; existing graph was preserved instead of replacing it with partial output.
- Untouched `e2e/asset-root-urls.spec.ts` retains a pre-existing Prettier warning.
- `TEST-LOADING-ASSETS.md`, `feedback.md`, CORE spec, and grill records remain preserved.

## Git State

T1–T3 merged on `main`. T3 reviewed branch `feat/core-install-t3` is pushed. No history rewrite, force-push, system apply, deployment, or publication performed.
