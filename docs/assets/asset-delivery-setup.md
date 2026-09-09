# Asset delivery setup

T1 provides read-only setup, strict Node-only schemas, path guards, common local lock, rights-scope parsing. Migration, bundling, publishing, downloading, pruning and player installation remain separate slices. Existing `assets:mvp`, `content:setup:verify` and private build paths are unchanged.

## Developer setup — no publisher credentials

- D1. Install Node.js 24+, Git and npm. Run `node --version`, `git --version`, `npm --version`, then `npm ci` from this checkout. No S3 CLI or publisher credentials are needed for developer downloads.
- D2. Continue using the existing README acquisition workflow until `assets:download` lands. The planned anonymous download restores all extant bytes under four managed roots, including originals and unused files. It does not guarantee all possible upstream assets exist or that gameplay readiness passes.
- D3. Run `npm run assets:setup -- --help`. Local `--check` validates `asset-delivery.config.json` and credential presence only; missing publisher credentials do not fail developer usage. Missing config fails explicitly with `ASSET_REFERENCE_MISSING`. No config or evidence files are created automatically.
- D4. Local syntax success is not publication approval, credential verification, hosted availability, or native-player acceptance. Progress is JSON on stderr; final stdout is `AssetResult`. Exit 0 = check complete, 2 = expected invalid/missing/conflicting/resource state, 1 = unexpected internal failure. Errors never contain credential values, signed URLs, provider bodies, or unsafe input paths.

## Owner prerequisites — complete before any publication

Automation cannot supply these owner facts. Record completion versus pending in a local nonsecret checklist; keep existing `content/setup-evidence.json` and `content/distribution-evidence.json` as their respective PWA/evidence records. Do not put secrets in JSON, Git, screenshots, reports, shell history or command arguments.

| ID | Prerequisite | Current T1 evidence / owner action |
| --- | --- | --- |
| O1 | Node24/Git/npm | Fixture-tested on Node24; each developer verifies local tools and runs `npm ci` |
| O2 | Cloudflare R2 account | Pending; owner creates/enables account, activates R2 and payment method if Cloudflare requires it |
| O3 | Standard bucket | Pending; owner creates a Standard-storage bucket; no Infrequent Access substitution |
| O4 | Custom public DNS domain | Pending; owner chooses, acquires if needed, connects HTTPS custom domain to bucket; `r2.dev` is not production delivery |
| O5 | Exact dev/prod app origins | Pending; owner records actual localhost dev origin(s), production Pages/custom app origin(s), any intentional preview origins; no wildcard origin |
| O6 | Bucket-scoped S3 credentials | Pending; owner creates scoped credentials for this bucket, sets local environment securely; grants only permissions needed for intended operation |
| O7 | Rights/source obligations | Pending; owner reviews engine/scripts source obligations, DB terms, artwork and story-original permissions, unreleased public scope; existing source approval is not blanket future-original approval |
| O8 | Budget acknowledgment | Pending; estimate source corpus + dev ZIP + prod/core packs + immutable releases + at least 24h replaced-nightly overlap + retained metadata + request counts. 10 GB is a corpus estimate, not a billing cap or promised free tier |
| O9 | PWA project/protection | Existing PWA setup owns Pages project, GitHub production protection and its credentials; continue `npm run content:setup:verify`; do not replace its records |
| O10 | Native access | Existing PWA setup requires Android, iPhone and iPad testers/devices. Access attestation is not install/quota/reopen proof; native tests remain pending |
| O11 | Initial empty publication state | Pending; perform the explicit, owner-run bootstrap below only for a genuinely new empty publication namespace |

### Public config

Create `asset-delivery.config.json` locally with your actual domain and bucket. This example is reserved fixture data, not a working endpoint. Config contains no credentials; do not add keys.

```json
{
  "schemaVersion": 1,
  "publicBaseUrl": "https://assets.example/ascencio-assets/v1/",
  "bucket": "ascencio-assets",
  "keyPrefix": "ascencio-assets/v1/"
}
```

