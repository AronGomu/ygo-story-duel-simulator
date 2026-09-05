// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import HandBand from "../../src/battle/app/components/duel-field/HandBand.svelte";
import CardControl from "../../src/battle/app/components/duel-field/CardControl.svelte";
import { cardInstanceId } from "../../src/battle/duel/contracts/ids.ts";
import type { ActiveInteractionSpec } from "../../src/battle/app/prompts/interaction-spec.ts";
import type {
  BoardCardView,
  BoardTargetId,
  BoardZoneView,
} from "../../src/battle/field/board-view-model.ts";
import {
  fieldZoneAccessibleName,
  STANDARD_DUEL_FIELD_LAYOUT,
} from "../../src/battle/field/duel-field-layout.ts";
import type { FieldPlacement } from "../../src/battle/field/duel-field-geometry.ts";

const PLACEMENT: FieldPlacement = { x: 400, y: 600, width: 760, height: 80 };
const CARD_HEIGHT = 68.8;
/* Mirrors `HAND_ARC_FACTOR` in `HandBand.svelte`: the outermost card's droop
   as a fraction of the card height. */
const HAND_ARC_FACTOR = 0.12;

/* Parabolic arc sampled at the given normalised offsets from the centre. */
function expectedArc(
  offsets: readonly number[],
  outerDroop: number,
): readonly number[] {
  return offsets.map((offset) => offset * offset * outerDroop);
}

afterEach(() => {
  cleanup();
});

function zoneFor(player: 0 | 1): BoardZoneView {
  const layout = STANDARD_DUEL_FIELD_LAYOUT.find(
    (value) => value.id === `p${player}:hand`,
  );
  if (layout === undefined) throw new Error("Missing hand zone layout");
  return {
    ...layout,
    targetId: `zone:${layout.id}` as const,
    accessibleLabel: fieldZoneAccessibleName(layout),
  };
}

function handCard(
  player: 0 | 1,
  sequence: number,
  overrides: Partial<BoardCardView> = {},
): BoardCardView {
  const id = `p${player}-hand-${sequence}`;
  return Object.freeze({
    id,
    targetId: `card:${id}` as const,
    instanceId: cardInstanceId(id),
    player,
    owner: player,
    zoneId: `p${player}:hand` as const,
    sequence,
    position: "faceUpAttack" as const,
    orientation: "upright" as const,
    facing: player === 0 ? ("self" as const) : ("opponent" as const),
    hidden: false,
    label: `Card ${sequence} in Your Hand`,
    x: 0,
    y: 0,
    width: 72 / 1280,
    height: 104 / 720,
    counters: [],
    materials: [],
    chainLinks: [],
    image: Object.freeze({ kind: "back" as const }),
    ...overrides,
  });
}

function handCards(
  player: 0 | 1,
  count: number,
  overrides: Partial<BoardCardView> = {},
): readonly BoardCardView[] {
  return Array.from({ length: count }, (_, index) =>
    handCard(player, index, overrides),
  );
}

function renderBand(
  props: Partial<Parameters<typeof HandBand>[1]> & {
    readonly player?: 0 | 1;
    readonly cards: readonly BoardCardView[];
  },
) {
  const player = props.player ?? 0;
  return render(HandBand, {
    zone: zoneFor(player),
    placement: PLACEMENT,
    cardHeight: CARD_HEIGHT,
    imageLibrary: null,
    cardBackUrl: "/back.webp",
    placeholderUrl: "/placeholder.webp",
    spec: null,
    selectedTargets: new Set<BoardTargetId>(),
    activeTarget: null,
    disabled: false,
    pinnedTarget: null,
    ...props,
    player,
  });
}

function cardArticles(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".duel-field-card")];
}

