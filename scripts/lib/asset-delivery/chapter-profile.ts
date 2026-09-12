import type { ChapterGameplay } from "../../../src/content/index.ts";
import type { AssetProfile, AssetRule } from "./asset-profile.ts";
import { compareRules } from "./profile-set.ts";

export function chapterProfile(gameplay: ChapterGameplay): AssetProfile {
  const rules: AssetRule[] = [];
  for (const card of gameplay.cards) {
    rules.push(
      {
        root: "shared",
        path: `card-images/full/${card.code}.jpg`,
        kind: "file",
        logicalPath: card.fullImage.path,
      },
      {
        root: "shared",
        path: `card-images/cropped/${card.code}.jpg`,
        kind: "file",
        logicalPath: card.croppedImage.path,
      },
    );
  }
  for (const set of gameplay.sets)
    if (set.image !== null)
      rules.push({
        root: "shared",
        path: `set-images/${set.id}.jpg`,
        kind: "file",
        logicalPath: set.image.path,
      });
  if (gameplay.story !== null)
    rules.push({
      root: "story",
      path: "chapter-01/city-map-placeholder.svg",
      kind: "file",
      logicalPath: "story/media/chapter-01/city-map-placeholder.svg",
    });
  return {
    schemaVersion: 1,
    id: "chapter-01",
    dependsOn: ["runtime"],
    rules: rules.sort(compareRules),
  };
}
