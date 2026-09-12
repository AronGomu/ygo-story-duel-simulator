/** Sole build-tool source map. Vendor and tracked gameplay policy never move. */
export const ASSET_SOURCES = {
  data: {
    legacy: "generated/assets/current",
    source: "assets/shared/data/current",
    logical: "runtime/assets/current",
    kind: "tree",
  },
  runtime: {
    legacy: "generated/runtime/current",
    source: "assets/shared/runtime/current",
    logical: "runtime/current",
    kind: "tree",
  },
  fullImages: {
    legacy: "generated/card-images/archive/full",
    source: "assets/shared/card-images/full",
    logical: "runtime/images",
    kind: "tree",
  },
  croppedImages: {
    legacy: "generated/card-images/archive/cropped",
    source: "assets/shared/card-images/cropped",
    logical: "runtime/images-cropped",
    kind: "tree",
  },
  cardBack: {
    legacy: "generated/card-images/card-back.jpg",
    source: "assets/shared/card-back.jpg",
    logical: "runtime/images/card-back.jpg",
    kind: "file",
  },
  setImages: {
    legacy: "generated/set-images",
    source: "assets/shared/set-images",
    logical: "runtime/sets",
    kind: "tree",
  },
  acquiredEngine: {
    legacy: "generated/engine/current",
    source: "assets/battle/engine/current",
    logical: null,
    kind: "tree",
  },
  story: {
    legacy: "src/story/assets",
    source: "assets/story",
    logical: "story/media",
    kind: "tree",
  },
} as const;
