import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeckSources } from "../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../src/battle/duel/presets/reviewed-card-pool.ts";
import { sha256File } from "./lib/files.ts";
import type {
  CardImageDigest,
  SetImageDigest,
} from "./lib/image-content-lock.ts";
import {
  IMAGE_CONTENT_LOCK_FILE,
  buildImageContentLock,
} from "./lib/image-content-lock.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import type { ShopSetIdentity } from "./lib/set-images.ts";
import { setImageFileName } from "./lib/set-images.ts";

/* Audit F16b. Seeds the tracked image pin from the local archive, covering the
   shipped surface only: the preset-deck card codes and the shop set art.

   It is deliberately its own command. Regenerating the lock while downloading
   or verifying would close the check on its own output — the exact loop the
   lock exists to break — so an upstream art refresh has to be an intended act
   whose diff someone reads. Art the archive has no file for is reported rather
   than raised; a card image missing here already fails the browser build. */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const cardArchive = resolveProjectSubpath(
  projectRoot,
  ASSET_SOURCES.fullImages.source,
  path.posix.dirname(ASSET_SOURCES.setImages.source),
  "card image archive",
);
const cropArchive = resolveProjectSubpath(
  projectRoot,
  ASSET_SOURCES.croppedImages.source,
  path.posix.dirname(ASSET_SOURCES.setImages.source),
  "cropped card image archive",
);
const setArchive = resolveProjectSubpath(
  projectRoot,
  ASSET_SOURCES.setImages.source,
  path.posix.dirname(ASSET_SOURCES.setImages.source),
  "set image archive",
);

const cards: CardImageDigest[] = [];
const crops: CardImageDigest[] = [];
const missingCards: number[] = [];
const missingCrops: number[] = [];
for (const code of reviewedCardPool(await loadDeckSources())) {
  const filePath = path.join(cardArchive, `${code}.jpg`);
  if (!existsSync(filePath)) {
    missingCards.push(code);
    continue;
  }
  cards.push({
    code,
    bytes: (await stat(filePath)).size,
    sha256: await sha256File(filePath),
  });
  const cropPath = path.join(cropArchive, `${code}.jpg`);
  if (!existsSync(cropPath)) {
    missingCrops.push(code);
    continue;
  }
  crops.push({
    code,
    bytes: (await stat(cropPath)).size,
    sha256: await sha256File(cropPath),
  });
}

const shop = JSON.parse(
  await readFile(
    path.join(projectRoot, "public/story/shop-sets.v1.json"),
    "utf8",
  ),
) as { sets: readonly ShopSetIdentity[] };
const sets: SetImageDigest[] = [];
const missingSets: string[] = [];
for (const set of shop.sets) {
  const filePath = path.join(setArchive, setImageFileName(set.id));
  if (!existsSync(filePath)) {
    missingSets.push(set.id);
    continue;
  }
  sets.push({
    setId: set.id,
    bytes: (await stat(filePath)).size,
    sha256: await sha256File(filePath),
  });
}

const lock = buildImageContentLock(cards, crops, sets);
await writeFile(
  path.join(projectRoot, IMAGE_CONTENT_LOCK_FILE),
  `${JSON.stringify(lock, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        missingCards.length || missingCrops.length || missingSets.length
          ? "partial"
          : "ok",
      lock: IMAGE_CONTENT_LOCK_FILE,
      cards: lock.cards.length,
      crops: lock.crops.length,
      sets: lock.sets.length,
      missingCards: missingCards.sort((left, right) => left - right),
      missingCrops: missingCrops.sort((left, right) => left - right),
      missingSets: missingSets.sort((left, right) => left.localeCompare(right)),
    },
    null,
    2,
  ),
);
