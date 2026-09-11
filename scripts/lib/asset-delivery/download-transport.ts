import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ObjectRef } from "./object-ref.ts";
import { MAX_METADATA_BYTES } from "./canonical-json.ts";
import { assertSafeParents } from "./path-guards.ts";
import { digestSource, sameDigest, sourceStat } from "./source-files.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { AssetDeliveryError, fail } from "./failure.ts";

export interface DownloadDependencies {
  readonly fetcher: typeof fetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export const defaultDownloadDependencies: DownloadDependencies = {
  fetcher: fetch,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const request = async (
  url: string,
  init: RequestInit,
  dependencies: DownloadDependencies,
): Promise<Response> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await dependencies.fetcher(url, {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status !== 429 && response.status < 500) return response;
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof AssetDeliveryError) throw error;
    }
    if (attempt < 2) await dependencies.sleep(1000 * 2 ** attempt);
  }
  fail("ASSET_NETWORK_FAILED");
};

async function consumeBounded(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  ) {
    await response.body?.cancel();
    fail("ASSET_LIMIT_EXCEEDED");
  }
  if (!response.body) fail("ASSET_NETWORK_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        fail("ASSET_LIMIT_EXCEEDED");
      }
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof AssetDeliveryError) throw error;
    fail("ASSET_NETWORK_FAILED");
  } finally {
    reader.releaseLock();
  }
  if (declared !== null && bytes !== Number(declared))
    fail("ASSET_NETWORK_FAILED");
  return Buffer.concat(chunks, bytes);
}

export async function fetchMutableBytes(
  url: string,
  dependencies: DownloadDependencies,
): Promise<Uint8Array> {
  const response = await request(
    url,
    {
      cache: "no-store",
      headers: { "cache-control": "no-store" },
    },
    dependencies,
  );
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) fail("ASSET_REVISION_UNAVAILABLE");
    fail("ASSET_NETWORK_FAILED");
  }
  return consumeBounded(response, MAX_METADATA_BYTES);
}

export async function fetchObjectBytes(
  baseUrl: string,
  ref: ObjectRef,
  dependencies: DownloadDependencies,
): Promise<Uint8Array> {
  if (ref.bytes > MAX_METADATA_BYTES) fail("ASSET_LIMIT_EXCEEDED", ref.key);
  const response = await request(
    new URL(ref.key, baseUrl).href,
    { cache: "force-cache" },
    dependencies,
  );
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) fail("ASSET_REVISION_UNAVAILABLE", ref.key);
    fail("ASSET_NETWORK_FAILED", ref.key);
  }
  const bytes = await consumeBounded(response, ref.bytes);
  if (
    bytes.byteLength !== ref.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== ref.sha256
  )
    fail("ASSET_INTEGRITY_FAILED", ref.key);
  return bytes;
}

interface DownloadState {
  readonly schemaVersion: 1;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly etag: string;
}

function parseDownloadState(value: unknown): DownloadState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).sort().join(",") !==
      "bytes,etag,schemaVersion,sha256,url" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("url" in value) ||
    typeof value.url !== "string" ||
    !("bytes" in value) ||
    !Number.isSafeInteger(value.bytes) ||
    !("sha256" in value) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !("etag" in value) ||
    typeof value.etag !== "string" ||
    !strongEtag(value.etag)
  )
    fail("ASSET_INTEGRITY_FAILED");
  return value as DownloadState;
}

function strongEtag(value: string | null): value is string {
  return value !== null && /^"[^"\r\n]+"$/.test(value);
}

async function removeIfPresent(root: string, relative: string): Promise<void> {
  if (!(await sourceStat(root, relative))) return;
  await unlink(await assertSafeParents(root, relative));
}

async function validComplete(
  root: string,
  relative: string,
  ref: ObjectRef,
): Promise<boolean> {
  const info = await sourceStat(root, relative);
  if (!info) return false;
  if (!info.isFile()) fail("ASSET_RECOVERY_REQUIRED", relative);
  if (info.size !== BigInt(ref.bytes)) {
    await removeIfPresent(root, relative);
    return false;
  }
  if (!sameDigest(await digestSource(root, relative), ref)) {
    await removeIfPresent(root, relative);
    return false;
  }
  return true;
}