describe("HandBand", () => {
  it("mounts every sorted card with no count and no page controls", () => {
    renderBand({ cards: handCards(0, 20).toReversed() });

    expect(cardArticles()).toHaveLength(20);
    expect(cardArticles().map((card) => card.dataset.cardId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `p0-hand-${index}`),
    );
    /* The cards themselves are the count: a badge repeating it was chrome on
       a band that already shows every card it holds. */
    expect(
      document.querySelector('[data-cy="field-hand-p0-count"]'),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-cy^="field-hand-p0-"][data-cy$="page-status"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="field-hand-p0-scrollbar"]'),
    ).not.toBeNull();
  });

  it("uses px placement and preserves feedback-only hand zone", () => {
    renderBand({ cards: handCards(0, 1) });
    const root = document.querySelector<HTMLElement>(
      '[data-cy="field-hand-band-p0"]',
    )!;
    expect(root.style.getPropertyValue("--field-height")).toBe("80px");
    expect(root.dataset.feedbackZoneId).toBe("p0:hand");
    expect(root.hasAttribute("data-zone-id")).toBe(false);
  });

  it("renders by display order for player 0", () => {
    /* Arrival order is the reverse of the engine order the shuffle left
       behind: the DOM must follow the eye, not the engine. */
    const cards = handCards(0, 4).map((card, index) =>
      Object.freeze({ ...card, displayOrder: 3 - index }),
    );
    renderBand({ cards });

    expect(cardArticles().map((article) => article.dataset.cardId)).toEqual([
      "p0-hand-3",
      "p0-hand-2",
      "p0-hand-1",
      "p0-hand-0",
    ]);
  });

  it("keeps the opponent hand on engine order", () => {
    /* Player 1 never receives a display order; the band must not invent one. */
    renderBand({ player: 1, cards: handCards(1, 3).toReversed() });

    expect(cardArticles().map((article) => article.dataset.cardId)).toEqual([
      "p1-hand-0",
      "p1-hand-1",
      "p1-hand-2",
    ]);
  });

  it("fans sorted cards along a parabolic arc", () => {
    const cards = handCards(0, 5).map((card, index) =>
      Object.freeze({ ...card, displayOrder: 4 - index }),
    );
    renderBand({ cards, cardHeight: 100 });

    expect(cardArticles().map((card) => card.dataset.cardId)).toEqual([
      "p0-hand-4",
      "p0-hand-3",
      "p0-hand-2",
      "p0-hand-1",
      "p0-hand-0",
    ]);
    expect(
      cardArticles().map((card) => card.style.getPropertyValue("--card-fan")),
    ).toEqual(["-6deg", "-3deg", "0deg", "3deg", "6deg"]);
    /* Fan is linear in the offset from the centre, droop is that offset
       squared against the card height: the centre card sits highest and each
       card outward of it falls further, which is what makes an arc rather
       than a row of tilted cards on one y. */
    const droops = cardArticles().map((card) =>
      Number.parseFloat(card.style.getPropertyValue("--card-droop")),
    );
    const outer = HAND_ARC_FACTOR * 100;
    expectedArc([-1, -0.5, 0, 0.5, 1], outer).forEach((expected, index) =>
      expect(droops[index]).toBeCloseTo(expected, 10),
    );
  });

  it("drops each card of a seven card hand strictly below its inner neighbour", () => {
    renderBand({ cards: handCards(0, 7), cardHeight: 100 });

    const droops = cardArticles().map((card) =>
      Number.parseFloat(card.style.getPropertyValue("--card-droop")),
    );
    expect(droops).toHaveLength(7);
    /* Strictly monotonic on both sides of the centre, and symmetric across
       it: no pair of cards shares a y until the arc reaches its apex. */
    for (let index = 0; index < 3; index += 1) {
      expect(droops[index]).toBeGreaterThan(droops[index + 1]!);
      expect(droops[6 - index]).toBeGreaterThan(droops[5 - index]!);
      expect(droops[index]).toBeCloseTo(droops[6 - index]!, 10);
    }
    expect(droops[3]).toBe(0);
    expect(droops[0]).toBeCloseTo(HAND_ARC_FACTOR * 100, 10);
  });

  /* The viewport must reserve headroom for the droop it clips, and custom
     properties only inherit downward: the value declared on the card itself
     is invisible to its scrolling ancestor, so the band root republishes it. */
  it("publishes the card height on the band root", () => {
    renderBand({ cards: handCards(0, 3), cardHeight: 68.8 });

    const root = document.querySelector<HTMLElement>(
      '[data-cy="field-hand-band-p0"]',
    )!;
    expect(root.style.getPropertyValue("--hand-card-height")).toBe("68.8px");
  });

  it("keeps a single card flat with no droop", () => {
    renderBand({ cards: handCards(0, 1) });
    const card = cardArticles()[0];
    expect(card?.style.getPropertyValue("--card-fan")).toBe("0deg");
    expect(card?.style.getPropertyValue("--card-droop")).toBe("0px");
  });

  it("keeps fan props inert for field cards", () => {
    render(CardControl, {
      card: handCard(0, 0, { zoneId: "p0:mainMonster:0" }),
      layout: "field",
      placement: { x: 10, y: 20, width: 100, height: 100 },
      imageUrl: "/card.webp",
      fanDeg: 5,
      droopPx: 3,
    });
    const card = cardArticles()[0];
    expect(card?.style.getPropertyValue("--card-fan")).toBe("");
    expect(card?.style.getPropertyValue("--card-droop")).toBe("");
  });

  it("mirrors opponent visual flow without changing DOM sequence", () => {
    renderBand({ player: 1, cards: handCards(1, 3) });

    const root = document.querySelector('[data-cy="field-hand-band-p1"]');
    expect(root?.classList.contains("is-opponent")).toBe(true);
    const ids = cardArticles().map((article) =>
      article.getAttribute("data-card-id"),
    );
    expect(ids).toEqual(["p1-hand-0", "p1-hand-1", "p1-hand-2"]);
  });

  it("negates opponent fan angles while preserving player fan angles", () => {
    renderBand({ player: 0, cards: handCards(0, 5) });
    expect(
      cardArticles().map((card) => card.style.getPropertyValue("--card-fan")),
    ).toEqual(["-6deg", "-3deg", "0deg", "3deg", "6deg"]);

    cleanup();
    renderBand({ player: 1, cards: handCards(1, 5) });
    expect(
      cardArticles().map((card) => card.style.getPropertyValue("--card-fan")),
    ).toEqual(["6deg", "3deg", "0deg", "-3deg", "-6deg"]);
  });

  it("forwards preview, activation and drag callbacks", async () => {
    const onpreview = vi.fn();
    const onactivate = vi.fn();
    const card = handCard(0, 0);
    renderBand({
      cards: [card],
      spec: {
        kind: "cardAction",
        cardChoices: new Map([[card.targetId, []]]),
        zoneChoices: new Map(),
        stackChoices: new Map(),
        key: { workerGeneration: 0, sessionGeneration: 0, promptId: "p" },
      } as unknown as ActiveInteractionSpec,
      oncardpreview: onpreview,
      oncardactivate: onactivate,
    });

    const target = document.querySelector<HTMLElement>(
      `[data-cy="field-card-target-${card.id}"]`,
    );
    if (target === null) throw new Error("Missing hand card target");
    await fireEvent.pointerDown(target, { clientX: 1, clientY: 1 });
    expect(onpreview).toHaveBeenCalledWith(card);
    await fireEvent.click(target);
    expect(onactivate).toHaveBeenCalled();
  });

  /* Item 10: the drag-to-zone gesture is one route to an activation, not the
     only one — a hand card's chips carry activate whether the menu is pinned
     or the pointer merely hovers (ADR-067). */
  it("keeps activate in a card's chips, pinned or not", async () => {
    const card = handCard(0, 0);
    const rendered = renderBand({
      cards: [card],
      spec: {
        kind: "cardAction",
        cardChoices: new Map([
          [
            card.targetId,
            [
              { id: "activate", label: "Activate", action: "activate" },
              { id: "setmonster", label: "Set", action: "setMonster" },
            ],
          ],
        ]),
        zoneChoices: new Map(),
        stackChoices: new Map(),
        key: { workerGeneration: 0, sessionGeneration: 0, promptId: "p" },
      } as unknown as ActiveInteractionSpec,
      pinnedTarget: null,
    });

    expect(
      document.querySelector('[data-cy="card-action-chip-activate"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="card-action-chip-setmonster"]'),
    ).not.toBeNull();

    await rendered.rerender({ pinnedTarget: card.targetId });

    expect(
      document.querySelector('[data-cy="card-action-chip-activate"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="card-action-chip-setmonster"]'),
    ).not.toBeNull();
  });

  it("mounts every card when the hand changes, with no count to fall behind", async () => {
    const rendered = renderBand({ cards: handCards(0, 6) });
    expect(cardArticles()).toHaveLength(6);
    await rendered.rerender({ cards: handCards(0, 20) });
    expect(cardArticles()).toHaveLength(20);
    expect(
      document.querySelector('[data-cy="field-hand-p0-count"]'),
    ).toBeNull();
  });
});
