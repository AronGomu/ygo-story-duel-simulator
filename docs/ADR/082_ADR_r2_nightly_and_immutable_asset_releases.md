# ADR-082: R2 nightly and immutable asset releases

> Status: accepted; planned
> Decided: 2026-09-09
> Owners: release / asset tooling / shell
> Baseline: `3fa800c` — source baseline, not implementation evidence.
> Amends: ADR-080 D1/D2 and A4: R2 retains release objects; Pages retains core shell only; superseded nightly history has explicit finite retention.
> Relates: ADR-075 (bounded player ZIPs), ADR-076 (exact saved refs), ADR-081 (asset profiles)

## Context

Dev setup needs anonymous public asset downloads through one executable command. Maintainer needs explicit scripted upload after nightly asset additions/removals. Expected source corpus is at most about 10 GB; dev/player archives and old/new overlap add storage beyond source size. Only latest nightly is advertised now; future release versions must stay immutable.

ADR-080 selected Pages-only artifact history with no object storage. That choice does not match new separate dev archives, custom download domain and explicit uploader. Existing player ZIP limits remain appropriate for browser memory; editable developer originals need a separate streaming ZIP64 format. Existing `package.json` pins `@zip.js/zip.js` to `2.13.1` at decision baseline.

## Decision

D1. Cloudflare R2 Standard behind owner-controlled custom HTTPS download domain serves immutable asset objects. Cloudflare Pages may continue serving core PWA. Public readers need no credentials; bucket-scoped S3 credentials exist only in maintainer environment. Account/domain/cost/public-eligibility setup remains explicit owner action.

D2. One mutable channel inventory advertises latest nightly snapshot. File objects, inventories, manifests and ZIPs are content-addressed; release version pointers are create-only. Equal inputs produce identical bytes through sorted canonical metadata and fixed ZIP metadata, independent of invocation time/channel/host. Package version and selected file/profile inventory identify release inputs.

D3. Explicit publisher builds candidate, uploads/verifies objects first, commits channel inventory last with conditional write. Publish/prune serialize through owner lock; interrupted lock requires explicit owner recovery. Partial nightly target publication retains other target only for same app version; an immutable release freezes its target set at first publication.

D4. Replaced nightly snapshots remain available for at least 24 hours. Explicit reviewed prune may then remove objects not reachable from current nightly or any immutable release. Published release closures are retained indefinitely. No automatic destructive remote sync or release overwrite.

D5. Players pin immutable content-index hash and configured content base URL in shell build. Cross-origin download uses CORS and exact byte/hash validation; local synthetic Cache Storage keys remain same-origin. Installed refs do not silently follow latest nightly. Old nightly refs can become unavailable after grace; existing recoverable revision-unavailable state preserves saves. Versioned release refs retain reinstallability.

D6. Dev format permits streaming ZIP64 for large originals. Player format retains ADR-075 bounded independent ZIPs: 20 MiB compressed, 32 MiB inflated, 16 MiB per file, no ZIP64. Shared integrity primitives do not make archive formats interchangeable.

D7. Publication does not run gameplay/usage/image-validity checks. Source/license/redistribution eligibility from ADR-080 D3 remains mandatory and separate. Public links or successful checksums are not permission to redistribute. Raw originals require eligibility within approved scope too.

## Consequences

C1. Anonymous stable URLs support both CLI and browser downloads without signed-link expiry. Custom domain, CORS, credential hygiene and storage budget become owner responsibilities. This is not a guaranteed zero-cost service decision.

C2. Storage grows with immutable releases and temporarily with nightly overlap. Interrupted uploads can leave unadvertised objects; unknown orphan cleanup is not automatic. Serial lock sacrifices availability after a crashed writer until deliberate recovery.

C3. Nightly no longer promises old-checkout or old-save reinstallability forever. Immutable releases do. A retained stale nightly shell can need upgrade/repair after content expiry; no automatic save rewriting hides that tradeoff.

C4. Cloudflare Pages file-count/size budgets apply to core site, no longer entire historical asset archive. R2 availability/CORS failures remain visible download failures, not fallback to live upstream image providers.

## Alternatives rejected

A1. Overwrite one giant nightly ZIP URL: in-flight downloads risk mixed revisions; caches obscure identity.

A2. Repo-pin every nightly digest as default: asset-only latest updates require code checkout update, contrary to chosen default latest nightly.

A3. Copy all history into every Pages deploy: duplicates history transfer and inherits static-site limits for developer originals.

A4. Automatic `sync --delete`: can delete release history or files used by concurrent readers/publishers.

A5. Production and nightly source folders: publication identity does not require duplicate working assets.
