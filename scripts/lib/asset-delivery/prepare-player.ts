import { ASSET_SOURCES } from "../asset-roots.ts";
import { parseCardSetSource } from "../content-setup.ts";
import { parseChapterSelections } from "../../../src/content/index.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { readSource, digestSource, sameDigest } from "./source-files.ts";
import { parseJsonBytes, compareCodePoints } from "./canonical-json.ts";
import {
  parsePreparedPlayerMetadata,
  type PreparedPlayerMetadata,
} from "./prepared-player-metadata.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { array, hash, integer, text } from "./schema.ts";
import type { FileDigest } from "./file-digest.ts";
import type { Progress } from "./cli.ts";
import { fail } from "./failure.ts";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ASSET_CONFIG_INVALID");
  return value as Record<string, unknown>;
};
/** Explicit authoring preparation; never imported or invoked by the producer. */
export async function preparePlayerMetadata(
  root: string,
  progress: Progress = () => {},
): Promise<PreparedPlayerMetadata> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    const inputs: FileDigest[] = [];
    const read = async (
      relative: string,
    ): Promise<{ bytes: Uint8Array; value: unknown; digest: FileDigest }> => {
      const result = await readSource(root, relative, true);
      inputs.push(result.digest);
      return {
        bytes: result.bytes!,
        value: parseJsonBytes(result.bytes!),
        digest: result.digest,
      };
    };
    const selectionInput = await read("content/chapter-selections.json");
    const parsed = parseChapterSelections(selectionInput.value);
    if (parsed.kind !== "ok")
      fail("ASSET_CONFIG_INVALID", "content/chapter-selections.json");
    const sourceInput = await read("content/authoring/card-set-source.json");
    const source = parseCardSetSource(sourceInput.bytes);
    if (!source || sourceInput.digest.sha256 !== parsed.value.sourceSha256)
      fail("ASSET_INTEGRITY_FAILED", sourceInput.digest.path);
    const policyInput = await read("content/authoring/chapter-policy.json");
    const policy = asRecord(policyInput.value);
    const intervals = array(asRecord, undefined, 1)(policy.chapters);
    if (
      policy.schemaVersion !== 1 ||
      policy.status !== "approved-chapter-one-scope" ||
      policy.sourceSha256 !== sourceInput.digest.sha256 ||
      intervals.length !== 1 ||
      intervals[0]!.id !== "chapter-01"
    )
      fail("ASSET_CONFIG_INVALID", policyInput.digest.path);
    const shopInput = await read("public/story/shop-sets.v1.json");
    const shop = asRecord(shopInput.value);
    if (shop.version !== 1) fail("ASSET_CONFIG_INVALID", shopInput.digest.path);
    const sets = array(
      (value) => {
        const set = asRecord(value);
        return { id: text(set.id), name: text(set.name) };
      },
      undefined,
      2048,
    )(shop.sets);
    const byName = new Map<string, string>();
    const ids = new Set<string>();
    for (const set of sets) {
      if (byName.has(set.name) || ids.has(set.id))
        fail("ASSET_PROFILE_CONFLICT", shopInput.digest.path);
      byName.set(set.name, set.id);
      ids.add(set.id);
    }
    const runtimeInput = await read(
      `${ASSET_SOURCES.runtime.source}/manifest.json`,
    );
    const runtime = asRecord(runtimeInput.value);
    if (runtime.schemaVersion !== 1)
      fail("ASSET_TARGET_UNAVAILABLE", runtimeInput.digest.path);
    const runtimeSnapshotId = hash(runtime.snapshotId);
    await read(`${ASSET_SOURCES.data.source}/manifest.json`);
    const runtimeFiles = array((value) => {
      const file = asRecord(value);
      return {
        path: text(file.path),
        bytes: integer(file.bytes),
        sha256: hash(file.sha256),
      };
    })(asRecord(runtime.assets).files);
    const runtimeCodes = new Set<number>();
    const catalog = runtimeFiles
      .filter((f) => /^catalog\/cards\/[a-f0-9]+\.json$/.test(f.path))
      .sort((a, b) => compareCodePoints(a.path, b.path));
    if (!catalog.length)
      fail("ASSET_TARGET_UNAVAILABLE", runtimeInput.digest.path);
    for (const file of catalog) {
      const shard = await read(`${ASSET_SOURCES.data.source}/${file.path}`);
      if (!sameDigest(file, shard.digest))
        fail("ASSET_INTEGRITY_FAILED", shard.digest.path);
      for (const value of array(asRecord)(shard.value)) {
        const code = integer(value.code);
        if (!code || code > 0xffffffff || runtimeCodes.has(code))
          fail("ASSET_CONFIG_INVALID", shard.digest.path);
        runtimeCodes.add(code);
      }
    }
    const chapters = parsed.value.chapters
      .filter((c) => c.published)
      .map((chapter) => {
        const codes = new Set(chapter.additionalCardCodes);
        const setIds: string[] = [];
        for (const name of chapter.setNames) {
          const set = source.sets.find((s) => s.name === name);
          const id = byName.get(name);
          if (!set || !id) {
            progress("CONTENT_SOURCE_GAP", shopInput.digest.path);
            fail("ASSET_REFERENCE_MISSING", shopInput.digest.path);
          }
          setIds.push(id);
          if (!set.cards.length)
            progress("source-set-empty", sourceInput.digest.path);
          for (const card of set.cards) codes.add(card.id);
        }
        const cardCodes = [...codes].sort((a, b) => a - b);
        const unsupported = cardCodes.filter((code) => !runtimeCodes.has(code));
        if (unsupported.length)
          progress(
            "unsupported-runtime-card-count",
            runtimeInput.digest.path,
            unsupported.length,
          );
        return {
          id: chapter.id,
          title: chapter.title,
          storyContentId: chapter.storyContentId,
          setIds: setIds.sort(compareCodePoints),
          cardCodes,
          opponentIds: [...chapter.opponentIds].sort(compareCodePoints),
        };
      });
    const prepared = parsePreparedPlayerMetadata({
      schemaVersion: 1,
      sourceInputs: inputs.sort((a, b) => compareCodePoints(a.path, b.path)),
      runtimeSnapshotId,
      runtimeCardCodes: [...runtimeCodes].sort((a, b) => a - b),
      chapters,
    });
    for (const input of inputs)
      if (!sameDigest(input, await digestSource(root, input.path, true)))
        fail("ASSET_SOURCE_CHANGED", input.path);
    await replaceMetadata(
      root,
      "generated/asset-delivery/prepared-player.json",
      prepared,
    );
    progress("prepared", "generated/asset-delivery/prepared-player.json");
    return prepared;
  } finally {
    await release();
  }
}
