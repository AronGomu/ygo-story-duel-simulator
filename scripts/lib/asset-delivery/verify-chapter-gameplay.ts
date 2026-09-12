import {
  parseChapterGameplay,
  parseChapterStoryDocument,
  type ChapterFileRef,
  type ChapterGameplay,
  type ChapterStoryDocument,
  type ContentIndex,
  type ContentManifest,
  type ManifestRef,
} from "../../../src/content/index.ts";
import { OCG_TYPE, hasOcgType } from "../../../src/decks/catalog/ocg-mask.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { canonicalBytes, parseJsonBytes } from "./canonical-json.ts";
import type { PreparedPlayerMetadata } from "./prepared-player-metadata.ts";
import { fail } from "./failure.ts";

function same(left: unknown, right: unknown): boolean {
  return Buffer.from(canonicalBytes(left)).equals(
    Buffer.from(canonicalBytes(right)),
  );
}

function activeManifest(
  manifests: ReadonlyMap<string, ContentManifest>,
  ref: ManifestRef,
): ContentManifest {
  const manifest = manifests.get(ref.sha256);
  if (!manifest || manifest.packId !== ref.packId)
    fail("ASSET_INTEGRITY_FAILED");
  return manifest;
}

function manifestClosure(
  manifests: ReadonlyMap<string, ContentManifest>,
  root: ContentManifest,
): ReadonlyMap<string, ContentManifest> {
  const byPack = new Map<string, ContentManifest>();
  const active = new Set<string>();
  const visit = (manifest: ContentManifest): void => {
    if (active.has(manifest.packId)) fail("ASSET_INTEGRITY_FAILED");
    const prior = byPack.get(manifest.packId);
    if (prior) {
      if (!same(prior, manifest)) fail("ASSET_INTEGRITY_FAILED");
      return;
    }
    active.add(manifest.packId);
    byPack.set(manifest.packId, manifest);
    for (const ref of manifest.dependencies)
      visit(activeManifest(manifests, ref));
    active.delete(manifest.packId);
  };
  visit(root);
  if (!byPack.has("runtime")) fail("ASSET_INTEGRITY_FAILED");
  return byPack;
}

function fileFor(
  closure: ReadonlyMap<string, ContentManifest>,
  ref: ChapterFileRef,
) {
  const manifest = closure.get(ref.packId);
  const file = manifest?.files.find(({ path }) => path === ref.path);
  if (!file) fail("ASSET_INTEGRITY_FAILED", ref.path);
  return file;
}

function validateFileRefs(
  gameplay: ChapterGameplay,
  story: ChapterStoryDocument,
  closure: ReadonlyMap<string, ContentManifest>,
): void {
  for (const card of gameplay.cards)
    for (const ref of [card.fullImage, card.croppedImage])
      if (!fileFor(closure, ref).mediaType.startsWith("image/"))
        fail("ASSET_INTEGRITY_FAILED", ref.path);
  for (const set of gameplay.sets) {
    if (set.image === null) {
      if (
        [...closure.values()].some((manifest) =>
          manifest.files.some(
            ({ path }) => path === `runtime/sets/${set.id}.jpg`,
          ),
        )
      )
        fail("ASSET_INTEGRITY_FAILED", set.id);
      continue;
    }
    if (!fileFor(closure, set.image).mediaType.startsWith("image/"))
      fail("ASSET_INTEGRITY_FAILED", set.image.path);
  }
  if (gameplay.story === null) return;
  if (
    fileFor(closure, gameplay.story.document).mediaType !== "application/json"
  )
    fail("ASSET_INTEGRITY_FAILED", gameplay.story.document.path);
  if (!fileFor(closure, story.mapImage).mediaType.startsWith("image/"))
    fail("ASSET_INTEGRITY_FAILED", story.mapImage.path);
}

