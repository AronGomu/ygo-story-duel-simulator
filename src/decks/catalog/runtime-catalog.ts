import type {
  AssetDeckCardRecord,
  DeckBuilderCardView,
} from "./ocg-card-mapper.ts";
import { sortDeckCatalogCards } from "./deck-catalog-order.ts";
import { packagedCatalog, type PackagedCardText } from "./packaged-catalog.ts";
import { verifyDigest } from "./snapshot-digest.ts";

/** How a host reads one shard of the packaged catalog. */
export interface CatalogShardReader {
  readJson<T>(relativePath: string): Promise<T>;
}

/** The snapshot buckets every card by `code % 64`, one file per bucket. */
export const CATALOG_SHARD_COUNT = 64;

/* A connection a server accepts and never answers has no default deadline, and
   `runtimeCatalog()` is awaited before either surface can show anything: the
   editor would sit on its loading skeleton and the duel would list no local
   deck, neither of them ever reaching the error branch that offers a retry. */
const SHARD_FETCH_TIMEOUT_MS = 30_000;

/* The manifest and the shards it declares are of one snapshot, so the reader
   holds the manifest for the life of the catalog read rather than per shard. */
const RUNTIME_MANIFEST_PATH = "current/manifest.json";

/* Shard paths are snapshot-relative in the manifest and asset-root-relative in
   the reader, which is the one prefix between them. */
const SNAPSHOT_PATH_PREFIX = "assets/current/";

const CARD_SHARD_PATTERN = /^catalog\/cards\/[0-9a-f]{2}\.json$/;

/** `0` → `"00"`, `63` → `"3f"` — the snapshot's own file naming. */
export function catalogShardName(shard: number): string {
  return shard.toString(16).padStart(2, "0");
}

function cardShardPath(shard: number): string {
  return `assets/current/catalog/cards/${catalogShardName(shard)}.json`;
}

function textShardPath(shard: number): string {
  return `assets/current/catalog/texts/en/${catalogShardName(shard)}.json`;
}

/* A 404, an offline network and a truncated body are one failure to a player —
   the catalog is incomplete — so all three surface as the shard's own name
   rather than as a parse error from somewhere inside a 200 kB response. The
   original stays as `cause`, because which of the three it was is exactly what
   the next person debugging this needs. */
function shardFailure(relativePath: string, cause: unknown): Error {
  return new Error(`Runtime catalog shard failed: ${relativePath}`, { cause });
}

/** What pins a shard body to the snapshot this build was made from. */
export interface RuntimeSnapshotPin {
  /** `__RUNTIME_MANIFEST_SHA256__`: the digest the manifest itself must have. */
  readonly expectedManifestSha256: string;
  /** `__RUNTIME_SNAPSHOT_ID__`: the snapshot that manifest must describe. */
  readonly expectedSnapshotId: string;
}

/**
 * Reads shards over HTTP from the runtime asset root the Worker already reads,
 * verified against the same pinned manifest the Worker verifies them against.
 *
 * These URLs carry no content hash, so a stale Cache Storage entry or a deploy
 * caught half-rolled answers them with a different snapshot's cards. The editor
 * would offer those codes, the duel picker would list a deck built from them,
 * and the Worker — checking the current manifest — would refuse the deck at
 * duel start. Digesting each body here means the editor and the duel disagree
 * about nothing: they read one snapshot or neither does.
 *
 * `timeoutMs` is a parameter only so a test can watch a real abort land as the
 * named-shard failure both surfaces already render; production takes the
 * default.
 */
