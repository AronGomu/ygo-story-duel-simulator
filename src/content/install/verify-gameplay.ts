import { OCG_TYPE, hasOcgType } from "../../decks/catalog/ocg-mask.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../decks/catalog/pinned-ruleset.ts";
import type { ChapterGameplay } from "../contracts/chapter-gameplay.ts";
import type { ChapterFileRef } from "../contracts/chapter-file-ref.ts";
import type { ContentReadPort } from "../contracts/content-read-port.ts";
import { parseChapterGameplay } from "../parsers/chapter-gameplay.ts";
import { parseChapterStoryDocument } from "../parsers/chapter-story-document.ts";
import { failure, json, same, unwrap } from "../content-verification.ts";
import { manifestClosure, type ManifestEntry } from "./manifest-closure.ts";

export async function verifyGameplay(
  entries: readonly ManifestEntry[],
  reader: ContentReadPort,
): Promise<void> {
  const fail = (): never => {
    throw failure("CONTENT_INCOMPATIBLE");
  };
  const byPack = new Map(entries.map((e) => [e.ref.packId, e]));
  const runtime = byPack.get("runtime");
  if (!runtime) fail();
  const runtimeCodes = new Set(runtime!.manifest.cardCodes);
  const games = new Map<string, ChapterGameplay>();
  const definitions = new Map<string, unknown>();
  for (const entry of entries) {
    if (entry.ref.packId === "runtime") continue;
    const file = entry.manifest.files.find(
      (f) => f.path === entry.manifest.gameplayPath,
    );
    if (!file || file.bytes > 4194304)
      throw failure("CONTENT_INVALID_MANIFEST");
    const game = unwrap(
      parseChapterGameplay(
        json(
          new Uint8Array(
            await unwrap(
              await reader.readFile(entry.ref, file.path),
            ).arrayBuffer(),
          ),
        ),
      ),
    );
    if (
      game.chapterId !== entry.ref.packId ||
      !same(
        entry.manifest.cardCodes,
        game.cards.map((c) => c.code),
      ) ||
      !same(
        entry.manifest.opponentIds,
        game.opponents.map((o) => o.id),
      ) ||
      entry.manifest.storyContentId !== (game.story?.contentId ?? null)
    )
      fail();
    games.set(game.chapterId, game);
    for (const [kind, records] of [
      ["deck", game.decks],
      ["opponent", game.opponents],
    ] as const)
      for (const record of records) {
        const key = `${kind}:${record.id}`;
        if (definitions.has(key) && !same(definitions.get(key), record)) fail();
        definitions.set(key, record);
      }
  }
  const runtimeRecords = new Map<number, Record<string, unknown>>();
  const runtimeTexts = new Map<number, Record<string, unknown>>();
  for (const file of runtime!.manifest.files) {
    const records =
      /^runtime\/assets\/current\/catalog\/cards\/[a-f0-9]{2}\.json$/.test(
        file.path,
      );
    const texts =
      /^runtime\/assets\/current\/catalog\/texts\/en\/[a-f0-9]{2}\.json$/.test(
        file.path,
      );
    if (!records && !texts) continue;
    const rows = json(
      new Uint8Array(
        await unwrap(
          await reader.readFile(runtime!.ref, file.path),
        ).arrayBuffer(),
      ),
    );
    if (!Array.isArray(rows)) fail();
    const target = records ? runtimeRecords : runtimeTexts;
    for (const row of rows as unknown[]) {
      if (
        !row ||
        typeof row !== "object" ||
        !("code" in row) ||
        typeof row.code !== "number" ||
        target.has(row.code)
      )
        fail();
      target.set(
        (row as { code: number }).code,
        row as Record<string, unknown>,
      );
    }
  }
  for (const [id, game] of games) {
    const root = byPack.get(id as ChapterGameplay["chapterId"])!;
    const closure = await manifestClosure([root.ref], async (ref) => {
      const entry = byPack.get(ref.packId);
      if (!entry || !same(entry.ref, ref)) fail();
      return entry!.manifest;
    });
    const allowed = new Map<number, ChapterGameplay["cards"][number]>();
    for (const entry of closure)
      for (const card of games.get(entry.ref.packId)?.cards ?? []) {
        if (allowed.has(card.code) && !same(allowed.get(card.code), card))
          fail();
        allowed.set(card.code, card);
      }
    const fileFor = (ref: ChapterFileRef, media: string) => {
      const entry = closure.find((e) => e.ref.packId === ref.packId);
      const file = entry?.manifest.files.find((f) => f.path === ref.path);
      if (!file || !file.mediaType.startsWith(media)) fail();
      return entry!;
    };
    for (const card of game.cards) {
      if (!runtimeCodes.has(card.code)) fail();
      fileFor(card.fullImage, "image/");
      fileFor(card.croppedImage, "image/");
      const record = runtimeRecords.get(card.code);
      const projection =
        record &&
        Object.fromEntries(
          Object.keys(card.record).map((key) => [key, record[key]]),
        );
      if (
        !same(projection, card.record) ||
        !same(runtimeTexts.get(card.code), card.text)
      )
        fail();
    }
    for (const set of game.sets) {
      if (set.image !== null) fileFor(set.image, "image/");
      for (const card of set.cards) if (!allowed.has(card.code)) fail();
    }
    if (game.story) {
      const entry = fileFor(game.story.document, "application/json");
      const storyBytes = new Uint8Array(
        await unwrap(
          await reader.readFile(entry.ref, game.story.document.path),
        ).arrayBuffer(),
      );
      if (storyBytes.length > 4194304)
        throw failure("CONTENT_INVALID_MANIFEST");
      const story = unwrap(parseChapterStoryDocument(json(storyBytes)));
      if (story.contentId !== game.story.contentId) fail();
      fileFor(story.mapImage, "image/");
    }
    const isExtra = (code: number) =>
      [OCG_TYPE.FUSION, OCG_TYPE.SYNCHRO, OCG_TYPE.XYZ, OCG_TYPE.LINK].some(
        (mask) => hasOcgType(allowed.get(code)?.record.type ?? 0, mask),
      );
    for (const deck of game.decks) {
      const counts = new Map<number, number>();
      for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
        if (
          !allowed.has(code) ||
          hasOcgType(allowed.get(code)!.record.type, OCG_TYPE.TOKEN)
        )
          fail();
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      for (const [code, count] of counts)
        if (count > quantityLimit(PROTOTYPE_RULESET, code)) fail();
      if (deck.main.some(isExtra) || deck.extra.some((code) => !isExtra(code)))
        fail();
    }
  }
}