function validateDecks(
  gameplay: ChapterGameplay,
  records: ReadonlyMap<number, ChapterGameplay["cards"][number]["record"]>,
): void {
  const allowedCodes = new Set(records.keys());
  const extraMasks = [
    OCG_TYPE.FUSION,
    OCG_TYPE.SYNCHRO,
    OCG_TYPE.XYZ,
    OCG_TYPE.LINK,
  ];
  const isExtra = (code: number) => {
    const record = records.get(code);
    return (
      record !== undefined &&
      extraMasks.some((mask) => hasOcgType(record.type, mask))
    );
  };
  for (const deck of gameplay.decks) {
    const counts = new Map<number, number>();
    for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
      if (!allowedCodes.has(code)) fail("ASSET_INTEGRITY_FAILED", String(code));
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    for (const [code, count] of counts)
      if (count > quantityLimit(PROTOTYPE_RULESET, code))
        fail("ASSET_INTEGRITY_FAILED", String(code));
    if (
      deck.main.some(isExtra) ||
      deck.extra.some((code) => !isExtra(code)) ||
      [...deck.main, ...deck.extra, ...deck.side].some((code) =>
        hasOcgType(records.get(code)?.type ?? 0, OCG_TYPE.TOKEN),
      )
    )
      fail("ASSET_INTEGRITY_FAILED", deck.id);
  }
}

function runtimeCatalog(captured: ReadonlyMap<string, Uint8Array>): {
  records: ReadonlyMap<number, Record<string, unknown>>;
  texts: ReadonlyMap<number, Record<string, unknown>>;
} {
  const records = new Map<number, Record<string, unknown>>();
  const texts = new Map<number, Record<string, unknown>>();
  for (const [path, bytes] of captured) {
    const cardRecords =
      /^runtime\/assets\/current\/catalog\/cards\/[a-f0-9]{2}\.json$/.test(
        path,
      );
    const cardTexts =
      /^runtime\/assets\/current\/catalog\/texts\/en\/[a-f0-9]{2}\.json$/.test(
        path,
      );
    if (!cardRecords && !cardTexts) continue;
    const value = parseJsonBytes(bytes);
    if (!Array.isArray(value)) fail("ASSET_INTEGRITY_FAILED", path);
    const target = cardRecords ? records : texts;
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        fail("ASSET_INTEGRITY_FAILED", path);
      const record = item as Record<string, unknown>;
      const code = record.code;
      if (
        typeof code !== "number" ||
        !Number.isSafeInteger(code) ||
        target.has(code)
      )
        fail("ASSET_INTEGRITY_FAILED", path);
      target.set(code, record);
    }
  }
  if (!records.size || !texts.size) fail("ASSET_INTEGRITY_FAILED");
  return { records, texts };
}

function exactRuntimeCards(
  gameplay: ChapterGameplay,
  runtime: ReturnType<typeof runtimeCatalog>,
): void {
  for (const card of gameplay.cards) {
    const source = runtime.records.get(card.code);
    const text = runtime.texts.get(card.code);
    if (!source || !text) fail("ASSET_INTEGRITY_FAILED", String(card.code));
    const projected = {
      code: source.code,
      alias: source.alias,
      setcodes: source.setcodes,
      type: source.type,
      level: source.level,
      attribute: source.attribute,
      race: source.race,
      attack: source.attack,
      defense: source.defense,
      lscale: source.lscale,
      rscale: source.rscale,
      linkMarker: source.linkMarker,
      ot: source.ot,
    };
    if (!same(card.record, projected) || !same(card.text, text))
      fail("ASSET_INTEGRITY_FAILED", String(card.code));
  }
}

export function addUniqueGameplayEntries(
  target: Map<string, unknown>,
  entries: readonly { readonly id: string }[],
): void {
  for (const entry of entries) {
    if (target.has(entry.id)) fail("ASSET_INTEGRITY_FAILED", entry.id);
    target.set(entry.id, entry);
  }
}