export function createFetchShardReader(
  baseUrl: string,
  pin: RuntimeSnapshotPin,
  timeoutMs: number = SHARD_FETCH_TIMEOUT_MS,
): CatalogShardReader {
  let manifestFiles: Promise<ReadonlyMap<string, string>> | null = null;
  return {
    async readJson<T>(relativePath: string): Promise<T> {
      if (!relativePath.startsWith(SNAPSHOT_PATH_PREFIX))
        throw shardFailure(relativePath, new Error("not a snapshot path"));
      const snapshotPath = relativePath.slice(SNAPSHOT_PATH_PREFIX.length);
      manifestFiles ??= loadPinnedManifestFiles(baseUrl, pin, timeoutMs);
      let files: ReadonlyMap<string, string>;
      try {
        files = await manifestFiles;
      } catch (error) {
        throw shardFailure(relativePath, error);
      }
      const expected = files.get(snapshotPath);
      if (expected === undefined)
        throw shardFailure(
          relativePath,
          new Error("the runtime manifest does not declare this shard"),
        );
      let bytes: Uint8Array;
      try {
        bytes = await fetchRuntimeBytes(
          `${baseUrl}runtime/${relativePath}`,
          timeoutMs,
        );
        await verifyDigest(snapshotPath, bytes, expected);
      } catch (error) {
        throw shardFailure(relativePath, error);
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch (error) {
        throw shardFailure(relativePath, error);
      }
    },
  };
}

/**
 * The snapshot manifest, pinned two ways, reduced to shard path → digest.
 *
 * The digest comes from a build constant rather than from the network, so a
 * manifest served from anywhere but this build's snapshot fails before a single
 * shard is read. The Worker pins the same file the same way in
 * `loadBrowserRuntimeAssets`; the parse below reads only the two fields a
 * catalog needs from bytes those checks have already fixed.
 */
async function loadPinnedManifestFiles(
  baseUrl: string,
  pin: RuntimeSnapshotPin,
  timeoutMs: number,
): Promise<ReadonlyMap<string, string>> {
  const bytes = await fetchRuntimeBytes(
    `${baseUrl}runtime/${RUNTIME_MANIFEST_PATH}`,
    timeoutMs,
  );
  await verifyDigest(RUNTIME_MANIFEST_PATH, bytes, pin.expectedManifestSha256);
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
    snapshotId?: unknown;
    assets?: { files?: unknown };
  };
  if (manifest.snapshotId !== pin.expectedSnapshotId)
    throw new Error("Runtime manifest describes another snapshot");
  const declared = manifest.assets?.files;
  if (!Array.isArray(declared))
    throw new Error("Runtime manifest declares no files");
  const files = new Map<string, string>();
  for (const file of declared as readonly {
    path?: unknown;
    sha256?: unknown;
  }[]) {
    if (typeof file?.path !== "string" || typeof file.sha256 !== "string")
      throw new Error("Runtime manifest contains an invalid file record");
    files.set(file.path, file.sha256);
  }
  /* The Worker refuses a script index bucketed any other way
     (`active-duel-dependencies.ts`), and the catalog has the same exposure with
     none of the noise: reading 64 of, say, 128 buckets is half a database that
     looks whole, and the duel picker validates against this same read, so the
     duel would agree with the editor about the missing half. */
  const declaredShards = [...files.keys()].filter((path) =>
    CARD_SHARD_PATTERN.test(path),
  ).length;
  if (declaredShards !== CATALOG_SHARD_COUNT)
    throw new Error(`Unsupported catalog shard count: ${declaredShards}`);
  return files;
}

async function fetchRuntimeBytes(
  url: string,
  timeoutMs: number,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Every card the packaged database holds, joined to its text and its art.
 *
 * Art is a URL by convention for every code rather than a manifest lookup: the
 * database is ~14.8k cards and the build packages only the images it verified,
 * so absence is the normal case and a tile that 404s falls back to the
 * placeholder glyph. Deriving the URL keeps a card playable in a deck whose art
 * this build happens not to carry.
 */
export async function loadRuntimeCatalog(
  reader: CatalogShardReader,
  imageBaseUrl: string,
): Promise<readonly DeckBuilderCardView[]> {
  const shards = Array.from({ length: CATALOG_SHARD_COUNT }, (_, i) => i);
  const [cardShards, textShards] = await Promise.all([
    Promise.all(
      shards.map((shard) =>
        reader.readJson<readonly AssetDeckCardRecord[]>(cardShardPath(shard)),
      ),
    ),
    Promise.all(
      shards.map((shard) =>
        reader.readJson<readonly PackagedCardText[]>(textShardPath(shard)),
      ),
    ),
  ]);
  const cards = cardShards.flat();
  return sortDeckCatalogCards(
    packagedCatalog(
      cards,
      textShards.flat(),
      new Map(
        cards.map(({ code }) => [
          code,
          `${imageBaseUrl}runtime/images/${code}.jpg`,
        ]),
      ),
    ),
  );
}

let pending: Promise<readonly DeckBuilderCardView[]> | null = null;

/**
 * The catalog for this page, read at most once.
 *
 * The editor and the duel share the memo on purpose: a build that offered a
 * card in one and withheld it in the other would let a player spend an evening
 * on a deck `#/duel` then refuses. One read means one answer.
 */
export function runtimeCatalog(): Promise<readonly DeckBuilderCardView[]> {
  if (pending !== null) return pending;
  const base = import.meta.env.BASE_URL;
  const attempt = loadRuntimeCatalog(
    createFetchShardReader(base, {
      expectedManifestSha256: __RUNTIME_MANIFEST_SHA256__,
      expectedSnapshotId: __RUNTIME_SNAPSHOT_ID__,
    }),
    base,
  );
  /* A rejection is not an answer, so it is not kept. Memoizing one would let a
     single 404 in the duel leave `#/decks` dead for the rest of the page load,
     never even attempting a fetch of its own — and both surfaces offer a retry
     that could only ever be handed the same failure back. */
  attempt.catch(() => {
    if (pending === attempt) pending = null;
  });
  pending = attempt;
  return attempt;
}

/**
 * Points `runtimeCatalog()` at a fixture, or clears it with `null`.
 *
 * jsdom has no runtime assets to serve, so a component test that mounted the
 * editor without this would hang on the loading skeleton until its timeout.
 */
export function setRuntimeCatalogForTests(
  cards: readonly DeckBuilderCardView[] | null,
): void {
  pending = cards === null ? null : Promise.resolve(cards);
}
