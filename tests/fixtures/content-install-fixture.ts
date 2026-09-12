import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { createHash } from "node:crypto";
import {
  contentRuntimeFixture,
  type ContentRuntimeFixtureOptions,
} from "./content-runtime-fixture.ts";
import type {
  ChapterGameplay,
  ContentManifest,
  CoreBootstrap,
  ManifestRef,
  ContentSetRef,
  PackId,
  ContentMediaType,
} from "../../src/content/index.ts";

export const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
export async function archiveFixture(
  entries: readonly { path: string; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    dataDescriptor: true,
    dataDescriptorSignature: true,
    bufferedWrite: false,
    useWebWorkers: false,
    useCompressionStream: false,
    useUnicodeFileNames: true,
    rawLastModDate: 0x00210000,
    extendedTimestamp: false,
    ntfsTimestamp: false,
    msDosCompatible: true,
    versionMadeBy: 20,
    externalFileAttributes: 0,
    internalFileAttributes: 0,
    zip64: false,
  });
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path)))
    await writer.add(entry.path, new Uint8ArrayReader(entry.bytes));
  return writer.close();
}
export async function contentInstallFixture(
  options: ContentRuntimeFixtureOptions & {
    readonly realRuntime?: boolean;
    readonly runtimeCardCodes?: readonly number[];
  } = {},
) {
  const objects = new Map<string, Uint8Array>();
  let snapshotId = "1".repeat(64);
  const image = {
    packId: "chapter-01" as const,
    path: "chapters/chapter-01/card.png",
  };
  const cards: ChapterGameplay["cards"] = Array.from(
    { length: 14 },
    (_, i) => ({
      code: i + 1,
      record: {
        code: i + 1,
        alias: 0,
        setcodes: [],
        type: 17,
        level: 4,
        attribute: 1,
        race: "1",
        attack: 1000,
        defense: 1000,
        lscale: 0,
        rscale: 0,
        linkMarker: 0,
        ot: 3,
      },
      text: {
        code: i + 1,
        name: `Card ${i + 1}`,
        description: "Fixture",
        strings: [],
      },
      fullImage: image,
      croppedImage: image,
    }),
  );
  const gameplay: ChapterGameplay = {
    schemaVersion: 1,
    chapterId: "chapter-01",
    cards,
    sets: [
      {
        id: "set-fixture",
        name: "Fixture",
        releaseYear: 2000,
        image,
        cards: [
          {
            code: 1,
            name: "Card 1",
            rarity: "common",
            printingCode: "TEST-001",
            sourceRarity: "Common",
            sourceRarityCode: "C",
          },
        ],
      },
    ],
    decks: [
      {
        id: "starter",
        name: "Starter",
        main: Array.from({ length: 40 }, (_, i) => (i % 14) + 1),
        extra: [],
        side: [],
      },
    ],
    opponents: [
      {
        id: "rival",
        name: "Rival",
        line: "Duel",
        deckId: "starter",
        policyId: "basic",
      },
    ],
    defaults: { starterDeckId: "starter", opponentId: "rival" },
    story: null,
  };
  async function pack(
    packId: PackId,
    files: readonly {
      path: string;
      bytes: Uint8Array;
      mediaType: ContentMediaType;
    }[],
    dependencies: readonly ManifestRef[],
  ) {
    const archive = await archiveFixture(files);
    const partSha256 = sha(archive);
    objects.set(`content/parts/${partSha256}.zip`, archive);
    const manifest: ContentManifest = {
      schemaVersion: 2,
      packId,
      runtimeSnapshotId: snapshotId,
      storyContentId: null,
      gameplayPath:
        packId === "runtime" ? null : `chapters/${packId}/gameplay.json`,
      dependencies,
      cardCodes:
        packId === "runtime" && options.runtimeCardCodes !== undefined
          ? options.runtimeCardCodes
          : cards.map((c) => c.code),
      opponentIds: packId === "runtime" ? [] : ["rival"],
      parts: [
        {
          sha256: partSha256,
          bytes: archive.length,
          unpackedBytes: files.reduce((n, f) => n + f.bytes.length, 0),
        },
      ],
      files: [...files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => ({
          path: f.path,
          bytes: f.bytes.length,
          sha256: sha(f.bytes),
          mediaType: f.mediaType,
          partSha256,
          entry: f.path,
        })),
    };
    const bytes = encode(manifest);
    const ref = { packId, sha256: sha(bytes), bytes: bytes.length };
    objects.set(`content/manifests/${ref.sha256}.json`, bytes);
    return { ref, manifest };
  }
  const runtimeFixture = options.realRuntime
    ? await contentRuntimeFixture(cards, options)
    : null;
  if (runtimeFixture) snapshotId = runtimeFixture.snapshotId;
  const runtimeRaw = runtimeFixture?.runtimeRaw ?? encode({ fixture: true });
  const runtime = await pack(
    "runtime",
    runtimeFixture?.files ?? [
      {
        path: "runtime/current/manifest.json",
        bytes: runtimeRaw,
        mediaType: "application/json",
      },
      {
        path: "runtime/assets/current/catalog/cards/00.json",
        bytes: encode(cards.map((c) => c.record)),
        mediaType: "application/json",
      },
      {
        path: "runtime/assets/current/catalog/texts/en/00.json",
        bytes: encode(cards.map((c) => c.text)),
        mediaType: "application/json",
      },
    ],
    [],
  );
  const chapter = await pack(
    "chapter-01",
    [
      {
        path: "chapters/chapter-01/gameplay.json",
        bytes: encode(gameplay),
        mediaType: "application/json",
      },
      {
        path: image.path,
        bytes: new Uint8Array([137, 80, 78, 71]),
        mediaType: "image/png",
      },
    ],
    [runtime.ref],
  );
  const index = {
    schemaVersion: 2,
    releaseId: "fixture",
    runtimeSnapshotId: snapshotId,
    runtime: runtime.ref,
    chapters: [
      {
        id: "chapter-01",
        title: "Chapter 1",
        description: "Prototype",
        status: "published",
        manifest: chapter.ref,
      },
    ],
    retainedCatalogs: [],
    retainedManifests: [],
  };
  const indexBytes = encode(index);
  const pin = { sha256: sha(indexBytes), bytes: indexBytes.length };
  objects.set(`content/indexes/${pin.sha256}.json`, indexBytes);
  const bootstrap: CoreBootstrap = {
    schemaVersion: 1,
    appSchemaVersion: 1,
    contentSchemaVersion: 2,
    hashAlgorithm: "SHA-256",
    delivery: { baseUrl: "http://localhost/", index: pin },
    chapters: [
      { id: "chapter-01", title: "Chapter 1", description: "Prototype" },
    ],
  };
  const content: ContentSetRef = {
    catalogSha256: pin.sha256,
    runtime: runtime.ref,
    chapters: [chapter.ref],
    snapshot: {
      activationId: sha(
        encode({
          runtimeSnapshotId: snapshotId,
          releaseCatalogSha256: pin.sha256,
        }),
      ),
      runtimeSnapshotId: snapshotId,
      runtimeManifestSha256: sha(runtimeRaw),
      releaseCatalogSha256: pin.sha256,
    },
  };
  return { objects, bootstrap, content, runtime, chapter };
}
