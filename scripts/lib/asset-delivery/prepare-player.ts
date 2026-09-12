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
import {
  normalizeChapterSource,
  parseChapterSourceCorrections,
  type ChapterSourceSet,
} from "../chapter-source-policy.ts";
import {
  chapterSetIdentities,
  type ExistingSetIdentity,
} from "../chapter-set-id.ts";
import {
  parseChapterSetMediaEvidence,
  verifiedUnavailableSetImageIds,
} from "../chapter-set-media.ts";
import {
  buildChapterGameplay,
  parseChapterGameplayAuthoring,
  type RuntimeCardRecord,
  type RuntimeCardText,
} from "./chapter-gameplay.ts";
import { chapterProfile } from "./chapter-profile.ts";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ASSET_CONFIG_INVALID");
  return value as Record<string, unknown>;
};

function signedInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < -0x80000000 ||
    value > 0x7fffffff
  )
    fail("ASSET_CONFIG_INVALID");
  return value;
}

function runtimeString(value: unknown, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    (!empty && value.length === 0) ||
    /[\uD800-\uDFFF]/u.test(value)
  )
    fail("ASSET_CONFIG_INVALID");
  return value;
}

function runtimeCard(value: unknown): RuntimeCardRecord {
  const card = asRecord(value);
  return {
    code: integer(card.code),
    alias: integer(card.alias),
    setcodes: array(integer)(card.setcodes),
    type: integer(card.type),
    level: integer(card.level),
    attribute: integer(card.attribute),
    race: runtimeString(card.race),
    attack: signedInteger(card.attack),
    defense: signedInteger(card.defense),
    lscale: integer(card.lscale),
    rscale: integer(card.rscale),
    linkMarker: integer(card.linkMarker),
    ot: integer(card.ot),
    category: integer(card.category),
  };
}

function runtimeText(value: unknown): RuntimeCardText {
  const card = asRecord(value);
  return {
    code: integer(card.code),
    name: runtimeString(card.name),
    description: runtimeString(card.description, true),
    strings: array(
      (entry) => runtimeString(entry, true),
      undefined,
      64,
    )(card.strings),
  };
}

