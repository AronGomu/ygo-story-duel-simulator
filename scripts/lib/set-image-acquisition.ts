import { readCappedResponseBody } from "./capped-response-body.ts";
import { isJpeg } from "./images.ts";
import { CHAPTER_SET_INDEX_MAX_BYTES } from "./chapter-set-media.ts";

export const SET_INDEX_URL = "https://db.ygoprodeck.com/api/v7/cardsets.php";

export interface UpstreamSetRecord {
  readonly set_name: string;
  readonly set_image?: string | null;
}
const SET_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SET_IMAGE_ORIGIN = "https://images.ygoprodeck.com/";
type SetIndexFetch = (input: string, init?: RequestInit) => Promise<Response>;
type Wait = (milliseconds: number) => Promise<void>;

function parseSetIndex(bytes: Uint8Array): readonly UpstreamSetRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Set index response is not valid JSON");
  }
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error("Set index response is not a bounded array");
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).set_name !== "string" ||
      ((entry as Record<string, unknown>).set_image !== undefined &&
        (entry as Record<string, unknown>).set_image !== null &&
        typeof (entry as Record<string, unknown>).set_image !== "string")
    )
      throw new Error("Set index response contains an invalid record");
  }
  return value as readonly UpstreamSetRecord[];
}

export async function fetchBoundedSetIndex(
  fetcher: SetIndexFetch = fetch,
  wait: Wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<readonly UpstreamSetRecord[]> {
  let finalError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(SET_INDEX_URL, {
        headers: {
          Accept: "application/json",
          "user-agent": "YGO-Story-Duel-Simulator/0.1 asset importer",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`Set index request failed: HTTP ${response.status}`);
      const body = await readCappedResponseBody(
        response,
        CHAPTER_SET_INDEX_MAX_BYTES,
        "Set index",
      );
      if (body.status === "too-large")
        throw new Error(
          `Set index exceeds ${CHAPTER_SET_INDEX_MAX_BYTES} bytes`,
        );
      return parseSetIndex(body.bytes);
    } catch (error) {
      finalError =
        error instanceof Error ? error : new Error("Set index request failed");
      if (attempt === 0) await wait(500);
    }
  }
  throw finalError!;
}

export function assertSelectedNullImageIds(
  sources: readonly {
    readonly setId: string;
    readonly sourceUrl: string | null;
  }[],
  selectedIds: ReadonlySet<string>,
  expectedNullIds: ReadonlySet<string>,
): void {
  const liveNullIds = sources
    .filter(
      ({ setId, sourceUrl }) => selectedIds.has(setId) && sourceUrl === null,
    )
    .map(({ setId }) => setId)
    .sort();
  const expected = [...expectedNullIds].sort();
  if (
    liveNullIds.length !== expected.length ||
    liveNullIds.some((setId, index) => setId !== expected[index])
  )
    throw new Error("Selected null-image sets differ from pinned evidence");
}

export async function fetchSetImageBytes(
  url: string,
  fetcher: SetIndexFetch = fetch,
  wait: Wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Uint8Array> {
  if (!url.startsWith(SET_IMAGE_ORIGIN))
    throw new Error("Set image URL has an invalid origin");
  let finalError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: {
          Accept: "image/jpeg",
          "user-agent": "YGO-Story-Duel-Simulator/0.1 asset importer",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(`Set image request failed: HTTP ${response.status}`);
      const body = await readCappedResponseBody(
        response,
        SET_IMAGE_MAX_BYTES,
        "Set image",
      );
      if (body.status === "too-large") throw new Error(body.error);
      if (!isJpeg(body.bytes))
        throw new Error("Set image response is not JPEG");
      return body.bytes;
    } catch (error) {
      finalError =
        error instanceof Error ? error : new Error("Set image request failed");
      if (attempt === 0) await wait(1_000);
    }
  }
  throw finalError!;
}
