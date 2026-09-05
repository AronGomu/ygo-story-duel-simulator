// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import HandZoomOverlay from "../../src/battle/app/components/duel-field/HandZoomOverlay.svelte";
import {
  cardCode,
  cardInstanceId,
  choiceId,
} from "../../src/battle/duel/contracts/ids.ts";
import type { CardImageLibrary } from "../../src/battle/app/images/card-image-cache.ts";
import type { InteractionChoice } from "../../src/battle/app/prompts/interaction-spec.ts";
import type { BoardCardView } from "../../src/battle/field/board-view-model.ts";

afterEach(() => {
  cleanup();
});

const CARD: BoardCardView = Object.freeze({
  id: "p0-hand-2",
  targetId: "card:p0-hand-2" as const,
  instanceId: cardInstanceId("p0-hand-2"),
  player: 0,
  owner: 0,
  zoneId: "p0:hand" as const,
  sequence: 2,
  position: "faceUpAttack" as const,
  orientation: "upright" as const,
  facing: "self" as const,
  hidden: false,
  label: "Card 2 in Your Hand",
  x: 0,
  y: 0,
  width: 72 / 1280,
  height: 104 / 720,
  counters: [],
  materials: [],
  chainLinks: [],
  image: Object.freeze({ kind: "back" as const }),
});

/* A face-up hand card: the zoom overlay resolves its art through a lease on
   the image library, exactly as every mounted card does. */
const FACE_CARD: BoardCardView = Object.freeze({
  ...CARD,
  id: "p0-hand-3",
  targetId: "card:p0-hand-3" as const,
  instanceId: cardInstanceId("p0-hand-3"),
  sequence: 3,
  label: "Card 3 in Your Hand",
  image: Object.freeze({ kind: "face" as const, code: cardCode(12_345) }),
});

const OTHER_FACE_CARD: BoardCardView = Object.freeze({
  ...FACE_CARD,
  id: "p0-hand-4",
  targetId: "card:p0-hand-4" as const,
  instanceId: cardInstanceId("p0-hand-4"),
  sequence: 4,
  label: "Card 4 in Your Hand",
  image: Object.freeze({ kind: "face" as const, code: cardCode(54_321) }),
});

const CARD_BACK_URL = "/back.webp";
const PLACEHOLDER_URL = "/placeholder.webp";

const SCALE = 1.6;
interface Anchor {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
const ANCHOR: Anchor = Object.freeze({
  left: 640,
  top: 300,
  width: 60,
  height: 90,
});
const OVERLAY_WIDTH = ANCHOR.width * SCALE;

/* The rotated phone stage: 693 wide along its *own* x axis while the viewport
   jsdom reports is 1024. The two disagreeing is the whole point — a clamp
   reading `innerWidth` would let the overlay sit 33px past the frame's right
   edge, off the board, on every portrait phone. */
const FRAME_WIDTH = 693;

function overlay(): HTMLElement {
  return document.querySelector(
    '[data-cy="hand-zoom-overlay-p0-hand-2"]',
  ) as HTMLElement;
}

const CHOICES: readonly InteractionChoice[] = [
  { id: choiceId("summon"), label: "Summon", action: "summon" },
];

const THREE_CHOICES: readonly InteractionChoice[] = [
  ...CHOICES,
  { id: choiceId("set"), label: "Set", action: "setMonster" },
  { id: choiceId("activate"), label: "Activate", action: "activate" },
];

const ACTIVATE_ONLY: readonly InteractionChoice[] = [
  { id: choiceId("activate"), label: "Activate", action: "activate" },
];

/* Nested under `props`: `anchor` is also a Svelte mount option, so a flat
   object would be read as one and the component would get no props at all. */
function renderOverlay(
  frameWidth: number,
  anchor = ANCHOR,
  choices: readonly InteractionChoice[] = [],
  overrides: {
    readonly card?: BoardCardView;
    readonly imageLibrary?: Pick<CardImageLibrary, "lease"> | null;
    readonly onzoomleave?: (related: EventTarget | null) => void;
    readonly halo?: "legal" | "selected" | null;
    readonly selectionCandidate?: boolean;
  } = {},
) {
  return render(HandZoomOverlay, {
    props: {
      card: overrides.card ?? CARD,
      anchor,
      frameWidth,
      choices,
      halo: overrides.halo ?? null,
      selectionCandidate: overrides.selectionCandidate ?? false,
      imageLibrary: overrides.imageLibrary ?? null,
      cardBackUrl: CARD_BACK_URL,
      placeholderUrl: PLACEHOLDER_URL,
      ...(overrides.onzoomleave === undefined
        ? {}
        : { onzoomleave: overrides.onzoomleave }),
    },
  });
}

/* The overlay scopes its copy of the chips, so the action buttons carry the
   component's own `card-action-chip-` value behind that scope prefix. */
function actionButtons(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-cy^="hand-zoom-overlay-card-action-chip-"]',
    ),
  ];
}