/** Explicit authoring preparation; never imported or invoked by producer. */
export async function preparePlayerMetadata(
  root: string,
  progress: Progress = () => {},
): Promise<PreparedPlayerMetadata> {
  const release = await acquireAssetDeliveryLock(root);
  try {
    const inputs: FileDigest[] = [];
    const readBytes = async (
      relative: string,
    ): Promise<{ bytes: Uint8Array; digest: FileDigest }> => {
      const result = await readSource(root, relative, true);
      inputs.push(result.digest);
      return { bytes: result.bytes!, digest: result.digest };
    };
    const read = async (
      relative: string,
    ): Promise<{ bytes: Uint8Array; value: unknown; digest: FileDigest }> => {
      const result = await readBytes(relative);
      return { ...result, value: parseJsonBytes(result.bytes) };
    };
    const selectionInput = await read("content/chapter-selections.json");
    const parsed = parseChapterSelections(selectionInput.value);
    if (parsed.kind !== "ok")
      fail("ASSET_CONFIG_INVALID", "content/chapter-selections.json");
    const sourceInput = await read("content/authoring/card-set-source.json");
    const source = parseCardSetSource(sourceInput.bytes);
    if (!source || sourceInput.digest.sha256 !== parsed.value.sourceSha256)
      fail("ASSET_INTEGRITY_FAILED", sourceInput.digest.path);
    const correctionsInput = await read(
      "content/authoring/chapter-one-corrections.json",
    );
    let corrections;
    try {
      corrections = parseChapterSourceCorrections(correctionsInput.value);
    } catch {
      fail("ASSET_CONFIG_INVALID", correctionsInput.digest.path);
    }
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
    const existingSets: readonly ExistingSetIdentity[] = array(
      (value) => {
        const set = asRecord(value);
        return { id: text(set.id), name: text(set.name) };
      },
      undefined,
      2048,
    )(shop.sets);
    const setMediaInput = await read(
      "content/authoring/chapter-one-set-media.json",
    );
    const setMedia = parseChapterSetMediaEvidence(setMediaInput.value);
    const setMediaSourceInput = await readBytes(setMedia.source.path);
    const gameplayInput = await read(
      "content/authoring/chapter-one-gameplay.json",
    );
    const authoring = parseChapterGameplayAuthoring(gameplayInput.value);
    const storyInput = await read(authoring.story.document);
    const deckSources = new Map<string, string>();
    for (const deck of authoring.decks) {
      const input = await readBytes(deck.path);
      let sourceText: string;
      try {
        sourceText = new TextDecoder("utf-8", { fatal: true }).decode(
          input.bytes,
        );
      } catch {
        fail("ASSET_CONFIG_INVALID", deck.path);
      }
      deckSources.set(deck.path, sourceText);
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
    const records = new Map<number, RuntimeCardRecord>();
    const texts = new Map<number, RuntimeCardText>();
    const selectedShards = runtimeFiles
      .filter((file) =>
        /^catalog\/(?:cards|texts\/en)\/[a-f0-9]{2}\.json$/.test(file.path),
      )
      .sort((a, b) => compareCodePoints(a.path, b.path));
    if (
      !selectedShards.some(({ path }) => path.startsWith("catalog/cards/")) ||
      !selectedShards.some(({ path }) => path.startsWith("catalog/texts/en/"))
    )
      fail("ASSET_TARGET_UNAVAILABLE", runtimeInput.digest.path);
    for (const file of selectedShards) {
      const shard = await read(`${ASSET_SOURCES.data.source}/${file.path}`);
      if (!sameDigest(file, shard.digest))
        fail("ASSET_INTEGRITY_FAILED", shard.digest.path);
      if (file.path.startsWith("catalog/cards/")) {
        for (const value of array(runtimeCard)(shard.value)) {
          if (records.has(value.code))
            fail("ASSET_CONFIG_INVALID", shard.digest.path);
          records.set(value.code, value);
        }
      } else {
        for (const value of array(runtimeText)(shard.value)) {
          if (texts.has(value.code))
            fail("ASSET_CONFIG_INVALID", shard.digest.path);
          texts.set(value.code, value);
        }
      }
    }
    const chapters = [];
    for (const chapter of parsed.value.chapters.filter(
      (chapter) => chapter.published,
    )) {
      const selectedNames = new Set(chapter.setNames);
      const selectedSets = source.sets.filter(
        (set): set is ChapterSourceSet =>
          set.tcgReleaseDate !== null && selectedNames.has(set.name),
      );
      if (selectedSets.length !== selectedNames.size) {
        progress("CONTENT_SOURCE_GAP", sourceInput.digest.path);
        fail("ASSET_REFERENCE_MISSING", sourceInput.digest.path);
      }
      let normalized;
      try {
        normalized = normalizeChapterSource(selectedSets, corrections);
      } catch {
        fail("ASSET_CONFIG_INVALID", sourceInput.digest.path);
      }
      const codes = [
        ...new Set([...chapter.additionalCardCodes, ...normalized.cardCodes]),
      ].sort((left, right) => left - right);
      const unsupported = codes.filter(
        (code) => !records.has(code) || !texts.has(code),
      );
      if (unsupported.length) {
        progress(
          "unsupported-runtime-card-count",
          runtimeInput.digest.path,
          unsupported.length,
        );
        fail("ASSET_REFERENCE_MISSING", runtimeInput.digest.path);
      }
      const identities = chapterSetIdentities(normalized.sets, existingSets);
      const unavailableImages = verifiedUnavailableSetImageIds({
        evidence: setMedia,
        identities,
        sets: normalized.sets,
        providerBytes: setMediaSourceInput.bytes,
      });
      const built = buildChapterGameplay({
        normalized,
        existingSets,
        records,
        texts,
        authoring,
        story: storyInput.value,
        deckSources,
        selectedOpponentIds: [...chapter.opponentIds].sort(compareCodePoints),
        unavailableSetImageIds: unavailableImages,
      });
      chapters.push({
        id: chapter.id,
        title: chapter.title,
        description: built.description,
        storyContentId: chapter.storyContentId,
        setIds: built.setIds,
        unavailableSetImageIds: [...unavailableImages].sort(compareCodePoints),
        cardCodes: codes,
        opponentIds: built.gameplay.opponents.map(({ id }) => id),
        gameplay: built.gameplay,
        story: built.story,
      });
    }
    const prepared = parsePreparedPlayerMetadata({
      schemaVersion: 2,
      sourceInputs: inputs.sort((a, b) => compareCodePoints(a.path, b.path)),
      runtimeSnapshotId,
      runtimeCardCodes: [...records.keys()].sort((a, b) => a - b),
      chapters,
    });
    for (const input of inputs)
      if (!sameDigest(input, await digestSource(root, input.path, true)))
        fail("ASSET_SOURCE_CHANGED", input.path);
    await replaceMetadata(
      root,
      "asset-profiles/chapter-01.json",
      chapterProfile(prepared.chapters[0]!.gameplay),
    );
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
