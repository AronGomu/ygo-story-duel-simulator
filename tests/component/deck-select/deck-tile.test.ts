// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckTile from "../../../src/deck-select/DeckTile.svelte";
import { tile } from "./tile-builder.ts";

afterEach(() => cleanup());

/** The rendered element carrying `data-cy`, or `null` — the tile is queried the
    way every other component test queries this project's element contract. */
function find(value: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-cy="${value}"]`);
}

function cy(value: string): HTMLElement {
  const element = find(value);
  if (element === null) throw new Error(`No element with data-cy "${value}"`);
  return element;
}

describe("DeckTile", () => {
  it("renders the name and one concise tag line without old tile copy", () => {
    render(DeckTile, { tile: tile({ meta: "Local deck" }) });

    expect(cy("deck-tile-name-k1").textContent).toBe("Prototype Control");
    expect(cy("deck-tile-tags-k1").textContent).toBe("Local deck");
    expect(find("deck-tile-counts-k1")).toBeNull();
    expect(find("deck-tile-meta-k1")).toBeNull();
    expect(find("deck-tile-badge-default-k1")).toBeNull();
    expect(find("deck-tile-check-k1")).toBeNull();
  });

  it("matches the square cropped-illustration ratio", () => {
    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(/aspect-ratio:\s*1 \/ 1/);
  });

  it("dims illustration art without dimming tile content", () => {
    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(/\.art\s*\{[^}]*opacity:\s*0\.8/s);
  });

  it("uses 1rem title type", () => {
    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(/\.name\s*\{[^}]*font-size:\s*1rem/s);
  });

  it("backs text with localized translucent surfaces", () => {
    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(
      /\.text-backdrop\s*\{[^}]*background:\s*color-mix\([^;]*transparent\)/s,
    );
    expect(source).toContain('class="name text-backdrop"');
    expect(source).toContain('class="tag-line text-backdrop"');
  });

  it("places title above one bottom tag line without an artwork fade", () => {
    render(DeckTile, { tile: tile() });
    expect(find("deck-tile-fade-k1")).toBeNull();

    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(/\.name\s*\{[^}]*align-self:\s*start/s);
    expect(source).toMatch(/\.tag-line\s*\{[^}]*align-self:\s*end/s);
    expect(source).toMatch(/text-shadow:/);
  });

  it("falls back to full card when cropped art is unavailable", async () => {
    render(DeckTile, {
      tile: tile({
        coverImageUrl: "/runtime/images-cropped/89631139.jpg",
      }),
    });
    const image = cy("deck-tile-art-k1") as HTMLImageElement;
    expect(image.src).toContain("/runtime/images-cropped/89631139.jpg");

    await fireEvent.error(image);
    expect((cy("deck-tile-art-k1") as HTMLImageElement).src).toContain(
      "/runtime/images/89631139.jpg",
    );
  });

  it("press fires onpress, dblclick fires ondblpress", async () => {
    const onpress = vi.fn();
    const ondblpress = vi.fn();
    render(DeckTile, { tile: tile(), onpress, ondblpress });
    const user = userEvent.setup();

    await user.click(cy("deck-tile-press-k1"));
    expect(onpress).toHaveBeenCalledTimes(1);
    expect(ondblpress).not.toHaveBeenCalled();

    await user.dblClick(cy("deck-tile-press-k1"));
    expect(ondblpress).toHaveBeenCalledTimes(1);
  });

  it("name activation opens rename without selecting or opening tile", async () => {
    const onrename = vi.fn();
    const onpress = vi.fn();
    const ondblpress = vi.fn();
    render(DeckTile, { tile: tile(), onrename, onpress, ondblpress });
    const name = cy("deck-tile-name-k1") as HTMLButtonElement;

    await userEvent.setup().click(name);
    expect(onrename).toHaveBeenCalledTimes(1);
    expect(onpress).not.toHaveBeenCalled();
    expect(ondblpress).not.toHaveBeenCalled();

    await userEvent.setup().keyboard("{Enter}");
    expect(onrename).toHaveBeenCalledTimes(2);
  });

  it("keeps name noninteractive when rename is unavailable", () => {
    render(DeckTile, { tile: tile() });

    expect(cy("deck-tile-name-k1").tagName).toBe("SPAN");
  });

  it("renders no favourite control", () => {
    render(DeckTile, { tile: tile() });

    expect(find("deck-tile-fav-k1")).toBeNull();
    expect(document.querySelector('[aria-label^="Favourite "]')).toBeNull();
  });

  it("keeps the tag line clear of the bottom-right kebab", () => {
    const source = readFileSync("src/deck-select/DeckTile.svelte", "utf8");
    expect(source).toMatch(
      /--deck-tile-tag-width:\s*calc\(\s*100%\s*-\s*var\(--corner-size\)\s*-\s*var\(--space-2\)\s*-\s*var\(--space-2\)\s*-\s*var\(--space-2\)\s*\)/s,
    );
    expect(source).toMatch(
      /\.tag-line\s*\{[^}]*width:\s*var\(--deck-tile-tag-width\)/s,
    );
  });

  it("kebab fires onmenu with its element, no tile press", async () => {
    const onmenu = vi.fn();
    const onpress = vi.fn();
    render(DeckTile, { tile: tile(), onmenu, onpress });

    const kebab = cy("deck-tile-menu-k1");
    expect(kebab.getAttribute("aria-label")).toBe(
      "Actions for Prototype Control",
    );
    await userEvent.setup().click(kebab);

    expect(onmenu).toHaveBeenCalledTimes(1);
    expect(onmenu.mock.calls[0]?.[0]).toBe(kebab);
    expect(onpress).not.toHaveBeenCalled();
  });

  it("collapses availability tags into one line", () => {
    render(DeckTile, {
      tile: tile({ bundled: true, lockedBy: "Vault Warden", meta: "Bundled" }),
      yours: true,
      canSetDefault: false,
    });

    expect(cy("deck-tile-tags-k1").textContent).toBe(
      "Bundled · Locked: Vault Warden · Yours",
    );
    expect(find("deck-tile-badges-k1")).toBeNull();
  });

  it("illegal tile is disabled and badged", () => {
    render(DeckTile, {
      tile: tile({
        legal: false,
        blockReason: "Main Deck needs 5 more card(s).",
        meta: "Main Deck needs 5 more card(s).",
      }),
    });

    expect((cy("deck-tile-press-k1") as HTMLButtonElement).disabled).toBe(true);
    expect(cy("deck-tile-tags-k1").textContent).toBe(
      "Illegal · Main Deck needs 5 more card(s).",
    );
  });

  it("halo classes applied", () => {
    for (const halo of ["you", "opponent", "focus"] as const) {
      const { unmount } = render(DeckTile, { tile: tile(), halo });
      const root = cy("deck-tile-k1");
      expect(root.classList.contains(`halo-${halo}`)).toBe(true);
      unmount();
    }

    render(DeckTile, { tile: tile(), halo: null });
    const root = cy("deck-tile-k1");
    expect(
      ["halo-you", "halo-opponent", "halo-focus"].filter((name) =>
        root.classList.contains(name),
      ),
    ).toEqual([]);
  });

  it("sets a non-default capable deck from an outlined star", async () => {
    const onsetdefault = vi.fn();
    render(DeckTile, { tile: tile(), onsetdefault });

    const star = cy("deck-tile-default-star-k1") as HTMLButtonElement;
    expect(star.disabled).toBe(false);
    expect(star.getAttribute("aria-label")).toBe(
      "Set Prototype Control as default deck",
    );
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.classList).toContain("outline");

    await userEvent.setup().click(star);
    expect(onsetdefault).toHaveBeenCalledOnce();
  });

  it("shows the current default as a filled disabled gold star", () => {
    render(DeckTile, { tile: tile({ isDefault: true }) });

    const star = cy("deck-tile-default-star-k1") as HTMLButtonElement;
    expect(star.disabled).toBe(true);
    expect(star.getAttribute("aria-label")).toBe("Default deck");
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.classList).toContain("filled");
    expect(find("deck-tile-badge-default-k1")).toBeNull();
    expect(find("deck-tile-check-k1")).toBeNull();
  });

  it("renders no star when the host denies default capability", () => {
    render(DeckTile, { tile: tile({ bundled: true }), canSetDefault: false });

    expect(find("deck-tile-default-star-k1")).toBeNull();
  });

  it("cyKey renames every value so one deck can render twice", () => {
    render(DeckTile, { tile: tile(), cyKey: "yours-k1" });

    expect(find("deck-tile-k1")).toBeNull();
    expect(find("deck-tile-yours-k1")).not.toBeNull();
    expect(cy("deck-tile-name-yours-k1").textContent).toBe("Prototype Control");
    expect(
      cy("deck-tile-default-star-yours-k1").getAttribute("aria-label"),
    ).toBe("Set Prototype Control as default deck");
    expect(cy("deck-tile-menu-yours-k1").getAttribute("aria-label")).toBe(
      "Actions for Prototype Control",
    );
  });
});