function actionList(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-cy="hand-zoom-overlay-card-action-chips-p0-hand-2"]',
  );
}

function overlayImageSource(cardId: string): string | null {
  return (
    document
      .querySelector(`[data-cy="hand-zoom-overlay-image-${cardId}"]`)
      ?.getAttribute("src") ?? null
  );
}

/* One `release` spy per leased code, so a rerender can be checked against the
   lease the previous card held rather than a shared counter. */
function fakeImageLibrary(): {
  readonly library: Pick<CardImageLibrary, "lease">;
  readonly releaseFor: (code: number) => Mock<() => void>;
} {
  const releases = new Map<number, Mock<() => void>>();
  const lease = vi.fn<(code: number) => { url: string; release: () => void }>(
    (code) => {
      let release = releases.get(code);
      if (release === undefined) {
        release = vi.fn<() => void>();
        releases.set(code, release);
      }
      return { url: `blob:test-${code}`, release };
    },
  );
  return {
    library: { lease },
    releaseFor: (code) => {
      const release = releases.get(code);
      if (release === undefined)
        throw new Error(`Code ${code} was never leased`);
      return release;
    },
  };
}

describe("HandZoomOverlay clamping", () => {
  it("clamps against the frame it was anchored in, not the viewport", () => {
    expect(globalThis.innerWidth).toBeGreaterThan(FRAME_WIDTH);
    renderOverlay(FRAME_WIDTH);

    // Centred on the anchor would be 622; the frame only allows 589.
    expect(overlay().style.left).toBe(`${FRAME_WIDTH - OVERLAY_WIDTH - 8}px`);
    expect(overlay().style.width).toBe(`${OVERLAY_WIDTH}px`);
  });

  it("centres on the anchor when the frame has room", () => {
    renderOverlay(1280);

    const centred = ANCHOR.left + ANCHOR.width / 2 - OVERLAY_WIDTH / 2;
    expect(overlay().style.left).toBe(`${centred}px`);
  });

  it("keeps an 8px gutter on the near edge", () => {
    renderOverlay(FRAME_WIDTH, { ...ANCHOR, left: 0 });

    expect(overlay().style.left).toBe("8px");
  });

  it("grows upward from the anchor's bottom edge, stopping at the top gutter", () => {
    renderOverlay(FRAME_WIDTH);
    const grown = ANCHOR.top + ANCHOR.height - ANCHOR.height * SCALE;
    expect(overlay().style.top).toBe(`${grown}px`);

    cleanup();
    renderOverlay(FRAME_WIDTH, { ...ANCHOR, top: 10 });
    expect(overlay().style.top).toBe("8px");
  });
});

describe("HandZoomOverlay pointer surface", () => {
  it("stops the chips bridge at the anchor card's top edge", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, CHOICES);

    expect(
      document.querySelector('[data-cy="hand-zoom-overlay-bridge-p0-hand-2"]'),
    ).not.toBeNull();
    /* Measured from the overlay's bottom edge, which sits on the card's: the
       bridge may cover the overlay above the card and nothing below it. */
    expect(overlay().style.getPropertyValue("--hand-zoom-bridge-bottom")).toBe(
      `${ANCHOR.height}px`,
    );
  });

  it("renders no pointer-catching part at all without chips to reach", () => {
    renderOverlay(FRAME_WIDTH);

    expect(
      document.querySelector('[data-cy^="hand-zoom-overlay-bridge-"]'),
    ).toBeNull();
  });

  /* The taller stack extends the bridge's reach upward, so the crossing the
     field reads to decide whether the union was left has to keep reporting the
     node the pointer went to (ADR-032 §5). */
  it("keeps the pointer bridge between card and actions", async () => {
    const onzoomleave = vi.fn<(related: EventTarget | null) => void>();
    renderOverlay(FRAME_WIDTH, ANCHOR, THREE_CHOICES, { onzoomleave });
    const action = actionButtons()[0];
    if (action === undefined) throw new Error("Missing action row");

    /* Built by hand rather than through `fireEvent.pointerLeave`: jsdom ships
       no `PointerEvent`, so the helper degrades to an event carrying no
       `relatedTarget` — the one field under test here. */
    await fireEvent(
      overlay(),
      new MouseEvent("pointerleave", { relatedTarget: action }),
    );

    expect(onzoomleave).toHaveBeenCalledTimes(1);
    expect(onzoomleave).toHaveBeenCalledWith(action);
  });
});