export function verifyChapterGameplay(input: {
  readonly index: ContentIndex;
  readonly manifests: ReadonlyMap<string, ContentManifest>;
  readonly captured: ReadonlyMap<string, Uint8Array>;
  readonly prepared: PreparedPlayerMetadata;
}): void {
  const runtime = runtimeCatalog(input.captured);
  const decks = new Map<string, unknown>();
  const opponents = new Map<string, unknown>();
  for (const release of input.index.chapters) {
    if (release.status !== "published") continue;
    const manifest = activeManifest(input.manifests, release.manifest);
    const closure = manifestClosure(input.manifests, manifest);
    const gameplayFile = manifest.files.find(
      ({ path }) => path === manifest.gameplayPath,
    );
    if (!gameplayFile) fail("ASSET_INTEGRITY_FAILED");
    const gameplayBytes = input.captured.get(gameplayFile.path);
    if (!gameplayBytes) fail("ASSET_INTEGRITY_FAILED", gameplayFile.path);
    const gameplay = (() => {
      try {
        const parsed = parseChapterGameplay(parseJsonBytes(gameplayBytes));
        if (parsed.kind !== "ok") fail("ASSET_INTEGRITY_FAILED");
        return parsed.value;
      } catch {
        fail("ASSET_INTEGRITY_FAILED", gameplayFile.path);
      }
    })();
    const prepared = input.prepared.chapters.find(
      ({ id }) => id === release.id,
    );
    if (
      !prepared ||
      gameplay.chapterId !== release.id ||
      release.description !== prepared.description ||
      manifest.storyContentId !== gameplay.story?.contentId ||
      !same(
        manifest.cardCodes,
        gameplay.cards.map(({ code }) => code),
      ) ||
      !same(
        manifest.opponentIds,
        gameplay.opponents.map(({ id }) => id),
      ) ||
      !same(gameplay, prepared.gameplay)
    )
      fail("ASSET_INTEGRITY_FAILED");
    const storyRef = gameplay.story?.document;
    if (!storyRef) fail("ASSET_INTEGRITY_FAILED");
    const storyFile = fileFor(closure, storyRef);
    const storyBytes = input.captured.get(storyFile.path);
    if (!storyBytes) fail("ASSET_INTEGRITY_FAILED", storyFile.path);
    const story = (() => {
      try {
        const parsed = parseChapterStoryDocument(parseJsonBytes(storyBytes));
        if (parsed.kind !== "ok") fail("ASSET_INTEGRITY_FAILED");
        return parsed.value;
      } catch {
        fail("ASSET_INTEGRITY_FAILED", storyFile.path);
      }
    })();
    if (
      story.contentId !== gameplay.story!.contentId ||
      !same(story, prepared.story) ||
      !same(prepared.setIds, gameplay.sets.map(({ id }) => id).sort()) ||
      !same(
        prepared.unavailableSetImageIds,
        gameplay.sets
          .filter(({ image }) => image === null)
          .map(({ id }) => id)
          .sort(),
      )
    )
      fail("ASSET_INTEGRITY_FAILED");
    validateFileRefs(gameplay, story, closure);
    const allowedCards = new Map<
      number,
      ChapterGameplay["cards"][number]["record"]
    >();
    for (const [packId, dependency] of closure) {
      if (packId === "runtime") continue;
      const path = dependency.gameplayPath;
      const file = dependency.files.find(
        (candidate) => candidate.path === path,
      );
      const bytes = file && input.captured.get(file.path);
      if (!bytes) fail("ASSET_INTEGRITY_FAILED");
      const parsed = parseChapterGameplay(parseJsonBytes(bytes));
      if (parsed.kind !== "ok") fail("ASSET_INTEGRITY_FAILED");
      for (const card of parsed.value.cards) {
        const prior = allowedCards.get(card.code);
        if (prior !== undefined && !same(prior, card.record))
          fail("ASSET_INTEGRITY_FAILED", String(card.code));
        allowedCards.set(card.code, card.record);
      }
    }
    for (const set of gameplay.sets)
      for (const card of set.cards)
        if (!allowedCards.has(card.code))
          fail("ASSET_INTEGRITY_FAILED", String(card.code));
    validateDecks(gameplay, allowedCards);
    exactRuntimeCards(gameplay, runtime);
    addUniqueGameplayEntries(decks, gameplay.decks);
    addUniqueGameplayEntries(opponents, gameplay.opponents);
    const files = new Map<string, unknown>();
    for (const dependency of closure.values())
      for (const file of dependency.files) {
        const prior = files.get(file.path);
        if (prior !== undefined && !same(prior, file))
          fail("ASSET_INTEGRITY_FAILED", file.path);
        files.set(file.path, file);
      }
  }
}