- C1. HTTPS custom domain; exact `/ascencio-assets/v1/` deployment prefix, trailing slash; no userinfo, query, fragment, encoded traversal or alternate port. Public URLs append relative keys to this prefix. S3 keys prepend `keyPrefix`.
- C2. Publisher-only environment: `ASSET_R2_ACCOUNT_ID`, `ASSET_R2_ACCESS_KEY_ID`, `ASSET_R2_SECRET_ACCESS_KEY`. Remote checks require all three. Account ID must be lowercase 32-hex before endpoint construction. Endpoint is `https://<account>.r2.cloudflarestorage.com`, region `auto`. No ambient SDK credential-chain lookup.
- C3. Configure CORS in the R2 console for exact app origins: `AllowedMethods` GET and HEAD only; expose `Content-Length`, `ETag`, `Content-Range`, `Accept-Ranges`; allow `Range` and `If-Range` request headers for future resumable browser reads. Browser credentials are omitted. CORS is not write authorization.
- C4. `npm run assets:setup -- --check --remote --origin http://localhost:5173 --origin https://app.example` uses your actual dev/prod origins in place of these examples. At least one `--origin` is required remotely; repeat it for each exact origin (maximum 10), no duplicates/wildcards/credentials/query/path. Authenticated reads are `HeadBucketCommand` and `ListObjectsV2Command` (`Prefix:keyPrefix`, `MaxKeys:1`), then anonymous HEAD/GET of `channels/index.json`, including Origin-header probes for supplied origins. No PUT/POST/DELETE, CORS mutation, bucket creation, domain registration or initial index write. Public redirects fail closed. Requests are bounded to 15 seconds and 32 MiB per metadata body. SDK retry count is one. Remote success checks the supplied list, not whether the owner omitted an intended origin. Bucket CORS configuration is not fetched: Cloudflare reserves configuration inspection for Admin permissions; bucket-scoped Object Read credentials suffice for setup. This explicit argv extension keeps the frozen JSON config and three publisher env names unchanged.
- C5. Missing bucket/index is failure, never inferred empty state. Local syntax/presence checks leave account activation, actual Standard storage, budget, domain ownership and native-device attestations pending. Remote requests can incur provider read charges; run them deliberately after reviewing pricing.

### Explicit initial empty PublicationInventory — owner-run only

This is a real outward-facing write. Do not run it unless you own the bucket, have approved the public scope and budget, and have confirmed that this publication namespace has never been initialized. Never overwrite an existing index or reset publication history to recover from an error.

- B1. In the R2 console, inspect the exact bucket and `ascencio-assets/v1/` prefix. If `channels/index.json`, release pointers or existing publication history are present, stop bootstrap and inspect the existing state instead. A failed read or arbitrary 404 does not prove an empty bucket.
- B2. Save these exact UTF-8 bytes with one trailing LF to a local `publication-inventory.json`. This is canonical empty state, not an eligibility record:

```json
{"nightly":null,"releases":[],"retiredNightlies":[],"schemaVersion":1}
```

- B3. From the project directory, run this reviewed Node command yourself. It uses only the installed SDK, your local environment and the validated config. `IfNoneMatch: "*"` prevents overwriting any existing index. Do not replace a rejected create-only write with an unconditional PUT.

