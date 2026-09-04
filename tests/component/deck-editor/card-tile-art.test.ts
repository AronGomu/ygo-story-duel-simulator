// @vitest-environment jsdom

import { readFileSync } from "fs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CardTile from "../../../src/deck-editor/components/CardTile.svelte";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";

afterEach(() => cleanup());

const TILE_SOURCE = readFileSync(
  "src/deck-editor/components/CardTile.svelte",
  "utf8",
);

/* `vite-plugin-svelte` keeps component CSS out of the jsdom document — there
   is no `<style>` element to cascade from and `getComputedStyle` answers
   `none` for every one of these properties — so the rules are read from the
   source. Read by selector, though: a bare `expect(source).toMatch(/width:
   100%/)` passes for any file that declares that anywhere, which is why it
   went on passing over the build where the art rendered as a top-left crop.
   The Chromium half of this, where the boxes are real, is
   "the tile art fills the tile" in `e2e/deck-editor.spec.ts`. */
function rules(source: string): ReadonlyMap<string, string> {
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? "";
  const found = new Map<string, string>();
  for (const [, selector, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    found.set(
      (selector ?? "").trim().replace(/\s+/g, " "),
      (body ?? "").trim(),
    );
  return found;
}

function declarations(selector: string): readonly string[] {
  const body = rules(TILE_SOURCE).get(selector);
  expect(body, `CardTile.svelte has no \`${selector}\` rule`).toBeDefined();
  return body!
    .split(";")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length > 0);
}

describe("card-tile data-cy uniqueness", () => {
  it("two tiles with the same code but different prefix+id have distinct data-cy", () => {
    const base = PROTOTYPE_CATALOG[0]!;
    const card = { ...base, imageUrl: null };
    /* Render both tiles into the same document, proving distinctness. */
    render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "a",
      dataCyId: 1,
    });
    render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "b",
      dataCyId: 2,
    });
    const tileA = document.querySelector('[data-cy="a-tile-1"]');
    const tileB = document.querySelector('[data-cy="b-tile-2"]');
    expect(tileA).not.toBeNull();
    expect(tileB).not.toBeNull();
    /* No collision — the old single-code `data-cy` would have failed here. */
    expect(tileA).not.toBe(tileB);
  });
});

describe("card-tile art fit", () => {
  it("the tile image is lazy and asynchronous", () => {
    const base = PROTOTYPE_CATALOG[0]!;
    const card = { ...base, imageUrl: "/runtime/images/1.jpg" };
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "catalog",
      dataCyId: card.code,
    });
    const img = container.querySelector(
      `[data-cy="catalog-tile-image-${card.code}"]`,
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("the tile image is styled to fill its rectangle", () => {
    const art = declarations(".card-art");
    expect(art).toContain("width: 100%");
    expect(art).toContain("height: 100%");
    expect(art).toContain("object-fit: cover");
  });

  /* The art only fills the tile because every child is stacked in the one
     named grid area. Without it the badge, the art and the name take a row
     each, `height: 100%` resolves against a content-sized row, and the art
     renders as a strip across the top of the tile instead of the card. Both
     halves of the mechanism, because either one alone does nothing. */
  it("the tile stacks its children in a single named grid area", () => {
    const tile = declarations(".card-tile");
    expect(tile).toContain("display: grid");
    expect(tile).toContain('grid-template-areas: "card"');
    expect(declarations(".card-tile > *")).toContain("grid-area: card");
  });

  /* The placeholder is the other thing that occupies the area, and it is what
     a card this build packages no image for shows, so it carries the same fill
     rules as the image. */
  it("the placeholder fills the same rectangle as the art", () => {
    const placeholder = declarations(".art-placeholder");
    expect(placeholder).toContain("width: 100%");
    expect(placeholder).toContain("height: 100%");
  });

  it("keeps every card name on one ellipsized line", () => {
    const name = declarations(".card-name");
    expect(name).toContain("overflow: hidden");
    expect(name).toContain("text-overflow: ellipsis");
    expect(name).toContain("white-space: nowrap");
    expect(name).not.toContain("-webkit-line-clamp: 2");
    expect(name).not.toContain("min-height: 2.1rem");
  });

  it("a card whose art this build has no image for falls back to the glyph", async () => {
    /* Every code gets a URL by convention now, so the 404 is the only signal
       that this build packages no image for the card. */
    const base = PROTOTYPE_CATALOG[0]!;
    const card = { ...base, imageUrl: `/runtime/images/${base.code}.jpg` };
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "catalog",
      dataCyId: card.code,
    });
    const img = container.querySelector(
      `[data-cy="catalog-tile-image-${card.code}"]`,
    )!;
    await fireEvent.error(img);
    await waitFor(() =>
      expect(
        container.querySelector(`[data-cy="catalog-tile-art-${card.code}"]`),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector(`[data-cy="catalog-tile-image-${card.code}"]`),
    ).toBeNull();
  });

  it("a card without art keeps the placeholder glyph", () => {
    const base = PROTOTYPE_CATALOG[0]!;
    const card = { ...base, imageUrl: null };
    const { container } = render(CardTile, {
      card,
      code: card.code,
      limit: 3,
      currentCopies: 0,
      dataCyPrefix: "catalog",
      dataCyId: card.code,
    });
    expect(
      container.querySelector(`[data-cy="catalog-tile-art-${card.code}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-cy="catalog-tile-image-${card.code}"]`),
    ).toBeNull();
  });
});
