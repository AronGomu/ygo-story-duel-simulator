import { ASSET_SOURCES } from "./asset-roots.ts";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  MAX_SETUP_BYTES,
  MAX_SOURCE_BYTES,
  parseCardSetSource,
  parseChapterSelections,
  verifyContentSetup,
  type SetupAvailability,
  type SetupReport,
} from "./content-setup.ts";
import { validJpegFileSize } from "./images.ts";
import { writeJsonAtomic } from "./run-lock.ts";
import { json, readBounded, record } from "./content-setup-io.ts";
import { inspectSetupRuntime } from "./content-setup-runtime.ts";
import { inspectPrototypeDecks } from "./content-setup-decks.ts";

async function inspectAvailability(
  root: string,
  sourceText: Uint8Array | null,
  selectionsValue: unknown,
): Promise<SetupAvailability> {
  let runtimeCardCodes = new Set<number>();
  const fullCardCodes = new Set<number>();
  const croppedCardCodes = new Set<number>();
  const setNames = new Set<string>();
  let runtimeVerified = false;
  try {
    const codes = await inspectSetupRuntime(root);
    if (codes !== null) {
      runtimeCardCodes = codes;
      runtimeVerified = true;
    }
  } catch {
    // Runtime validators throw data/IO diagnostics containing input values.
    // Convert to fixed SOURCE_COVERAGE_REQUIRED below, never echo exception text.
    runtimeVerified = false;
  }
  const source = parseCardSetSource(sourceText);
  const selections = parseChapterSelections(selectionsValue);
  const selectedNames = new Set(
    selections?.chapters.flatMap((chapter) => chapter.setNames) ?? [],
  );
  const selectedCodes = new Set(
    source?.sets
      .filter((set) => selectedNames.has(set.name))
      .flatMap((set) => set.cards.map((card) => card.id)) ?? [],
  );
  for (const code of selectedCodes) {
    for (const [kind, available] of [
      ["full", fullCardCodes],
      ["cropped", croppedCardCodes],
    ] as const) {
      const bytes = await validJpegFileSize(
        path.join(
          root,
          `${path.posix.dirname(ASSET_SOURCES.fullImages.source)}/${kind}/${code}.jpg`,
        ),
      );
      if (bytes !== null && bytes <= 8 * 1024 * 1024) available.add(code);
    }
  }
  // Existing set downloader keys art by shop ID, not source name. Unknown sets stay missing.
  const shop = await json(
    root,
    "public/story/shop-sets.v1.json",
    MAX_SOURCE_BYTES,
  );
  const manifest = await json(
    root,
    `${ASSET_SOURCES.setImages.source}/manifest.json`,
  );
  if (
    record(shop) &&
    Array.isArray(shop.sets) &&
    shop.sets.length <= 2048 &&
    record(manifest) &&
    manifest.schemaVersion === 1 &&
    Array.isArray(manifest.files) &&
    manifest.files.length <= 2048
  ) {
    for (const set of shop.sets) {
      if (
        !record(set) ||
        typeof set.id !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(set.id) ||
        typeof set.name !== "string" ||
        !selectedNames.has(set.name)
      )
        continue;
      const entry = manifest.files.find(
        (item) => record(item) && item.setId === set.id,
      );
      const bytes = await readBounded(
        root,
        `${ASSET_SOURCES.setImages.source}/${set.id}.jpg`,
        8 * 1024 * 1024,
      );
      if (
        record(entry) &&
        bytes !== null &&
        entry.bytes === bytes.length &&
        entry.sha256 === createHash("sha256").update(bytes).digest("hex") &&
        (await validJpegFileSize(
          path.join(root, `${ASSET_SOURCES.setImages.source}/${set.id}.jpg`),
        )) !== null
      )
        setNames.add(set.name);
    }
  }
  const prototypeMedia = (
    await Promise.all(
      [
        "src/story/content/prologue.ts",
        `${ASSET_SOURCES.story.source}/city-map-placeholder.svg`,
        `${ASSET_SOURCES.story.source}/PROVENANCE.md`,
      ].map(async (file) => {
        const bytes = await readBounded(root, file, MAX_SETUP_BYTES);
        return bytes !== null && bytes.length > 0;
      }),
    )
  ).every(Boolean);
  return {
    runtimeVerified,
    runtimeCardCodes,
    fullCardCodes,
    croppedCardCodes,
    setNames,
    prototypeMedia,
    prototypeDecksCompatible: await inspectPrototypeDecks(root, selectedCodes),
  };
}

export async function inspectContentSetup(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SetupReport> {
  const source = await readBounded(
    root,
    "content/authoring/card-set-source.json",
    MAX_SOURCE_BYTES,
  );
  const selections = await json(root, "content/chapter-selections.json");
  return verifyContentSetup({
    source,
    chapterPolicy: await json(root, "content/authoring/chapter-policy.json"),
    selections,
    distribution: await json(root, "content/distribution-evidence.json"),
    setup: await json(root, "content/setup-evidence.json"),
    environment,
    availability: await inspectAvailability(root, source, selections),
  });
}

export async function runContentSetup(
  root: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== "--public")) {
      console.error("Usage: npm run content:setup:verify [-- --public]");
      return 1;
    }
    const report = await inspectContentSetup(root, environment);
    await writeJsonAtomic(
      path.join(root, "generated/content/setup-report.json"),
      report,
    );
    console.log(JSON.stringify(report, null, 2));
    return (args.includes("--public") ? report.publishReady : report.codeReady)
      ? 0
      : 2;
  } catch {
    // Never expose paths, environment values, parsed data, or exception messages.
    console.error("Content setup verification failed unexpectedly.");
    return 1;
  }
}
