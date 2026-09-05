// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardPreviewPanel from "../../src/shell/card-preview/CardPreviewPanel.svelte";
import type { CardPreviewView } from "../../src/battle/app/presentation/card-preview.ts";
import type { CardCode } from "../../src/battle/duel/contracts/ids.ts";
import type { CardImageLease } from "../../src/battle/app/images/card-image-cache.ts";
import { cardCode } from "../../src/battle/duel/contracts/ids.ts";

afterEach(() => cleanup());

const FISHERMAN = cardCode(97590747);
const BLUE_EYES = cardCode(89631139);

function preview(
  code = FISHERMAN,
  overrides: Partial<CardPreviewView> = {},
): CardPreviewView {
  return {
    code,
    name: "The Legendary Fisherman",
    description: "This card is unaffected by Spell effects.",
    statsLine: null,
    ...overrides,
  };
}

/** Mirrors `CardImageCache`: one object URL per code, released by reference. */
function leaseLibrary() {
  const releases = new Map<number, ReturnType<typeof vi.fn>>();
  const lease = vi.fn((code: number): CardImageLease => {
    const release = vi.fn();
    releases.set(code, release);
    return { url: `blob:card-${code}`, release };
  });
  return {
    library: { lease },
    lease,
    releaseFor: (code: number) => releases.get(code),
  };
}