describe("HandZoomOverlay action rows", () => {
  it("stacks one action per row at the zoom width", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, THREE_CHOICES);

    const list = actionList();
    expect(list).not.toBeNull();
    /* The rows are a CSS grid keyed off this class, and jsdom loads no
       stylesheet: the class is the part of the contract a component test can
       hold, the `1fr` track itself is proved in the browser. */
    expect(list?.classList.contains("is-stacked")).toBe(true);
    const buttons = actionButtons();
    expect(buttons).toHaveLength(THREE_CHOICES.length);
    for (const button of buttons) expect(button.parentElement).toBe(list);
  });

  /* A row spans the zoomed box and its label is sized from that same width, so
     the overlay has to publish the width it computed — a percentage can carry
     the box but never the font. */
  it("publishes the zoom width the rows are sized from", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, THREE_CHOICES);

    expect(overlay().style.getPropertyValue("--hand-zoom-width")).toBe(
      `${OVERLAY_WIDTH}px`,
    );
  });

  it("renders no action list when there are no choices", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, []);

    expect(actionList()).toBeNull();
    expect(actionButtons()).toHaveLength(0);
  });

  /* Item 10: a hand monster whose only legal action is its own effect. The
     overlay draws that one chip like any other — nothing about `activate`
     makes it a special case here (ADR-067). */
  it("draws the single chip of a card whose only action is its effect", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, ACTIVATE_ONLY);

    const buttons = actionButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("data-cy")).toBe(
      "hand-zoom-overlay-card-action-chip-activate",
    );
  });
});

describe("HandZoomOverlay halo", () => {
  it("wears selected halo when card is selected", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, [], { halo: "selected" });

    expect(overlay().classList.contains("is-selected")).toBe(true);
    expect(overlay().classList.contains("is-legal")).toBe(false);
  });

  it("wears legal halo for an actionable unselected card", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, [], { halo: "legal" });

    expect(overlay().classList.contains("is-legal")).toBe(true);
    expect(overlay().classList.contains("is-selected")).toBe(false);
  });

  it("gives selected halo priority when both states are requested", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, [], { halo: "selected" });

    expect(overlay().classList.contains("is-selected")).toBe(true);
    expect(overlay().classList.contains("is-legal")).toBe(false);
  });

  it("wears no halo by default", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, []);

    expect(overlay().classList.contains("is-selected")).toBe(false);
    expect(overlay().classList.contains("is-legal")).toBe(false);
  });

  it("marks selection-family halo for dashed styling", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, [], {
      halo: "legal",
      selectionCandidate: true,
    });

    expect(overlay().classList.contains("is-selection-candidate")).toBe(true);
  });
});

describe("HandZoomOverlay art", () => {
  it("renders the leased art for a known card", () => {
    const { library } = fakeImageLibrary();

    renderOverlay(FRAME_WIDTH, ANCHOR, [], {
      card: FACE_CARD,
      imageLibrary: library,
    });

    expect(overlayImageSource(FACE_CARD.id)).toBe("blob:test-12345");
  });

  it("renders the card back for a hidden card", () => {
    const { library } = fakeImageLibrary();

    renderOverlay(FRAME_WIDTH, ANCHOR, [], { imageLibrary: library });

    expect(overlayImageSource(CARD.id)).toBe(CARD_BACK_URL);
    expect(library.lease).not.toHaveBeenCalled();
  });

  it("falls back to the placeholder when no lease exists", () => {
    renderOverlay(FRAME_WIDTH, ANCHOR, [], { card: FACE_CARD });

    expect(overlayImageSource(FACE_CARD.id)).toBe(PLACEHOLDER_URL);
  });

  it("releases the lease when the card changes", async () => {
    const { library, releaseFor } = fakeImageLibrary();
    const rendered = renderOverlay(FRAME_WIDTH, ANCHOR, [], {
      card: FACE_CARD,
      imageLibrary: library,
    });

    await rendered.rerender({ card: OTHER_FACE_CARD });

    expect(releaseFor(12_345)).toHaveBeenCalledTimes(1);
    expect(overlayImageSource(OTHER_FACE_CARD.id)).toBe("blob:test-54321");
  });

  it("releases the lease on destroy", () => {
    const { library, releaseFor } = fakeImageLibrary();
    const rendered = renderOverlay(FRAME_WIDTH, ANCHOR, [], {
      card: FACE_CARD,
      imageLibrary: library,
    });

    rendered.unmount();

    expect(releaseFor(12_345)).toHaveBeenCalledTimes(1);
  });
});
