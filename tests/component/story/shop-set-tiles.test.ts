// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import SetTile from "../../../src/story/shop/SetTile.svelte";
import ShopBrowseScreen from "../../../src/story/shop/ShopBrowseScreen.svelte";
import { latestReleasedSets } from "../../../src/story/shop/data/latest-sets.ts";
import type { ShopSetEntry } from "../../../src/story/shop/data/shop-set-data.ts";

afterEach(() => cleanup());

const noop = () => undefined;

function set(id: string, releaseYear: number, released = true): ShopSetEntry {
  return { id, name: id.replace(/-/g, " "), releaseYear, released, cards: [] };
}

const LOB = "legend-of-blue-eyes-white-dragon";

function browse(sets: readonly ShopSetEntry[]): HTMLElement {
  return render(ShopBrowseScreen, {
    sets,
    error: null,
    dp: 1000,
    onbuy: noop,
    onback: noop,
  }).container;
}

describe("shop set tiles", () => {
  it("renders the set image when one exists", () => {
    const container = browse([set(LOB, 2002)]);
    const image = container.querySelector<HTMLImageElement>(
      `[data-cy="story-shop-set-image-${LOB}"]`,
    );
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toMatch(
      new RegExp(`runtime/sets/${LOB}\\.jpg$`),
    );
    expect(
      container.querySelector(`[data-cy="story-shop-set-fallback-${LOB}"]`),
    ).toBeNull();
  });

  it("maps an installed null image to text-only set tiles", () => {
    const { container } = render(ShopBrowseScreen, {
      sets: [set(LOB, 2002)],
      error: null,
      dp: 1000,
      onbuy: noop,
      onback: noop,
      imageUrlFor: () => null,
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("legend of blue eyes white dragon");
    expect(container.textContent).toContain("2002");
  });

  it("renders a typographic tile when none exists", () => {
    const { container } = render(SetTile, {
      set: set("metal-raiders", 2002),
      imageUrl: null,
      variant: "set",
      onselect: noop,
    });
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector(
        '[data-cy="story-shop-set-fallback-metal-raiders"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-cy="story-shop-set-name-metal-raiders"]')
        ?.textContent,
    ).toBe("metal raiders");
    expect(
      container
        .querySelector('[data-cy="story-shop-set-year-metal-raiders"]')
        ?.textContent?.trim(),
    ).toBe("2002");
  });

  it("falls back when the image fails to load", async () => {
    const { container } = render(SetTile, {
      set: set("metal-raiders", 2002),
      imageUrl: "/runtime/sets/metal-raiders.jpg",
      variant: "set",
      onselect: noop,
    });
    const image = container.querySelector<HTMLImageElement>(
      '[data-cy="story-shop-set-image-metal-raiders"]',
    );
    expect(image).not.toBeNull();
    await fireEvent.error(image!);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector(
        '[data-cy="story-shop-set-fallback-metal-raiders"]',
      ),
    ).not.toBeNull();
  });

  it("latest row shows the four most recent, oldest first", () => {
    const sets = Array.from({ length: 10 }, (_, index) =>
      set(`set-${2000 + index}`, 2000 + index),
    );
    const container = browse(sets);
    const tiles = [
      ...container
        .querySelector('[data-cy="story-shop-latest-scroll"]')!
        .querySelectorAll<HTMLElement>("button"),
    ];
    expect(tiles.map((tile) => tile.dataset["cy"])).toStrictEqual([
      "story-shop-latest-set-2006",
      "story-shop-latest-set-2007",
      "story-shop-latest-set-2008",
      "story-shop-latest-set-2009",
    ]);
  });

  it("latest ignores unreleased sets and yields what exists below four", () => {
    const sets = [
      set("a", 2002),
      set("b", 2003),
      set("unreleased", 2010, false),
    ];
    expect(latestReleasedSets(sets).map((entry) => entry.id)).toStrictEqual([
      "a",
      "b",
    ]);
  });

  it("latest keeps source order between sets sharing a release year", () => {
    const sets = [set("a", 2002), set("b", 2002), set("c", 2002)];
    expect(latestReleasedSets(sets, 2).map((entry) => entry.id)).toStrictEqual([
      "b",
      "c",
    ]);
  });

  it("grid is four columns on a wide screen", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/story/shop/ShopBrowseScreen.svelte"),
      "utf8",
    );
    const wide = source.slice(source.indexOf("@media (min-width: 1280px)"));
    expect(source).toContain("@media (min-width: 1280px)");
    expect(wide.slice(0, 200)).toContain("repeat(4, minmax(0, 1fr))");
  });

  it("unreleased sets stay locked", async () => {
    const container = browse([set("spell-ruler", 2002, false)]);
    const tile = container.querySelector<HTMLButtonElement>(
      '[data-cy="story-shop-set-spell-ruler"]',
    );
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute("aria-disabled")).toBe("true");
    expect(tile!.className).toContain("set-tile--unreleased");
    await fireEvent.click(tile!);
    expect(
      container.querySelector('[data-cy="story-overlay-shop-set-title"]'),
    ).toBeNull();
  });
});