describe("CardPreviewPanel", () => {
  it("panel shows the empty state", () => {
    render(CardPreviewPanel, { preview: null });

    expect(screen.getByText("Hover a card to see its details.")).toBeTruthy();
    expect(
      document.querySelector('[data-cy="card-preview-empty"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="card-preview-name"]')).toBeNull();
    expect(document.querySelector('[data-cy="card-preview-art"]')).toBeNull();
  });

  it("renders bounded body around art name and effect text", () => {
    render(CardPreviewPanel, { preview: preview() });

    const panel = document.querySelector('[data-cy="card-preview-panel"]');
    const art = document.querySelector('[data-cy="card-preview-art"]');
    const body = document.querySelector('[data-cy="card-preview-body"]');
    const name = document.querySelector('[data-cy="card-preview-name"]');
    const region = document.querySelector(
      '[data-cy="card-preview-text-region"]',
    );
    const text = document.querySelector('[data-cy="card-preview-text"]');
    expect(panel?.children).toEqual(expect.objectContaining({ length: 2 }));
    expect(panel?.children[0]).toBe(art);
    expect(panel?.children[1]).toBe(body);
    expect(body?.children[0]).toBe(name);
    expect(body?.children[1]).toBe(region);
    expect(region?.children[0]).toBe(text);
    expect(name?.textContent).toContain("The Legendary Fisherman");
    expect(text?.textContent).toContain(
      "This card is unaffected by Spell effects.",
    );
    expect(text?.getAttribute("tabindex")).toBe("0");
    expect(text?.getAttribute("aria-label")).toBe("Card effect text");
    expect(
      region?.querySelector('[data-cy="card-preview-text-scrollbar"]'),
    ).not.toBeNull();
    expect(
      region?.querySelector('[data-cy="card-preview-text-scrollbar-thumb"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="card-preview-empty"]')).toBeNull();
  });

  it("panel leases the image", () => {
    const { library, lease } = leaseLibrary();
    render(CardPreviewPanel, { preview: preview(), imageLibrary: library });

    expect(lease).toHaveBeenCalledTimes(1);
    expect(lease).toHaveBeenCalledWith(FISHERMAN);
    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe(`blob:card-${FISHERMAN}`);
  });

  it("panel releases the lease on change", async () => {
    const { library, lease, releaseFor } = leaseLibrary();
    const rendered = render(CardPreviewPanel, {
      preview: preview(),
      imageLibrary: library,
    });

    await rendered.rerender({
      preview: preview(BLUE_EYES, { name: "Blue-Eyes White Dragon" }),
    });

    expect(lease).toHaveBeenCalledTimes(2);
    expect(releaseFor(FISHERMAN)).toHaveBeenCalledTimes(1);
    expect(releaseFor(BLUE_EYES)).not.toHaveBeenCalled();
    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe(`blob:card-${BLUE_EYES}`);
  });

  it("panel releases the lease on destroy", () => {
    const { library, releaseFor } = leaseLibrary();
    render(CardPreviewPanel, { preview: preview(), imageLibrary: library });

    cleanup();

    expect(releaseFor(FISHERMAN)).toHaveBeenCalledTimes(1);
  });

  /* cardCode() rejects 0, so the panel's `code > 0` guard is only reachable
     with a cast — it is the defensive branch that keeps a codeless preview
     on the placeholder instead of leasing an image for it. */
  it("panel does not lease an image for a zero code", () => {
    const { library, lease } = leaseLibrary();
    render(CardPreviewPanel, {
      preview: {
        code: 0 as CardCode,
        name: "Face-down card",
        description: "No information is available for this card.",
        statsLine: null,
      },
      imageLibrary: library,
      placeholderUrl: "/placeholder.webp",
    });

    expect(lease).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cy="card-preview-image"]')).toBeNull();
    const placeholder = screen.getByRole("img", {
      name: "Card image unavailable for Face-down card",
    });
    expect(placeholder.dataset.cy).toBe("card-preview-image-placeholder");
    expect(
      placeholder
        .querySelector('[data-cy="card-preview-placeholder-image"]')
        ?.getAttribute("src"),
    ).toBe("/placeholder.webp");
  });

  it("static image url renders when no library is provided", () => {
    render(CardPreviewPanel, {
      preview: preview(),
      imageLibrary: null,
      staticImageUrl: "/cards/x.jpg",
    });

    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe("/cards/x.jpg");
  });

  it("leased image wins over the static url", () => {
    const { library } = leaseLibrary();
    render(CardPreviewPanel, {
      preview: preview(),
      imageLibrary: library,
      staticImageUrl: "/cards/x.jpg",
    });

    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe(`blob:card-${FISHERMAN}`);
  });

  it("renders a leased placeholder through the common semantic branch", () => {
    const release = vi.fn();
    render(CardPreviewPanel, {
      preview: preview(),
      imageLibrary: {
        lease: () => ({ url: "/placeholder.webp", release }),
      },
      placeholderUrl: "/placeholder.webp",
    });

    expect(document.querySelector('[data-cy="card-preview-image"]')).toBeNull();
    const placeholder = screen.getByRole("img", {
      name: "Card image unavailable for The Legendary Fisherman",
    });
    expect(placeholder.dataset.cy).toBe("card-preview-image-placeholder");
    expect(
      placeholder
        .querySelector('[data-cy="card-preview-placeholder-image"]')
        ?.getAttribute("src"),
    ).toBe("/placeholder.webp");
  });

  it("uses one accessible placeholder for absent and failed art then recovers", async () => {
    const rendered = render(CardPreviewPanel, {
      preview: preview(),
      staticImageUrl: null,
    });

    expect(
      screen.getByRole("img", {
        name: "Card image unavailable for The Legendary Fisherman",
      }).dataset.cy,
    ).toBe("card-preview-image-placeholder");

    await rendered.rerender({
      preview: preview(),
      staticImageUrl: "/cards/fisherman.jpg",
    });
    const failedImage = document.querySelector<HTMLImageElement>(
      '[data-cy="card-preview-image"]',
    )!;
    await fireEvent.error(failedImage);

    expect(document.querySelector('[data-cy="card-preview-image"]')).toBeNull();
    expect(
      screen.getByRole("img", {
        name: "Card image unavailable for The Legendary Fisherman",
      }).dataset.cy,
    ).toBe("card-preview-image-placeholder");

    await rendered.rerender({
      preview: preview(BLUE_EYES, { name: "Blue-Eyes White Dragon" }),
      staticImageUrl: "/cards/blue-eyes.jpg",
    });

    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe("/cards/blue-eyes.jpg");
    expect(
      document.querySelector('[data-cy="card-preview-image-placeholder"]'),
    ).toBeNull();
  });

  it("ignores an error from the image replaced by a newer source", async () => {
    const rendered = render(CardPreviewPanel, {
      preview: preview(),
      staticImageUrl: "/cards/fisherman.jpg",
    });
    const staleImage = document.querySelector<HTMLImageElement>(
      '[data-cy="card-preview-image"]',
    )!;

    await rendered.rerender({
      preview: preview(BLUE_EYES, { name: "Blue-Eyes White Dragon" }),
      staticImageUrl: "/cards/blue-eyes.jpg",
    });
    await fireEvent.error(staleImage);

    expect(
      document
        .querySelector('[data-cy="card-preview-image"]')
        ?.getAttribute("src"),
    ).toBe("/cards/blue-eyes.jpg");
    expect(
      document.querySelector('[data-cy="card-preview-image-placeholder"]'),
    ).toBeNull();
  });

  it("renders the stats row between name and effect text", () => {
    render(CardPreviewPanel, {
      preview: preview(FISHERMAN, {
        statsLine: "DARK · Spellcaster · Level 4 · ATK 1800 / DEF 1200",
      }),
    });

    const stats = document.querySelector('[data-cy="card-preview-stats"]');
    const name = document.querySelector('[data-cy="card-preview-name"]');
    const region = document.querySelector(
      '[data-cy="card-preview-text-region"]',
    );
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toBe(
      "DARK · Spellcaster · Level 4 · ATK 1800 / DEF 1200",
    );
    const body = document.querySelector('[data-cy="card-preview-body"]');
    expect(body?.children[0]).toBe(name);
    expect(body?.children[1]).toBe(stats);
    expect(body?.children[2]).toBe(region);
  });

  it("omits the stats row without stats", () => {
    render(CardPreviewPanel, { preview: preview() });

    expect(document.querySelector('[data-cy="card-preview-stats"]')).toBeNull();
  });

  it("keeps only the real text scroller keyboard focusable", () => {
    const { library } = leaseLibrary();
    render(CardPreviewPanel, { preview: preview(), imageLibrary: library });

    const panel = document.querySelector('[data-cy="card-preview-panel"]');
    const text = document.querySelector('[data-cy="card-preview-text"]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll("button")).toHaveLength(0);
    expect(panel?.querySelectorAll("a")).toHaveLength(0);
    expect(panel?.querySelectorAll("[tabindex]")).toHaveLength(1);
    expect(panel?.querySelector("[tabindex]")).toBe(text);
    expect(panel?.hasAttribute("tabindex")).toBe(false);
    expect(
      document
        .querySelector('[data-cy="card-preview-text-scrollbar"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