/** Persistent hash-addressed archive cache with strong-ETag-only resume. */
export async function downloadArchive(
  root: string,
  baseUrl: string,
  ref: ObjectRef,
  dependencies: DownloadDependencies,
): Promise<string> {
  const directory = `generated/asset-delivery/downloads/${ref.sha256}`;
  const complete = `${directory}/archive.zip`;
  const partial = `${directory}/archive.part`;
  const statePath = `${directory}/download.json`;
  const url = new URL(ref.key, baseUrl).href;
  if (await validComplete(root, complete, ref)) return complete;
  await mkdir(path.dirname(await assertSafeParents(root, partial)), {
    recursive: true,
  });

  let cleanRestartUsed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let offset = 0;
    let state: DownloadState | null = null;
    const partInfo = await sourceStat(root, partial);
    const stateInfo = await sourceStat(root, statePath);
    if (partInfo && stateInfo) {
      try {
        state = parseDownloadState(
          JSON.parse(
            await readFile(await assertSafeParents(root, statePath), "utf8"),
          ),
        );
      } catch (error) {
        if (!(error instanceof AssetDeliveryError)) throw error;
      }
      if (
        state?.url === url &&
        state.bytes === ref.bytes &&
        state.sha256 === ref.sha256 &&
        partInfo.isFile() &&
        partInfo.size > 0n &&
        partInfo.size < BigInt(ref.bytes)
      )
        offset = Number(partInfo.size);
      else state = null;
    }
    if (!state || offset === 0) {
      await removeIfPresent(root, partial);
      await removeIfPresent(root, statePath);
      state = null;
      offset = 0;
    }

    let response: Response;
    try {
      response = await dependencies.fetcher(url, {
        cache: "force-cache",
        redirect: "error",
        credentials: "omit",
        headers:
          offset > 0
            ? { Range: `bytes=${offset}-`, "If-Range": state!.etag }
            : {},
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      if (attempt < 2) {
        await dependencies.sleep(1000 * 2 ** attempt);
        continue;
      }
      fail("ASSET_NETWORK_FAILED", ref.key);
    }
    if (response.status === 404) {
      await response.body?.cancel();
      fail("ASSET_REVISION_UNAVAILABLE", ref.key);
    }
    if (response.status === 416 && offset > 0 && !cleanRestartUsed) {
      cleanRestartUsed = true;
      await response.body?.cancel();
      await removeIfPresent(root, partial);
      await removeIfPresent(root, statePath);
      attempt--;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      if (attempt < 2) {
        await dependencies.sleep(1000 * 2 ** attempt);
        continue;
      }
      fail("ASSET_NETWORK_FAILED", ref.key);
    }
    const resumed = response.status === 206;
    if (!(response.status === 200 || (offset > 0 && resumed))) {
      await response.body?.cancel();
      fail("ASSET_NETWORK_FAILED", ref.key);
    }
    const etag = response.headers.get("etag");
    if (resumed) {
      const range = response.headers.get("content-range");
      const match = /^(?:bytes) (\d+)-(\d+)\/(\d+)$/.exec(range ?? "");
      if (
        !match ||
        Number(match[1]) !== offset ||
        Number(match[2]) !== ref.bytes - 1 ||
        Number(match[3]) !== ref.bytes ||
        etag !== state!.etag
      ) {
        await response.body?.cancel();
        fail("ASSET_INTEGRITY_FAILED", ref.key);
      }
    } else if (offset > 0) {
      offset = 0;
      await removeIfPresent(root, partial);
      await removeIfPresent(root, statePath);
    }
    const responseLength = response.headers.get("content-length");
    const expectedLength = ref.bytes - offset;
    if (
      responseLength !== null &&
      (!/^\d+$/.test(responseLength) ||
        Number(responseLength) !== expectedLength)
    ) {
      await response.body?.cancel();
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    }
    if (strongEtag(etag)) {
      const nextState: DownloadState = {
        schemaVersion: 1,
        url,
        bytes: ref.bytes,
        sha256: ref.sha256,
        etag,
      };
      await replaceMetadata(root, statePath, nextState);
      state = nextState;
    } else {
      state = null;
      await removeIfPresent(root, statePath);
    }
    if (!response.body) fail("ASSET_NETWORK_FAILED", ref.key);
    const handle = await open(
      await assertSafeParents(root, partial),
      offset > 0 ? "a" : "w",
      0o600,
    );
    let received = 0;
    try {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          received += item.value.byteLength;
          if (received > expectedLength) {
            await reader.cancel();
            fail("ASSET_LIMIT_EXCEEDED", ref.key);
          }
          await handle.writeFile(item.value);
        }
      } finally {
        reader.releaseLock();
      }
      await handle.sync();
    } catch (error) {
      if (error instanceof AssetDeliveryError) throw error;
      if (!state) await removeIfPresent(root, partial);
      if (attempt < 2) {
        await dependencies.sleep(1000 * 2 ** attempt);
        continue;
      }
      fail("ASSET_NETWORK_FAILED", ref.key);
    } finally {
      await handle.close();
    }
    if (received !== expectedLength) {
      if (!state) await removeIfPresent(root, partial);
      if (attempt < 2) continue;
      fail("ASSET_NETWORK_FAILED", ref.key);
    }
    if (!(await validComplete(root, partial, ref))) {
      await removeIfPresent(root, statePath);
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    }
    await rename(
      await assertSafeParents(root, partial),
      await assertSafeParents(root, complete),
    );
    await removeIfPresent(root, statePath);
    return complete;
  }
  fail("ASSET_NETWORK_FAILED", ref.key);
}