```bash
node --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseAssetDeliveryConfig } from "./scripts/lib/asset-delivery/config.ts";
import { parsePublicationInventory } from "./scripts/lib/asset-delivery/publication-inventory.ts";
import { canonicalBytes, parseJsonBytes } from "./scripts/lib/asset-delivery/canonical-json.ts";
const config = parseAssetDeliveryConfig(parseJsonBytes(await readFile("asset-delivery.config.json")));
const inventory = parsePublicationInventory(parseJsonBytes(await readFile("publication-inventory.json")));
if (inventory.nightly !== null || inventory.releases.length || inventory.retiredNightlies.length) throw new Error("Bootstrap requires empty state");
const account = process.env.ASSET_R2_ACCOUNT_ID;
const accessKeyId = process.env.ASSET_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.ASSET_R2_SECRET_ACCESS_KEY;
if (!/^[a-f0-9]{32}$/.test(account ?? "") || !accessKeyId || !secretAccessKey) throw new Error("Publisher environment missing or invalid");
const client = new S3Client({ endpoint: `https://${account}.r2.cloudflarestorage.com`, region: "auto", credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
try {
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: `${config.keyPrefix}channels/index.json`, Body: canonicalBytes(inventory), ContentType: "application/json", CacheControl: "no-store", IfNoneMatch: "*" }));
  console.log("Empty publication inventory created");
} catch {
  console.error("Bootstrap failed; inspect bucket state and credentials locally. Existing index must not be overwritten.");
  process.exitCode = 2;
} finally { client.destroy(); }
JS
```

- B4. Windows: save the JavaScript body as a local `.mjs` file at the project root and run `node <file>.mjs` instead of the shell heredoc. Keep credentials in the process environment, not the file. Preserve the exact create-only request.
- B5. Run `npm run assets:setup -- --check --remote --origin <actual-dev-origin> --origin <actual-prod-origin>`. Confirm anonymous GET returns the explicit empty schema; record completion without credentials. This initial write does not grant eligibility for later asset uploads.

## Rights-only approval — separate from gameplay

- R1. `content/asset-publication-approval.json` parses `PublicationApproval`: exact keys `schemaVersion:1`, `status:"approved"`, nonempty unique `targets:["dev","prod"]` or an explicit subset, and `rules`. No approval file is supplied by T1; absence remains pending.
- R2. Exact-file rule: `{root,kind:"file",path,sha256,evidence:{path,bytes,sha256}}`. `path` is relative to its named root, SHA pins exact source bytes. Vendor root uses paths such as `ocgcore-wasm/0.1.2/...`; only exact-file SHA/evidence is allowed.
- R3. Tree rule: `{root,kind:"tree",path,includesFutureFiles:true,evidence:{path,bytes,sha256}}`. This explicitly approves every future regular file beneath that prefix. Empty `path` means the whole named managed root. No vendor tree approval. Similar prefix names do not match without a directory boundary.
- R4. Evidence refs are repository-relative SHA/byte records; existing distribution-evidence documents may be cited. Automation validates the attestation and scope, not legal truth. Public originals and unreleased bytes require explicit scope; do not infer this from public-source accessibility or card-source approval.
- R5. T1 helper `checkPublicationScope(approval, target, sources): AssetResult` checks source coverage only; `sources` has `root: AssetRoot | "vendor"`, root-relative `path`, `sha256`. It never reads aggregate `publishReady` or reruns gameplay checks. A valid scope can pass while `content:setup:verify` fails for unrelated gameplay prerequisites.
- R6. T4 must hash each evidence file against its declared bytes/SHA, validate approval target(s), verify every uploaded new/retained target inventory and frozen vendor independently, then integrate the unchanged `verifyPublicationApproval(approval,snapshot,inventories): AssetResult` contract before first upload. T1 scope success is not proof of evidence bytes or permission to publish. Publication reports later pin approval digest + snapshot SHA outside canonical bundle identity.

## Contracts / operational boundaries

- S1. Parsers live only in `scripts/lib/asset-delivery/`; Node dependencies never exported to app domains. Unknown keys, wrong versions, unsafe integers/hashes, duplicate file paths and cross-platform aliases fail. `canonicalBytes` recursively sorts object keys by Unicode code-point order, emits compact UTF-8 + LF, preserves array order. Its cumulative byte budget includes escaping, delimiters and LF before large string joins or output allocation. Parsers reject unsorted protocol-defined sets: prepared card codes (numeric) and chapter set/opponent IDs (code-point), snapshot object keys, source-rule root/path/kind/logicalPath tuples, retained SHA/packId refs, migration from/to/bytes/SHA tuples and prune paths. Arbitrary arrays and journal progress are not reordered. Profile identical rules collapse before ordering checks; profile graph/scanning and full object-closure verification remain consumer work.
- S2. File paths reject absolute/traversal/backslash/colon/NUL/percent/query/fragment names, Windows devices and trailing dot/space, Unicode/case aliases, secret/private-key containers and nested Git/node_modules inputs. Managed writes stay inside `assets/{battle,deck-editor,story,shared}`. Immediate `lstat`/`realpath` parent checks reject links/reparse aliases. These pathname checks are not an OS sandbox against a hostile process swapping parents between check and I/O; future writers must revalidate immediately at mutation time and perform the ticket's identity/hash checks.
- S3. Common local lock: `generated/.locks/asset-delivery`; acquire local before remote, once per exported writer. No automatic stale takeover. An interrupted local writer leaves a busy lock; owner must confirm no active process, inspect pending install/prune journals, recover them under the appropriate later command before clearing any exact stale lock. T1 setup is read-only and never acquires/writes this lock.
- S4. Future remote writers use `_control/write-lock.json`, no lease expiry or automatic takeover. Owner recovery: confirm no process active, inspect exact lock owner, remove only that lock in R2 console. Pending `_control/prune-journal.json` still requires later `assets:prune --resume --remote`; never delete the journal to bypass recovery. No `sync --delete`.
- S5. SDKs are devDependencies pinned exactly `@aws-sdk/client-s3@3.1128.0`, `@aws-sdk/lib-storage@3.1128.0`; zip.js remains `2.13.1`. No substitutions. ZIP options fixture: `tests/fixtures/asset-delivery-zip.ts`, using installed `ZipWriterConstructorOptions`, `ZipWriter(WritableStream)`, `add(ReadableStream)`, awaited sequential entry/close.
- S6. ZIP fixture pins STORE0, raw DOS `0x00210000` (1980-01-01 00:00:00; no timezone conversion), UTF-8, zero comments/attributes, no timestamps/optional extras, unbuffered writes, no workers/native compression. `zip64` omitted: library auto-enables required ZIP64 for large/unknown-size streams. Small unknown-size fixture has required local ZIP64 extra only. UTC/Honolulu fixture match is not Windows/macOS or >4GiB/10GB proof; those remain later gates.
- S7. [Asset-root inventory](asset-root-inventory.md) records old literals and classifications before any move. Frozen vendor, feedback and user assets stay untouched. Native PWA installer/build activation remains separate work, never claimed from these fixtures.

## Primary references

- P1. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) — review current storage/request pricing; no guaranteed free-tier budget.
- P2. [Public buckets/custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/) — configure domain deliberately.
- P3. [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) — exact browser origins and read methods.
- P4. [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) — inspect supported operations; setup uses read-only bucket commands.
- P5. [R2 API token permissions](https://developers.cloudflare.com/r2/api/tokens/) — Object Read/Write tokens can be bucket-scoped; Admin permissions cover bucket configuration. Setup must not require broader Admin access.
