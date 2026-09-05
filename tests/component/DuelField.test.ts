// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DuelField from "../../src/battle/app/components/DuelField.svelte";
import DuelFieldErrorBoundary from "../../src/battle/app/components/duel-field/DuelFieldErrorBoundary.svelte";
import FieldBoard from "../../src/battle/app/components/duel-field/FieldBoard.svelte";
import CardTray from "../../src/battle/app/components/duel-field/CardTray.svelte";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
  PromptKind,
} from "../../src/battle/duel/contracts/player-prompt.ts";
import type {
  PlayerIndex,
  PublicCard,
  PublicDuelState,
} from "../../src/battle/duel/contracts/public-duel-state.ts";
import {
  mapSnapshotToBoard,
  type BoardViewModel,
} from "../../src/battle/field/board-view-model.ts";
import {
  createFieldRenderLayout,
  perspectiveVirtualHeight,
} from "../../src/battle/field/duel-field-geometry.ts";
import {
  FIELD_CAMERA_PX,
  FIELD_TILT_DEG,
} from "../../src/battle/field/perspective.ts";
import { zoneListsForBoard } from "../../src/battle/field/zone-list.ts";
import { offFieldTargetEntries } from "../../src/battle/field/off-field-target-list.ts";
import {
  createInteractionSession,
  reduceInteractionSession,
  type InteractionSession,
  type InteractionSessionAction,
} from "../../src/battle/app/prompts/interaction-session.ts";
import {
  createInitialDuelViewState,
  reduceDuelViewState,
} from "../../src/battle/app/stores/duel-store.ts";
import {
  mapPromptToInteractionSpec,
  type ActiveInteractionSpec,
} from "../../src/battle/app/prompts/interaction-spec.ts";
import { promptSurface } from "../../src/battle/app/prompts/prompt-surface.ts";
import {
  BOARD_CARD_TEXTS,
  BOARD_VIEW_MODEL_FIXTURES,
  LINK_FREE_STATE,
  STACK_ART_STATE,
  TWO_CARD_GRAVEYARD_STATE,
} from "../fixtures/board-view-model.ts";
import {
  DUEL_FIELD_PUBLIC_STATE_MATRIX,
  DUEL_FIELD_PUBLIC_STATES,
} from "../fixtures/duel-field-public-events.ts";
import {
  concealedStateCard,
  publicStateCard,
  PUBLIC_STATE_CARD_TEXTS,
  SIXTY_PUBLIC_CARDS,
} from "../fixtures/board-public-states.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
});

function board(state: keyof typeof BOARD_VIEW_MODEL_FIXTURES) {
  const result = mapSnapshotToBoard(
    BOARD_VIEW_MODEL_FIXTURES[state],
    BOARD_CARD_TEXTS,
  );
  if (!result.ok)
    throw new Error(`Fixture mapping failed: ${result.error.type}`);
  return result.value;
}

/** The live regions the field's own feedback owns. The Full Control hold hint
 * is a permanently mounted `role="status"` inside the field — it has to exist
 * before Ctrl goes down for the hold to be announced — so it is not evidence
 * of a feedback badge and is filtered out of these counts. */
function feedbackStatuses(): HTMLElement[] {
  return screen
    .queryAllByRole("status")
    .filter((node) => node.dataset.cy !== "full-control-hold-hint");
}

/** A board with an oversized player and/or opponent hand, for T8 pagination
 * and cross-page keyboard-nav tests. Every other zone stays empty unless a
 * mounted monster is asked for (R1/F2 needs a live on-field decision while the
 * hand is paginated). */
function bigHandBoard(
  playerHandCount: number,
  opponentHandCount: number,
  playerMonster = false,
) {
  const playerHand: PublicCard[] = Array.from(
    { length: playerHandCount },
    (_, sequence) => bigHandStubCard(`big-p0-${sequence}`, 0, sequence),
  );
  const state: PublicDuelState = {
    snapshotId: snapshotId("b".repeat(64)),
    revision: 1,
    turn: 1,
    turnPlayer: 0,
    phase: "main1",
    layout: { extraMonsterZones: true },
    players: [
      {
        player: 0,
        lifePoints: 8000,
        deckCount: 35,
        deck: [],
        extraDeckCount: 0,
        handCount: playerHandCount,
        hand: playerHand,
        extraDeck: [],
        monsters: playerMonster
          ? [publicStateCard("big-hand-monster", 97590747, 0, "monster", 0)]
          : [],
        spellsAndTraps: [],
        graveyard: [],
        banished: [],
      },
      {
        player: 1,
        lifePoints: 8000,
        deckCount: 35,
        deck: [],
        extraDeckCount: 0,
        handCount: opponentHandCount,
        hand: [],
        extraDeck: [],
        monsters: [],
        spellsAndTraps: [],
        graveyard: [],
        banished: [],
      },
    ],
    chain: [],
  };
  const result = mapSnapshotToBoard(state, BOARD_CARD_TEXTS);
  if (!result.ok)
    throw new Error(`bigHandBoard mapping failed: ${result.error.type}`);
  return result.value;
}

function bigHandStubCard(
  id: string,
  controller: PlayerIndex,
  sequence: number,
): PublicCard {
  return {
    instanceId: cardInstanceId(id),
    code: cardCode(97590747),
    owner: controller,
    controller,
    location: "hand",
    sequence,
    position: "faceDownDefense",
    faceUp: false,
    counters: [],
    overlayMaterials: [],
  };
}

const CONTEXT = { workerGeneration: 1, sessionGeneration: 2 } as const;

/** STACK_ART_STATE plus one mounted monster, so a selection prompt can keep
    every target on the field while the piles stay browsable. */
const WINDOW_STATE: PublicDuelState = {
  ...STACK_ART_STATE,
  players: [
    {
      ...STACK_ART_STATE.players[0],
      monsters: [publicStateCard("window-monster", 97590747, 0, "monster", 0)],
    },
    STACK_ART_STATE.players[1],
  ],
};

function promptChoice(
  id: string,
  label: string,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return { id: choiceId(id), label, action: "select", ...overrides };
}

function fieldPrompt(
  kind: PromptKind,
  choices: readonly PromptChoice[],
  overrides: Partial<PlayerPrompt> = {},
): PlayerPrompt {
  return {
    id: promptId(`${kind}-field-component`),
    kind,
    player: 0,
    title: `Test ${kind}`,
    choices,
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
    ...overrides,
  };
}

function mountedChoice(
  id: string,
  label: string,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return promptChoice(id, label, {
    card: {
      instanceId: cardInstanceId(`prompt-${id}`),
      controller: 0,
      location: "monster",
      sequence: 0,
      position: "faceUpAttack",
    },
    ...overrides,
  } as Partial<PromptChoice>);
}

function overlayChoice(
  id: string,
  label: string,
  sequence: number,
): PromptChoice {
  return promptChoice(id, label, {
    card: {
      instanceId: cardInstanceId(`overlay-${id}`),
      controller: 0,
      location: "monster",
      sequence,
      overlay: true,
      code: cardCode(sequence === 0 ? 97590747 : 89631139),
    },
  });
}

function activeSpec(value: PlayerPrompt): ActiveInteractionSpec {
  const snapshot = BOARD_VIEW_MODEL_FIXTURES["ST-05"];
  const valueBoard = board("ST-05");
  const spec = mapPromptToInteractionSpec(value, snapshot, valueBoard, CONTEXT);
  if (spec.kind === "inactive") throw new Error("Expected active field spec");
  return spec;
}

function renderInteractive(value: PlayerPrompt) {
  const valueBoard = board("ST-05");
  const spec = activeSpec(value);
  let session: InteractionSession = createInteractionSession(spec);
  const commands: string[][] = [];
  const dispatch = vi.fn(async (action: InteractionSessionAction) => {
    const reduction = reduceInteractionSession(session, spec, action);
    const changed = reduction.session !== session;
    session = reduction.session;
    if (reduction.command !== null)
      commands.push([...reduction.command.choiceIds]);
    await rendered.rerender({ session });
    return reduction.command !== null || changed;
  });
  const rendered = render(DuelField, {
    board: valueBoard,
    prompt: value,
    spec,
    session,
    pending: false,
    oninteraction: dispatch,
  });
  return { rendered, spec, dispatch, commands, getSession: () => session };
}

describe("DuelField", () => {
  it("threads display flags without removing semantic field content", () => {
    render(DuelField, {
      board: board("ST-08"),
      showZoneOutlines: false,
      showZoneCounts: false,
      showCardShadows: false,
      showZoneLabels: false,
    });
    const value = document.querySelector('[data-cy="duel-field-board"]');
    expect(value?.getAttribute("data-zone-outlines")).toBe("false");
    expect(value?.getAttribute("data-zone-counts")).toBe("false");
    expect(value?.getAttribute("data-card-shadows")).toBe("false");
    expect(value?.getAttribute("data-zone-labels")).toBe("false");
    expect(value?.querySelectorAll("[data-zone-id]").length).toBeGreaterThan(0);
    expect(value?.querySelector(".duel-field-stack__count")).not.toBeNull();
  });

  it("keeps zone accessible names when display labels are hidden", () => {
    render(DuelField, { board: board("ST-01"), showZoneLabels: false });
    const zone = screen.getByRole("group", { name: "Your Monster Zone 1" });
    expect(zone.querySelector(".duel-field-zone__label")).not.toBeNull();
    expect(zone.getAttribute("aria-label")).toBe("Your Monster Zone 1");
  });

  it("renders square px zones with concentric slots and aligned field occupants", () => {
    render(DuelField, { board: board("ST-04") });

    const zone = document.querySelector<HTMLElement>(
      '[data-zone-id="p0:mainMonster:1"]',
    );
    const card = document.querySelector<HTMLElement>(
      '[data-card-zone-id="p0:mainMonster:1"]',
    );
    if (zone === null || card === null)
      throw new Error("Missing occupied zone");
    expect(zone.style.getPropertyValue("--field-x")).toMatch(/px$/);
    expect(zone.style.getPropertyValue("--field-width")).toBe(
      zone.style.getPropertyValue("--field-height"),
    );
    expect(
      zone.querySelector('[data-cy="field-zone-slot-p0:mainMonster:1"]'),
    ).not.toBeNull();
    expect(card.style.getPropertyValue("--field-x")).toBe(
      zone.style.getPropertyValue("--field-x"),
    );
    expect(card.classList.contains("is-defense")).toBe(true);
    expect(card.querySelector(".duel-field-card__art")).not.toBeNull();
  });

  it("uses finite fallback px geometry before boundary measurement", () => {
    render(DuelField, { board: board("ST-01") });
    const field = document.querySelector<HTMLElement>('[data-cy="duel-field"]');
    expect(field?.style.width).toMatch(/px$/);
    expect(field?.style.height).toMatch(/px$/);
    expect(Number.parseFloat(field?.style.width ?? "NaN")).toBeGreaterThan(0);
  });

  it("keeps the measured board box while the virtual plane fills upward", async () => {
    let width = 900;
    let height = 735;
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    const boundary = document.createElement("div");
    Object.defineProperties(boundary, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    });

    render(DuelField, {
      board: board("ST-04"),
      layoutBoundaryElement: boundary,
    });
    await tick();

    const field = document.querySelector<HTMLElement>('[data-cy="duel-field"]');
    const plane = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-plane"]',
    );
    const content = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-content"]',
    );
    expect(field?.style.width).toBe("900px");
    expect(field?.style.height).toBe("735px");
    const renderedPlaneHeight = Number.parseFloat(plane?.style.height ?? "NaN");
    expect(renderedPlaneHeight).toBeGreaterThan(735);
    expect(Number.parseFloat(content?.style.height ?? "NaN")).toBeGreaterThan(
      735,
    );

    width = 600;
    height = 900;
    callbacks[0]?.([], {} as ResizeObserver);
    await tick();

    const narrowPlaneHeight = perspectiveVirtualHeight(
      height,
      FIELD_TILT_DEG,
      FIELD_CAMERA_PX,
    );
    const narrowLayout = createFieldRenderLayout(
      true,
      width,
      narrowPlaneHeight,
    );
    const hand = document.querySelector<HTMLElement>(
      '[data-cy="field-hand-band-p0"]',
    );
    const handY = Number.parseFloat(
      hand?.style.getPropertyValue("--field-y") ?? "NaN",
    );
    const handHeight = Number.parseFloat(
      hand?.style.getPropertyValue("--field-height") ?? "NaN",
    );
    expect(narrowLayout.geometry.height).toBeLessThan(narrowPlaneHeight);
    expect(Number.parseFloat(content?.style.height ?? "NaN")).toBeCloseTo(
      narrowLayout.geometry.height,
      5,
    );
    expect(handY + handHeight / 2).toBeCloseTo(
      narrowLayout.geometry.height - narrowLayout.geometry.margin,
      5,
    );
  });

  it("updates all placement owners on boundary/profile resize and disconnects", async () => {
    let width = 1280;
    let height = 720;
    const observers: Array<{
      readonly callback: ResizeObserverCallback;
      readonly observe: ReturnType<typeof vi.fn>;
      readonly disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly observe = vi.fn();
        readonly disconnect = vi.fn();
        readonly unobserve = vi.fn();

        constructor(callback: ResizeObserverCallback) {
          observers.push({
            callback,
            observe: this.observe,
            disconnect: this.disconnect,
          });
        }
      },
    );
    const boundary = document.createElement("div");
    Object.defineProperties(boundary, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    });
    const emzBoard = board("ST-04");
    const rendered = render(DuelField, {
      board: emzBoard,
      layoutBoundaryElement: boundary,
    });
    await tick();
    const boundaryObserver = observers.find(({ observe }) =>
      observe.mock.calls.some(([element]) => element === boundary),
    );
    expect(boundaryObserver).toBeDefined();

    const placementSignature = (selector: string): string => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null)
        throw new Error(`Missing placement owner ${selector}`);
      return ["--field-x", "--field-y", "--field-width", "--field-height"]
        .map((property) => element.style.getPropertyValue(property))
        .join("|");
    };
    const selectors = [
      '[data-zone-id="p0:mainMonster:1"]',
      '[data-card-zone-id="p0:mainMonster:1"]',
      '[data-cy="field-stack-p0:deck"]',
      '[data-cy="field-hand-band-p0"]',
    ];
    const initial = selectors.map(placementSignature);
    const initialFieldWidth = document.querySelector<HTMLElement>(
      '[data-cy="duel-field"]',
    )?.style.width;

    width = 900;
    height = 600;
    boundaryObserver?.callback([], {} as ResizeObserver);
    await tick();
    const resized = selectors.map(placementSignature);
    expect(
      document.querySelector<HTMLElement>('[data-cy="duel-field"]')?.style
        .width,
    ).not.toBe(initialFieldWidth);
    resized.forEach((signature, index) =>
      expect(signature).not.toBe(initial[index]),
    );

    const noEmzBoard = {
      ...emzBoard,
      zones: emzBoard.zones.filter(({ player }) => player !== "shared"),
    };
    await rendered.rerender({ board: noEmzBoard });
    await tick();
    const profiled = selectors.map(placementSignature);
    profiled.forEach((signature, index) =>
      expect(signature).not.toBe(resized[index]),
    );

    rendered.unmount();
    expect(boundaryObserver?.disconnect).toHaveBeenCalledOnce();
  });

  it("paints owner-neutral labels but announces ownership", () => {
    render(DuelField, { board: board("ST-01") });

    expect(
      document.querySelector('[data-cy="zone-control-label-p0:mainMonster:0"]')
        ?.textContent,
    ).toBe("Monster Zone 1");
    expect(
      screen.getByRole("group", { name: "Your Monster Zone 1" }),
    ).toBeTruthy();
  });

  it("keeps stack ownership in accessible names", () => {
    render(DuelField, { board: board("ST-01") });

    expect(screen.getByRole("button", { name: /^Your Deck, / })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Opponent Deck, / }),
    ).toBeTruthy();
  });

  it("DF-16 validates ST-01 public fixture through parse/store/component seam", () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    const view = reduceDuelViewState(createInitialDuelViewState(CONTEXT), {
      context: CONTEXT,
      event: value.event,
    });
    expect(view.snapshot).toBe(value.event.state);
    render(DuelField, { board: value.board });

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(field.querySelectorAll("[data-zone-id]")).toHaveLength(32);
    expect(value.artifactPath).toBe("test-results/df-16-ST-01.json");
    expect(document.body.textContent).not.toContain("Dark Magician");
    expect(document.body.innerHTML).not.toContain("46986414");
  });

  it("omits both shared EMZs for a Link-free board", () => {
    const result = mapSnapshotToBoard(LINK_FREE_STATE, BOARD_CARD_TEXTS);
    if (!result.ok) throw new Error("Link-free mapping failed");
    render(DuelField, { board: result.value });

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(
      field.querySelectorAll('[data-zone-id^="shared:extraMonster"]'),
    ).toHaveLength(0);
    expect(field.querySelectorAll("[data-zone-id]")).toHaveLength(30);
    expect(
      within(field).queryAllByRole("group", {
        name: /^Shared Extra Monster Zone/,
      }),
    ).toEqual([]);
  });

  it("keeps both shared EMZs for a Link board", () => {
    render(DuelField, { board: board("ST-01") });

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(
      field.querySelectorAll('[data-zone-id^="shared:extraMonster"]'),
    ).toHaveLength(2);
  });

  it("leaves status and phase UI outside the duel field", () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    render(DuelField, { board: value.board });

    expect(document.querySelector('[data-cy="field-status-pills"]')).toBeNull();
    expect(document.querySelector('[data-cy="prio-pill"]')).toBeNull();
    expect(document.querySelector('[data-cy="phase-pill"]')).toBeNull();
    expect(document.querySelector('[data-cy="phase-bar"]')).toBeNull();
  });

  it("duel field no longer renders the action/phase badge at the opponent hand position (item 26)", () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    render(DuelField, { board: value.board });

    expect(
      document.querySelector('[data-cy="duel-field-feedback"]'),
    ).toBeNull();
    expect(document.querySelector(".duel-field-feedback")).toBeNull();
  });

  it.each(DUEL_FIELD_PUBLIC_STATE_MATRIX)(
    "DF-16 validates %s semantic/layout acceptance assertions",
    ({ id, board: value, assertions }) => {
      render(DuelField, { board: value });
      const field = screen.getByRole("region", { name: "Duel field" });
      expect(field.querySelectorAll("[data-zone-id]")).toHaveLength(32);
      expect(value.nav.size).toBeGreaterThan(0);
      expect(assertions.length).toBeGreaterThan(0);

      switch (id) {
        case "ST-01":
        case "ST-12":
          expect(
            within(field).getAllByRole("article", {
              name: "Hidden opponent hand card",
            }).length,
          ).toBeGreaterThan(0);
          expect(document.body.textContent).not.toContain("Dark Magician");
          break;
        case "ST-03":
          expect(
            within(field).getAllByRole("group", {
              name: /^Shared Extra Monster Zone/,
            }),
          ).toHaveLength(2);
          break;
        case "ST-04":
        case "ST-11":
          expect(
            within(field)
              .getByRole("article", { name: /face-up defense/ })
              .getAttribute("data-orientation"),
          ).toBe("sideways");
          break;
        case "ST-07":
        case "ST-13":
          expect(
            value.cards.some((card) =>
              card.counters.some(
                (counter) =>
                  counter.name === "Spell Counter" && counter.count === 3,
              ),
            ),
          ).toBe(true);
          expect(document.body.textContent).not.toContain("Dark Magician");
          break;
        case "ST-08":
        case "ST-09":
        case "ST-14":
          expect(
            within(field).getAllByRole("group", { name: /Your Extra Deck/ })
              .length,
          ).toBeGreaterThan(0);
          break;
        default:
          expect(
            within(field).getByRole("group", { name: "Standard duel board" }),
          ).toBeTruthy();
      }
    },
  );

  it("has no stray heading or field/duel-state live regions, and still renders the board", () => {
    const value = board("ST-01");
    const { container } = render(DuelField, { board: value });

    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector('[aria-label="Field updates"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Duel state updates"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-cy="duel-field-board"]'),
    ).not.toBeNull();
  });

  it("renders one named semantic board with 34 stable physical zones and two shared EMZs", () => {
    const value = board("ST-01");
    render(DuelField, { board: value });

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(field.querySelectorAll("[data-zone-id]")).toHaveLength(32);

    for (const zone of value.zones) {
      const node = within(field).getByRole("group", {
        name: zone.accessibleLabel,
      });
      // Hand zones (T8) paint no ZoneControl/`data-zone-id`; HandBand's own
      // root still exposes the same accessible group name, anchored by
      // `data-feedback-zone-id` instead.
      expect(
        node.getAttribute(
          zone.kind === "hand" ? "data-feedback-zone-id" : "data-zone-id",
        ),
      ).toBe(zone.id);
    }

    const sharedZones = within(field).getAllByRole("group", {
      name: /^Shared Extra Monster Zone/,
    });
    expect(sharedZones).toHaveLength(2);
    expect(
      new Set(sharedZones.map((zone) => zone.getAttribute("data-zone-id"))),
    ).toEqual(
      new Set(["shared:extraMonster:left", "shared:extraMonster:right"]),
    );
    const buttons = within(field).queryAllByRole("button");
    expect(
      buttons.map((button) => button.getAttribute("data-cy")).sort(),
    ).toEqual(["field-stack-p0:deck", "field-stack-p1:deck"].sort());
  });

  it("renders hands through bands and no hand ZoneControl", () => {
    const value = board("ST-01");
    render(DuelField, { board: value });

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(
      within(field)
        .getByRole("group", { name: "Your Hand" })
        .getAttribute("data-cy"),
    ).toBe("field-hand-band-p0");
    expect(
      within(field)
        .getByRole("group", { name: "Opponent Hand" })
        .getAttribute("data-cy"),
    ).toBe("field-hand-band-p1");
    expect(
      field.querySelector('[data-cy="zone-control-label-p0:hand"]'),
    ).toBeNull();
    expect(
      field.querySelector('[data-cy="zone-control-label-p1:hand"]'),
    ).toBeNull();
    expect(
      field.querySelector('.duel-field-zone[data-zone-kind="hand"]'),
    ).toBeNull();
  });

  it("attaches pile columns with central-zone spacing", () => {
    const value = board("ST-01");

    for (const player of [0, 1] as const) {
      const spellTrapFive = value.zones.find(
        (zone) => zone.id === `p${player}:spellTrap:4`,
      );
      const deck = value.stacks.find((stack) => stack.id === `p${player}:deck`);
      const banished = value.stacks.find(
        (stack) => stack.id === `p${player}:banished`,
      );
      if (
        spellTrapFive === undefined ||
        deck === undefined ||
        banished === undefined
      )
        throw new Error("Missing pile fixture zones");
      expect(deck.x).toBeCloseTo(925 / 1280, 10);
      expect(banished.x).toBeCloseTo(1020 / 1280, 10);
      expect(deck.x - spellTrapFive.x).toBeCloseTo(95 / 1280, 10);
      expect(banished.x - deck.x).toBeCloseTo(95 / 1280, 10);
    }
  });

  it("keyboard navigation reaches an offscreen player hand card", async () => {
    const value = bigHandBoard(11, 2);
    const { container } = render(FieldBoard, {
      board: value,
      renderLayout: createFieldRenderLayout(true, 1280, 720),
      planeHeight: 720,
      planeTransform: "",
      cardBackUrl: "",
      placeholderUrl: "",
    });

    const nine = container.querySelector<HTMLElement>(
      '[data-field-target="card:big-p0-9"]',
    );
    if (nine === null) throw new Error("Missing sequence 9 hand card");
    nine.focus();
    await fireEvent.keyDown(nine, { key: "ArrowRight" });

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-field-target")).toBe(
        "card:big-p0-10",
      );
    });
    expect(
      container.querySelector('[data-card-id="big-p0-10"]'),
    ).not.toBeNull();
  });

  it("mounts the full oversized hand without page controls", () => {
    const value = bigHandBoard(20, 0, true);
    const { container } = render(FieldBoard, {
      board: value,
      renderLayout: createFieldRenderLayout(true, 1280, 720),
      planeHeight: 720,
      planeTransform: "",
      cardBackUrl: "",
      placeholderUrl: "",
    });
    expect(
      container.querySelectorAll('[data-card-zone-id="p0:hand"]'),
    ).toHaveLength(20);
    expect(
      container.querySelector('[data-cy="field-hand-p0-count"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-cy^="field-hand-p0-"][data-cy$="page-status"]',
      ),
    ).toBeNull();
  });

  it("keyboard navigation follows mirrored opponent direction", async () => {
    const value = bigHandBoard(2, 11);
    const opponentHand = value.cards
      .filter(({ zoneId }) => zoneId === "p1:hand")
      .toSorted((left, right) => left.sequence - right.sequence);
    const nineTarget = opponentHand[9]?.targetId;
    const tenTarget = opponentHand[10]?.targetId;
    if (nineTarget === undefined || tenTarget === undefined)
      throw new Error("Missing opponent sequence 9/10 hand cards");
    const { container } = render(FieldBoard, {
      board: value,
      renderLayout: createFieldRenderLayout(true, 1280, 720),
      planeHeight: 720,
      planeTransform: "",
      cardBackUrl: "",
      placeholderUrl: "",
    });

    const nine = container.querySelector<HTMLElement>(
      `[data-field-target="${nineTarget}"]`,
    );
    if (nine === null) throw new Error("Missing opponent sequence 9 hand card");
    nine.focus();
    await fireEvent.keyDown(nine, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-field-target")).toBe(
        tenTarget,
      );
    });

    const ten = document.activeElement as HTMLElement;
    await fireEvent.keyDown(ten, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-field-target")).toBe(
        nineTarget,
      );
    });
  });

  it("keeps visible and hidden card nodes keyed without exposing opponent identity", async () => {
    const value = board("ST-01");
    const rendered = render(DuelField, {
      board: value,
      cardBackUrl: "/cards/back.webp",
      placeholderUrl: "/cards/placeholder.webp",
    });

    const visible = screen.getByRole("article", {
      name: /The Legendary Fisherman in Your Hand/,
    });
    const hidden = screen.getAllByRole("article", {
      name: "Hidden opponent hand card",
    })[0];
    if (hidden === undefined) throw new Error("Missing hidden opponent card");
    expect(visible.getAttribute("data-card-id")).toBe("st01-own-hand");
    expect(hidden.getAttribute("data-hidden")).toBe("true");
    expect(document.body.textContent).not.toContain("Dark Magician");
    expect(document.body.innerHTML).not.toContain("46986414");
    expect(hidden.querySelector("img")?.getAttribute("alt")).toBe("");

    await rendered.rerender({ board: value });
    expect(
      screen.getByRole("article", {
        name: /The Legendary Fisherman in Your Hand/,
      }),
    ).toBe(visible);
    expect(
      screen.getAllByRole("article", {
        name: "Hidden opponent hand card",
      })[0],
    ).toBe(hidden);
  });

  it("renders stack counts through named passive controls", () => {
    render(DuelField, { board: board("ST-08") });

    /* Every stack rendered here has cards in it, so each is a clickable
       button (T8) rather than a passive group. */
    expect(
      screen.getByRole("button", { name: "Your Deck, 35 cards" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Your Graveyard, 1 card, top card Blue-Eyes White Dragon",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Opponent Deck, 31 cards" }),
    ).toBeTruthy();
  });

  it("exposes defense and opponent orientation as readable state and DOM data", () => {
    render(DuelField, { board: board("ST-04") });

    const defense = screen.getByRole("article", {
      name: /Axe Raider in Your Monster Zone 2, face-up defense/,
    });
    expect(defense.getAttribute("data-orientation")).toBe("sideways");
    expect(defense.classList.contains("is-sideways")).toBe(true);

    const opponent = board("ST-03").cards.find(
      (card) => card.facing === "opponent",
    );
    if (opponent === undefined)
      throw new Error("Missing opponent fixture card");
    cleanup();
    render(DuelField, { board: board("ST-03") });
    const opponentCard = screen.getByRole("article", {
      name: `Opponent controlled, ${opponent.label}`,
    });
    expect(opponentCard.getAttribute("data-facing")).toBe("opponent");
    expect(opponentCard.classList.contains("is-opponent")).toBe(true);
    expect(opponentCard.getAttribute("aria-label")).toContain("Opponent");
  });

  it("uses one roving field tab stop and spatial Arrow/Home/End focus", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    renderInteractive(value);

    const targets = [
      ...document.querySelectorAll<HTMLElement>("[data-field-target]"),
    ];
    expect(targets.filter((target) => target.tabIndex === 0)).toHaveLength(1);
    const card = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman/,
    });
    expect(card.tabIndex).toBe(0);
    card.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("data-field-target")).toBe(
      "zone:p0:mainMonster:1",
    );
    await user.keyboard("{End}");
    expect(document.activeElement?.getAttribute("data-field-target")).toBe(
      "stack:p0:banished",
    );
    await user.keyboard("{Home}");
    expect(document.activeElement?.getAttribute("data-field-target")).toBe(
      "zone:p0:field",
    );
    expect(
      document.activeElement?.classList.contains("is-navigation-active"),
    ).toBe(true);
  });

  it("makes native Enter and Space activation submit an exact singleton choice directly", async () => {
    const user = userEvent.setup();
    const enterValue = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    const enterHarness = renderInteractive(enterValue);
    const enterCard = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman.*face-up attack/,
    });
    enterCard.focus();
    expect(
      enterCard
        .closest(".duel-field-card")
        ?.classList.contains("is-actionable"),
    ).toBe(true);
    expect(
      enterCard.closest(".duel-field-card")?.classList.contains("is-selected"),
    ).toBe(false);
    await user.keyboard("{Enter}");
    expect(enterHarness.commands).toEqual([["select"]]);
    expect(
      enterCard.closest(".duel-field-card")?.classList.contains("is-selected"),
    ).toBe(false);
    /* Feedback item 6 keeps the status window mounted for every selection, so
       the no-dead-end guard is the absent Confirm button, not an absent bar. */
    expect(
      document.querySelector('[data-cy="field-action-bar-confirm"]'),
    ).toBeNull();
    cleanup();

    const spaceValue = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    const spaceHarness = renderInteractive(spaceValue);
    const spaceCard = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman.*face-up attack/,
    });
    spaceCard.focus();
    await user.keyboard(" ");
    expect(spaceHarness.commands).toEqual([["select"]]);
    expect(
      spaceCard.closest(".duel-field-card")?.classList.contains("is-selected"),
    ).toBe(false);
  });

  it("a multi-pick selection prompt shows dashed candidates, no chips, and toggles is-selected on activation", async () => {
    const user = userEvent.setup();
    const harness = renderInteractive(
      fieldPrompt("selectCard", [mountedChoice("select", "Select monster")], {
        minimum: 1,
        maximum: 2,
      }),
    );
    const card = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman/,
    });
    const article = card.closest(".duel-field-card");
    expect(article?.classList.contains("is-selection-candidate")).toBe(true);
    expect(article?.classList.contains("is-selected")).toBe(false);
    expect(article?.querySelector(".card-action-chips")).toBeNull();

    card.focus();
    await user.keyboard("{Enter}");
    expect(article?.classList.contains("is-selected")).toBe(true);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(harness.commands).toEqual([]);

    await user.keyboard("{Enter}");
    expect(article?.classList.contains("is-selected")).toBe(false);
  });

  /* Item 9: the halo is the draft, and the draft stops being the player's the
     moment the answer is in flight. The session keeps `selectedChoiceIds` so a
     rejection can resume it, so the drop is presentational only. */
  it("drops the selection halo while a submitted answer is in flight", async () => {
    const user = userEvent.setup();
    const harness = renderInteractive(
      fieldPrompt("selectCard", [mountedChoice("select", "Select monster")], {
        minimum: 1,
        maximum: 2,
      }),
    );
    const card = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman/,
    });
    const article = card.closest(".duel-field-card");
    card.focus();
    await user.keyboard("{Enter}");
    expect(article?.classList.contains("is-selected")).toBe(true);

    await harness.dispatch({
      type: "submissionAccepted",
      key: harness.spec.key,
    });
    await tick();

    expect(harness.getSession().status).toBe("submitting");
    expect([...harness.getSession().selectedChoiceIds]).toEqual([
      choiceId("select"),
    ]);
    expect(document.querySelectorAll(".is-selected")).toHaveLength(0);
  });

  it("restores the halo set when the submission is rejected", async () => {
    const user = userEvent.setup();
    const harness = renderInteractive(
      fieldPrompt("selectCard", [mountedChoice("select", "Select monster")], {
        minimum: 1,
        maximum: 2,
      }),
    );
    const card = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman/,
    });
    const article = card.closest(".duel-field-card");
    card.focus();
    await user.keyboard("{Enter}");
    await harness.dispatch({
      type: "submissionAccepted",
      key: harness.spec.key,
    });
    await harness.dispatch({
      type: "submissionRejected",
      key: harness.spec.key,
    });
    await tick();

    expect(harness.getSession().status).toBe("editing");
    expect(article?.classList.contains("is-selected")).toBe(true);
    expect(document.querySelectorAll(".is-selected")).toHaveLength(1);
  });

  /* The store hands the field a submitting session together with the stale
     prompt while `responsePending` holds it (`duel-store.ts:187`), so the
     first render of that pair carries no halo either. */
  it("renders no halo for a session that arrives already submitting", () => {
    const value = fieldPrompt(
      "selectCard",
      [mountedChoice("select", "Select monster")],
      { minimum: 1, maximum: 2 },
    );
    const spec = activeSpec(value);
    const drafted = reduceInteractionSession(
      createInteractionSession(spec),
      spec,
      { type: "toggleChoice", choiceId: choiceId("select"), key: spec.key },
    ).session;
    const submitting = reduceInteractionSession(drafted, spec, {
      type: "submissionAccepted",
      key: spec.key,
    }).session;

    render(DuelField, {
      board: board("ST-05"),
      prompt: value,
      spec,
      session: submitting,
      pending: false,
    });

    expect(submitting.selectedChoiceIds).toEqual([choiceId("select")]);
    expect(document.querySelectorAll(".is-selected")).toHaveLength(0);
  });

  it("pins the chips on Enter, walks them, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
      mountedChoice("set", "Set The Legendary Fisherman", {
        action: "setMonster",
      }),
    ]);
    renderInteractive(value);
    const card = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });
    card.focus();
    await user.keyboard("{Enter}");
    const firstChip = screen.getByRole("button", { name: "Activate effect" });
    const secondChip = screen.getByRole("button", {
      name: "Set The Legendary Fisherman",
    });
    await waitFor(() => expect(document.activeElement).toBe(firstChip));
    // The engine labels every set identically, so the chips carry the action
    // word while the full label stays on `title` / the accessible name.
    expect(firstChip.textContent?.trim()).toBe("Activate");
    expect(secondChip.textContent?.trim()).toBe("Set");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(secondChip);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(card));
    // The chips element is hidden by CSS, never unmounted, so it is still in
    // the DOM here — count assertions would prove nothing either way.
    expect(
      document.querySelector('[data-cy^="card-action-chips-"]'),
    ).not.toBeNull();
  });

  it("survives unpinning after the pinned card target has already unmounted", async () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
    ]);
    const spec = activeSpec(value);
    const idle = createInteractionSession(spec);
    const rendered = render(DuelField, {
      board: board("ST-05"),
      prompt: value,
      spec,
      session: idle,
      pending: false,
    });
    const card = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });
    const targetId = card.getAttribute("data-field-target");
    if (targetId === null) throw new Error("Missing field target");
    await rendered.rerender({
      session: { ...idle, menuTarget: targetId } as InteractionSession,
    });

    // A pending response drops the card out of its actionable state, which
    // unmounts the target button and leaves `bind:this` holding null. The
    // unpin that arrives with the next prompt must not trip over that.
    await rendered.rerender({ pending: true });
    expect(
      document.querySelector('[data-cy^="card-action-chips-"]'),
    ).toBeNull();
    await rendered.rerender({ pending: true, session: idle });
    expect(screen.getByRole("region", { name: "Duel field" })).toBeTruthy();
  });

  it("dispatches exactly one chooseChoice from a chip and never reopens the menu", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
      mountedChoice("set", "Set The Legendary Fisherman", {
        action: "setMonster",
      }),
    ]);
    const harness = renderInteractive(value);
    const card = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });
    card.focus();
    await user.keyboard("{Enter}");
    const chip = screen.getByRole("button", { name: "Activate effect" });
    await waitFor(() => expect(document.activeElement).toBe(chip));
    harness.dispatch.mockClear();
    await user.keyboard("{Enter}");
    expect(harness.commands).toEqual([["activate"]]);
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "chooseChoice",
    ]);
  });

  it("moves field focus to a new prompt target without stealing outside focus", async () => {
    const firstPrompt = fieldPrompt("selectCard", [
      mountedChoice("first", "First target"),
    ]);
    const firstSpec = activeSpec(firstPrompt);
    const rendered = render(DuelField, {
      board: board("ST-05"),
      prompt: firstPrompt,
      spec: firstSpec,
      session: createInteractionSession(firstSpec),
    });
    const firstTarget = screen.getByRole("button", {
      name: /Select The Legendary Fisherman/,
    });
    firstTarget.focus();

    const nextPrompt = fieldPrompt("selectPlace", [
      promptChoice("next", "Your Main Monster 5", {
        place: { player: 0, location: "monster", sequence: 4 },
      }),
    ]);
    const nextSpec = activeSpec(nextPrompt);
    await rendered.rerender({
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Select Your Monster Zone 5/ }),
      ),
    );

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await rendered.rerender({
      prompt: firstPrompt,
      spec: firstSpec,
      session: createInteractionSession(firstSpec),
    });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("exposes public controller, zone, position, counters, and materials", () => {
    render(DuelField, { board: board("ST-07") });
    const rich = screen.getByRole("article", {
      name: /The Legendary Fisherman in Your Monster Zone 2, face-up attack, 3 Spell Counters, 2 materials/,
    });
    expect(rich.getAttribute("data-facing")).toBe("self");
    expect(document.body.innerHTML).not.toContain("46986414");
  });

  it("opens the materials list from the Materials chip and closes it like a browse list", async () => {
    const user = userEvent.setup();
    render(DuelField, { board: board("ST-07") });

    const chips = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-cy="card-action-chip-local-materials"]',
      ),
    ];
    expect(chips).toHaveLength(1);
    const chip = chips[0];
    if (chip === undefined) throw new Error("Missing Materials chip");
    expect(chip.closest("article")?.dataset.cy).toBe("field-card-st07-host");
    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();

    await fireEvent.click(chip);

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    const header = document.querySelector(
      '[data-cy="zone-list-dialog-title"]',
    )?.textContent;
    expect(header).toContain("The Legendary Fisherman");
    expect(header).toContain("Materials");
    expect(
      document.querySelectorAll(
        '[data-cy^="zone-list-entry-st07-host:material:"]',
      ),
    ).toHaveLength(2);

    await fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();

    /* A second press of the chip travels through the window's outside-click
       dismissal first, exactly as a pile control does, and must leave the
       list closed rather than reopening it. */
    await fireEvent.click(chip);
    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    await user.click(chip);
    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  /* ST-07 holds a single monster, so a materials-free field card has to come
     from a fixture that has one. */
  it("a card without materials shows no Materials chip", () => {
    render(DuelField, { board: board("ST-02") });

    expect(
      document.querySelectorAll('[data-cy="card-action-chip-local-materials"]'),
    ).toHaveLength(0);
    expect(document.querySelectorAll(".card-action-chips")).toHaveLength(0);
  });

  it("enters a card tray with Enter and returns focus with Escape", async () => {
    const user = userEvent.setup();
    render(CardTray, {
      label: "Your GY",
      player: 0,
      zone: "graveyard",
      count: 60,
      cards: SIXTY_PUBLIC_CARDS,
      cardTexts: PUBLIC_STATE_CARD_TEXTS,
    });
    const open = screen.getByRole("button", {
      name: "Open Your GY tray, 60 cards",
    });
    open.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getAllByRole("button", { name: /^Inspect / })[0],
      ),
    );
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(open);
  });

  it("pins the chips on click, never pointerdown, and a moved pointer does not pin them", async () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
      mountedChoice("set", "Set The Legendary Fisherman", {
        action: "setMonster",
      }),
    ]);
    const harness = renderInteractive(value);
    const card = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });
    const article = card.closest(".duel-field-card");
    if (article === null) throw new Error("Missing card article");
    const targetId = card.getAttribute("data-field-target");
    expect(
      article.querySelector(
        `[data-cy="card-action-chips-${article.getAttribute("data-card-id")}"]`,
      ),
    ).not.toBeNull();

    await fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    expect(article.classList.contains("is-pinned")).toBe(false);
    await fireEvent.pointerMove(card, { clientX: 40, clientY: 40 });
    await fireEvent.pointerUp(card, { clientX: 40, clientY: 40 });
    await fireEvent.click(card);
    expect(article.classList.contains("is-pinned")).toBe(false);
    expect(harness.dispatch).not.toHaveBeenCalled();

    await fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    await fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    await fireEvent.click(card);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "openMenu",
      target: targetId,
    });
    await waitFor(() =>
      expect(article.classList.contains("is-pinned")).toBe(true),
    );
    expect(
      within(article as HTMLElement).getByRole("button", {
        name: "Activate effect",
      }).textContent,
    ).toBe("Activate");
  });

  it("gives every actionable card chips markup, non-actionable cards none, and no menu anywhere", () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
    ]);
    // ST-06 holds two monsters; only the one the prompt names is actionable.
    const valueBoard = board("ST-06");
    const spec = mapPromptToInteractionSpec(
      value,
      BOARD_VIEW_MODEL_FIXTURES["ST-06"],
      valueBoard,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const { container } = render(DuelField, {
      board: valueBoard,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
    const actionable = container.querySelector(
      ".duel-field-card.is-actionable",
    );
    if (actionable === null) throw new Error("Missing actionable card");
    expect(
      actionable.querySelector('[data-cy^="card-action-chips-"]'),
    ).not.toBeNull();

    const passive = [
      ...container.querySelectorAll(".duel-field-card:not(.is-actionable)"),
    ];
    expect(passive.length).toBeGreaterThan(0);
    for (const card of passive)
      expect(card.querySelector('[data-cy^="card-action-chips-"]')).toBeNull();
  });

  it("offers no Inspect button anywhere on the field", () => {
    const value = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    const { rendered } = renderInteractive(value);
    expect(screen.queryAllByRole("button", { name: /^Inspect / })).toEqual([]);
    expect(
      rendered.container.querySelector(".duel-field-card__inspect"),
    ).toBeNull();
    expect(rendered.container.querySelector('[role="menu"]')).toBeNull();
  });

  it("toggles multi and optional-unselect drafts without submitting before explicit Confirm", async () => {
    const user = userEvent.setup();
    for (const [kind, choice, overrides] of [
      [
        "selectCard",
        mountedChoice("multi", "Select monster"),
        { minimum: 1, maximum: 2 },
      ],
      [
        "selectUnselectCard",
        mountedChoice("toggle", "Toggle monster"),
        { minimum: 0, maximum: 1 },
      ],
    ] as const) {
      cleanup();
      const value = fieldPrompt(kind, [choice], overrides);
      const harness = renderInteractive(value);
      const target = screen.getByRole("button", {
        name: /Select The Legendary Fisherman/,
      });
      await user.click(target);
      expect(harness.commands).toEqual([]);
      expect(
        (screen.getByRole("button", { name: /Confirm/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      // Inspection moved off the card entirely; the HUD trays own it now.
      expect(screen.queryAllByRole("button", { name: /^Inspect / })).toEqual(
        [],
      );
      await user.click(screen.getByRole("button", { name: /Confirm/ }));
      expect(harness.commands).toEqual([[choice.id]]);
    }
  });

  it("submits an exact singleton card selection immediately, with no draft/Confirm step", async () => {
    const user = userEvent.setup();
    for (const [kind, choice] of [
      ["selectCard", mountedChoice("attack-target", "Select monster")],
      ["selectTribute", mountedChoice("tribute", "Tribute monster")],
      [
        "selectSum",
        mountedChoice("sum", "Tribute monster", {
          card: {
            instanceId: cardInstanceId("prompt-sum"),
            controller: 0,
            location: "monster",
            sequence: 0,
            position: "faceUpAttack",
            contribution: 2,
          },
        }),
      ],
    ] as const) {
      cleanup();
      const value = fieldPrompt(kind, [choice], {
        minimum: 1,
        maximum: 1,
        ...(kind === "selectSum" ? { requiredTotal: 2, sumMode: "exact" } : {}),
      });
      const harness = renderInteractive(value);
      const target = screen.getByRole("button", {
        name: /Select The Legendary Fisherman/,
      });
      await user.click(target);
      expect(harness.commands).toEqual([[choice.id]]);
      expect(
        target.closest(".duel-field-card")?.classList.contains("is-selected"),
      ).toBe(false);
      expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
      expect(
        document.querySelector('[data-cy="field-action-bar-confirm"]'),
      ).toBeNull();
    }
  });

  it("dispatches exactly one chooseChoice on a double click while pending", async () => {
    const value = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    const spec = activeSpec(value);
    const session = createInteractionSession(spec);
    const oninteraction = vi.fn();
    const rendered = render(DuelField, {
      board: board("ST-05"),
      prompt: value,
      spec,
      session,
      pending: false,
      oninteraction,
    });
    const card = screen.getByRole("button", {
      name: /Legal.*Select The Legendary Fisherman.*face-up attack/,
    });
    await fireEvent.click(card);
    await rendered.rerender({ pending: true });
    await fireEvent.click(card);
    expect(oninteraction).toHaveBeenCalledTimes(1);
    expect(oninteraction).toHaveBeenCalledWith({
      type: "chooseChoice",
      choiceId: choiceId("select"),
      key: spec.key,
    });
  });

  it("zone click submits a single placement", async () => {
    const user = userEvent.setup();
    for (const kind of ["selectPlace", "selectDisabledField"] as const) {
      cleanup();
      const choice = promptChoice("place", "Your Main Monster 1", {
        place: { player: 0, location: "monster", sequence: 0 },
      });
      const value = fieldPrompt(kind, [choice]);
      const harness = renderInteractive(value);
      expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
      expect(
        document.querySelector('[data-cy="floating-field-window-confirm"]'),
      ).toBeNull();
      await user.click(
        screen.getByRole("button", { name: /Select Your Monster Zone 1/ }),
      );
      expect(harness.commands).toEqual([[choice.id]]);
    }
  });

  it("requires valid explicit counter allocation and order confirmation; supports cancel, finish, and pass", async () => {
    const user = userEvent.setup();
    const counter = fieldPrompt(
      "selectCounter",
      [mountedChoice("counter", "Spell Counter", { allocationMaximum: 2 })],
      { minimum: 2, maximum: 2 },
    );
    let harness = renderInteractive(counter);
    const confirmAllocation = screen.getByRole("button", {
      name: "Confirm allocation",
    });
    expect((confirmAllocation as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /Add one counter/ }));
    expect((confirmAllocation as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /Add one counter/ }));
    expect((confirmAllocation as HTMLButtonElement).disabled).toBe(false);
    expect(harness.commands).toEqual([]);
    await user.click(confirmAllocation);
    expect(harness.commands).toEqual([
      [choiceId("counter"), choiceId("counter")],
    ]);

    cleanup();
    const order = fieldPrompt(
      "sortCard",
      [mountedChoice("first", "First"), mountedChoice("second", "Second")],
      { minimum: 2, maximum: 2, ordered: true, cancelable: true },
    );
    harness = renderInteractive(order);
    await user.click(screen.getByRole("button", { name: "Move First down" }));
    expect(harness.commands).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Confirm order" }));
    expect(harness.commands).toEqual([[choiceId("second"), choiceId("first")]]);

    for (const [label, action] of [
      ["Cancel", "cancel"],
      ["Finish", "finish"],
      ["Pass", "pass"],
    ] as const) {
      cleanup();
      const command = fieldPrompt("chain", [
        mountedChoice(label.toLowerCase(), label, { action }),
      ]);
      harness = renderInteractive(command);
      await user.click(screen.getByRole("button", { name: /Open actions/ }));
      expect(harness.commands).toEqual([[choiceId(label.toLowerCase())]]);
    }
  });

  it("single-choice card fires the action directly", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
    ]);
    const harness = renderInteractive(value);
    await user.click(
      screen.getByRole("button", {
        name: /Open actions for The Legendary Fisherman/,
      }),
    );
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "chooseChoice",
    ]);
    expect(harness.commands).toEqual([[choiceId("activate")]]);
  });

  it("multi-choice card still opens the menu", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
      mountedChoice("set", "Set The Legendary Fisherman", {
        action: "setMonster",
      }),
    ]);
    const harness = renderInteractive(value);
    const card = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });
    const targetId = card.getAttribute("data-field-target");
    await user.click(card);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "openMenu",
      target: targetId,
    });
  });

  it("outside click cancels a cancelable prompt", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "selectPlace",
      [
        promptChoice("place", "Your Main Monster 1", {
          place: { player: 0, location: "monster", sequence: 0 },
        }),
      ],
      { cancelable: true },
    );
    const harness = renderInteractive(value);
    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await user.click(surface);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "cancel",
    });
  });

  it("outside click is inert when not cancelable", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "selectPlace",
      [
        promptChoice("place", "Your Main Monster 1", {
          place: { player: 0, location: "monster", sequence: 0 },
        }),
      ],
      { cancelable: false },
    );
    const harness = renderInteractive(value);
    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await user.click(surface);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("a pass-only chain remains answerable inline", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "chain",
      [promptChoice("c-pass", "Pass", { action: "pass" })],
      { cancelable: true },
    );
    const harness = renderInteractive(value);
    expect(harness.spec.fieldCapable).toBe(false);

    await user.click(screen.getByRole("button", { name: "Pass" }));

    expect(harness.commands).toEqual([[choiceId("c-pass")]]);
  });

  it("routes a chain to the dialog when the field is not rendered", () => {
    const value = fieldPrompt(
      "chain",
      [promptChoice("c-pass", "Pass", { action: "pass" })],
      { cancelable: true },
    );
    const spec = activeSpec(value);
    expect(spec.fieldCapable).toBe(false);

    expect(promptSurface(value, spec, false, false)).toBe("dialog");
  });

  /* T14/ADR-017 supersedes round 2's "outside click passes a chain": the Pass
     now lives in the confirm window, and a live decision must never be
     answered by an incidental click on the field. */
  it("outside click never passes a chain while the confirm window is up", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "chain",
      [promptChoice("c-pass", "Pass", { action: "pass" })],
      { cancelable: true },
    );
    const harness = renderInteractive(value);
    expect(
      document.querySelector('[data-cy="floating-field-window-confirm"]'),
    ).not.toBeNull();
    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await user.click(surface);
    expect(harness.dispatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "c-pass",
      key: harness.spec.key,
    });
  });

  it("Escape never answers the live decision in the confirm window", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "chain",
      [promptChoice("c-pass", "Pass", { action: "pass" })],
      { cancelable: true },
    );
    const harness = renderInteractive(value);

    await user.keyboard("{Escape}");

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-cy="floating-field-window-confirm"]'),
    ).not.toBeNull();
  });

  it("outside click cannot pass a forced chain, which remains answerable", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "chain",
      [mountedChoice("activate", "Chain", { action: "activate" })],
      { cancelable: false },
    );
    const harness = renderInteractive(value);
    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await user.click(surface);
    expect(harness.dispatch).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: /Open actions for The Legendary Fisherman/,
      }),
    );
    expect(harness.commands).toEqual([[choiceId("activate")]]);
  });

  it("outside click on a card target does not pass a chain", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "chain",
      [
        mountedChoice("activate", "Chain", { action: "activate" }),
        promptChoice("c-pass", "Pass", { action: "pass" }),
      ],
      { cancelable: true },
    );
    const harness = renderInteractive(value);
    await user.click(
      screen.getByRole("button", {
        name: /Open actions for The Legendary Fisherman/,
      }),
    );
    expect(
      harness.dispatch.mock.calls.some(
        ([action]) =>
          action.type === "chooseChoice" && action.choiceId === "c-pass",
      ),
    ).toBe(false);
  });

  it("does not pass a chain when the browse list is dismissed", async () => {
    const user = userEvent.setup();
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const value = fieldPrompt(
      "chain",
      [
        mountedChoice("graveyard-chain", "Chain", {
          card: {
            instanceId: cardInstanceId("prompt-graveyard-chain"),
            controller: 0,
            location: "graveyard",
            sequence: 0,
            position: "faceUpAttack",
          },
        } as Partial<PromptChoice>),
        promptChoice("c-pass", "Pass", { action: "pass" }),
      ],
      { cancelable: true },
    );
    const spec = mapPromptToInteractionSpec(
      value,
      STACK_ART_STATE,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const oninteraction = vi.fn();
    render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        STACK_ART_STATE,
        BOARD_CARD_TEXTS,
      ),
      oninteraction,
    });

    await user.click(
      screen.getByRole("button", { name: /Your Graveyard, 4 cards/ }),
    );
    oninteraction.mockClear();
    await fireEvent.keyDown(document, { key: "Escape" });

    expect(oninteraction).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  it("does not pass a chain when a zone-list entry tile is clicked", async () => {
    const user = userEvent.setup();
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const value = fieldPrompt(
      "chain",
      [
        mountedChoice("graveyard-chain", "Chain", {
          card: {
            instanceId: cardInstanceId("prompt-graveyard-chain"),
            controller: 0,
            location: "graveyard",
            sequence: 0,
            position: "faceUpAttack",
          },
        } as Partial<PromptChoice>),
        promptChoice("c-pass", "Pass", { action: "pass" }),
      ],
      { cancelable: true },
    );
    const spec = mapPromptToInteractionSpec(
      value,
      STACK_ART_STATE,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const oninteraction = vi.fn();
    render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        STACK_ART_STATE,
        BOARD_CARD_TEXTS,
      ),
      oninteraction,
    });

    await user.click(
      screen.getByRole("button", { name: /Your Graveyard, 4 cards/ }),
    );
    oninteraction.mockClear();
    const entry = document.querySelector<HTMLElement>(
      ".zone-list-entry.is-actionable",
    );
    if (entry === null) throw new Error("Missing actionable zone-list entry");
    await user.click(entry);

    expect(oninteraction).not.toHaveBeenCalled();
  });

  it("does not cancel card selection when the zone-list header is clicked", async () => {
    const user = userEvent.setup();
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const value = fieldPrompt(
      "selectCard",
      [
        mountedChoice("graveyard-select", "Select", {
          card: {
            instanceId: cardInstanceId("prompt-graveyard-select"),
            controller: 0,
            location: "graveyard",
            sequence: 0,
            position: "faceUpAttack",
          },
        } as Partial<PromptChoice>),
      ],
      { cancelable: true, maximum: 2 },
    );
    const spec = mapPromptToInteractionSpec(
      value,
      STACK_ART_STATE,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const oninteraction = vi.fn();
    render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        STACK_ART_STATE,
        BOARD_CARD_TEXTS,
      ),
      oninteraction,
    });

    await user.click(
      screen.getByRole("button", { name: /Your Graveyard, 4 cards/ }),
    );
    oninteraction.mockClear();
    const header = document.querySelector<HTMLElement>(
      '[data-cy="zone-list-dialog-header"]',
    );
    if (header === null) throw new Error("Missing zone-list header");
    await user.click(header);

    expect(oninteraction).not.toHaveBeenCalled();
  });

  it("contains render failure locally and remounts without exposing error detail", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate", { action: "activate" }),
    ]);
    const spec = activeSpec(value);
    render(DuelFieldErrorBoundary, {
      board: board("ST-05"),
      cardBackUrl: "",
      placeholderUrl: "",
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      injectFailure: true,
      oninteraction: vi.fn(),
    });

    expect(
      screen.getByRole("heading", {
        name: "Interactive field could not render",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "Injected duel field component failure",
    );
    await user.click(screen.getByRole("button", { name: "Retry duel field" }));
    expect(screen.getByRole("region", { name: "Duel field" })).toBeTruthy();
  });

  it("shows final feedback classes and an aria-hidden pointer-transparent SVG line", async () => {
    const current = board("ST-05");
    const moved = current.cards[0];
    if (moved === undefined || moved.instanceId === undefined)
      throw new Error("Missing movement fixture card");
    const previous = {
      ...current,
      cards: [
        {
          ...moved,
          zoneId: "p0:hand" as const,
        },
      ],
    };
    const rendered = render(DuelField, {
      board: previous,
      feedbackGeneration: "1:1",
      presentationEvents: [],
    });

    await rendered.rerender({
      presentationEvents: [
        {
          sequence: 1,
          event: {
            type: "cardMoved",
            instanceId: moved.instanceId,
            from: "hand",
            to: "monster",
          },
        },
      ],
    });
    expect(feedbackStatuses()).toHaveLength(0);

    await rendered.rerender({ board: current });

    // Item 26: the action/phase badge is gone; the highlight and line stay
    // (ADR-010/round 2 assigned current-action status to the preview panel).
    expect(feedbackStatuses()).toHaveLength(0);
    expect(
      document.querySelector(`[data-card-id="${moved.id}"]`)?.classList,
    ).toContain("is-feedback-target");
    const line = document.querySelector("svg.field-lines");
    expect(line?.getAttribute("aria-hidden")).toBe("true");
    expect(line?.getAttribute("focusable")).toBe("false");
    expect(line?.querySelector("line")).not.toBeNull();
  });

  it("cancels feedback on a new runtime generation", async () => {
    const value = board("ST-05");
    const card = value.cards[0];
    if (card === undefined || card.code === undefined)
      throw new Error("Missing summon fixture card");
    const presentationEvents = [
      {
        sequence: 1,
        event: { type: "summon" as const, player: 0 as const, card: card.code },
      },
    ];
    const rendered = render(DuelField, {
      board: board("ST-01"),
      feedbackGeneration: "1:1",
      presentationEvents: [],
    });
    await rendered.rerender({ presentationEvents });
    await rendered.rerender({ board: value });
    // Item 26: no badge; the highlight is the surviving evidence of the
    // summon feedback that this test cancels below.
    expect(feedbackStatuses()).toHaveLength(0);
    expect(document.querySelector(".is-feedback-target")).not.toBeNull();

    await rendered.rerender({
      feedbackGeneration: "2:0",
      presentationEvents,
    });

    expect(feedbackStatuses()).toHaveLength(0);
    expect(document.querySelector(".is-feedback-target")).toBeNull();
    expect(document.querySelector("svg.field-lines")).toBeNull();
  });

  it("uses no movement in reduced motion while final highlight, text, and input remain", async () => {
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
      finished: new Promise<void>(() => undefined),
    }));
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    const value = fieldPrompt("selectCard", [
      mountedChoice("select", "Select card"),
    ]);
    const valueBoard = board("ST-05");
    const card = valueBoard.cards[0];
    if (card === undefined || card.code === undefined)
      throw new Error("Missing feedback fixture card");
    const spec = activeSpec(value);
    const oninteraction = vi.fn(() => true);
    const rendered = render(DuelField, {
      board: valueBoard,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      feedbackGeneration: "1:1",
      reducedMotion: true,
      presentationEvents: [],
      oninteraction,
    });
    await rendered.rerender({
      presentationEvents: [
        {
          sequence: 1,
          event: { type: "summon", player: 0, card: card.code },
        },
      ],
    });
    await rendered.rerender({ board: { ...valueBoard } });

    expect(animate).not.toHaveBeenCalled();
    // Item 26: no badge; the highlight still fires under reduced motion.
    expect(feedbackStatuses()).toHaveLength(0);
    expect(document.querySelector(".is-feedback-target")).not.toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Select The Legendary/ }));
    expect(oninteraction).toHaveBeenCalledOnce();
  });

  it("renders placeholder and back art immediately without image readiness state", () => {
    render(DuelField, {
      board: board("ST-04"),
      cardBackUrl: "/cards/back.webp",
      placeholderUrl: "/cards/placeholder.webp",
    });

    const visible = screen.getByRole("article", {
      name: /The Legendary Fisherman in Your Monster Zone 1/,
    });
    const hidden = screen.getByRole("article", {
      name: /Dark Magician in Your Monster Zone 3/,
    });
    expect(within(visible).getByRole("img").getAttribute("src")).toBe(
      "/cards/placeholder.webp",
    );
    expect(hidden.querySelector("img")?.getAttribute("src")).toBe(
      "/cards/back.webp",
    );
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("renders the field action bar inside the field and never a selection dock", () => {
    const value = fieldPrompt(
      "selectCard",
      [mountedChoice("select", "Select monster")],
      { minimum: 1, maximum: 2 },
    );
    renderInteractive(value);

    const field = screen.getByRole("region", { name: "Duel field" });
    expect(field.querySelector('[data-cy="field-action-bar"]')).not.toBeNull();
    expect(field.querySelector(".selection-dock")).toBeNull();
  });

  /* Feedback item 6: the bar carries the live count and, on a sum selection,
     the running level total against its target. */
  it("keeps a live selection status on the action bar from zero selected", async () => {
    const user = userEvent.setup();
    renderInteractive(
      fieldPrompt(
        "selectSum",
        [
          mountedChoice("sum", "Tribute monster", {
            card: {
              instanceId: cardInstanceId("prompt-sum"),
              controller: 0,
              location: "monster",
              sequence: 0,
              position: "faceUpAttack",
              contribution: 4,
            },
          }),
        ],
        { minimum: 1, maximum: 2, requiredTotal: 8, sumMode: "exact" },
      ),
    );

    const summary = document.querySelector(
      '[data-cy="field-action-bar-summary"]',
    );
    expect(summary?.textContent).toBe("0 selected (choose 1–2) · sum 0 of 8");

    await user.click(
      screen.getByRole("button", { name: /Select The Legendary Fisherman/ }),
    );
    expect(
      document.querySelector('[data-cy="field-action-bar-summary"]')
        ?.textContent,
    ).toBe("1 selected (choose 1–2) · sum 4 of 8");
  });

  it("renders the action bar inside the confirm window, outside the board scroll region", () => {
    const value = fieldPrompt(
      "selectCard",
      [mountedChoice("select", "Select monster")],
      { minimum: 1, maximum: 2 },
    );
    renderInteractive(value);

    const field = screen.getByRole("region", { name: "Duel field" });
    const confirmWindow = field.querySelector(
      '[data-cy="floating-field-window-confirm"]',
    );
    if (confirmWindow === null) throw new Error("Missing confirm window");
    // T14: the window layer hangs off the still field root, never off the
    // scroll region a board pan moves, and the old reserved gutter is gone.
    expect(
      confirmWindow.querySelector('[data-cy="field-action-bar"]'),
    ).not.toBeNull();
    expect(
      field
        .querySelector('[data-cy="duel-field-scroll-region"]')
        ?.contains(confirmWindow),
    ).toBe(false);
    const stage = field.querySelector('[data-cy="duel-field-stage"]');
    if (stage === null) throw new Error("Missing duel field stage");
    expect(stage.hasAttribute("data-field-action-bar")).toBe(false);
    expect(
      (stage as HTMLElement).style.getPropertyValue(
        "--field-action-bar-height",
      ),
    ).toBe("");
  });

  it("mounts no confirm window when a card action spec renders no action bar", () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
    ]);
    const harness = renderInteractive(value);

    expect(harness.spec.kind).toBe("cardAction");
    expect(harness.spec.globalChoices.size).toBe(0);
    const field = screen.getByRole("region", { name: "Duel field" });
    expect(field.querySelector('[data-cy="field-action-bar"]')).toBeNull();
    expect(
      field.querySelector('[data-cy="floating-field-window-confirm"]'),
    ).toBeNull();
  });

  it("hides all phase-transition choices from the action bar", () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate", { action: "activate" }),
      promptChoice("battle", "Enter Battle Phase", { action: "battlePhase" }),
      promptChoice("main2", "Enter Main Phase 2", { action: "mainPhase2" }),
      promptChoice("end", "End turn", { action: "endPhase" }),
      promptChoice("pass", "Pass", { action: "pass" }),
    ]);
    renderInteractive(value);

    const field = screen.getByRole("region", { name: "Duel field" });
    const barChoices = field.querySelectorAll(
      '[data-cy^="field-action-bar-choice-"]',
    );
    expect(barChoices).toHaveLength(1);
    expect(barChoices[0]?.getAttribute("data-cy")).toBe(
      "field-action-bar-choice-pass",
    );
  });

  it("leases mounted visible art only and releases it on unmount", () => {
    const release = vi.fn();
    const lease = vi.fn<(code: number) => { url: string; release: () => void }>(
      () => ({ url: "blob:mounted-card", release }),
    );
    const rendered = render(DuelField, {
      board: board("ST-04"),
      imageLibrary: { lease },
      cardBackUrl: "/cards/back.webp",
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(lease).toHaveBeenCalledTimes(2);
    expect(lease).toHaveBeenCalledWith(97590747);
    expect(lease.mock.calls.every(([code]) => code > 0)).toBe(true);
    expect(
      screen
        .getByRole("img", { name: /The Legendary Fisherman/ })
        .getAttribute("src"),
    ).toBe("blob:mounted-card");
    rendered.unmount();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("drag halos every candidate zone and nothing else", async () => {
    const harness = renderDraggableHand();

    const target = await startHandDrag();

    expect(
      target.closest(".duel-field-card")?.getAttribute("data-dragging"),
    ).toBe("true");
    expect(candidateZoneIds()).toEqual([
      "p0:mainMonster:0",
      "p0:mainMonster:1",
      "p0:mainMonster:2",
      "p0:mainMonster:3",
      "p0:mainMonster:4",
    ]);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
  });

  it("omits an occupied zone from the halo", async () => {
    renderDraggableHand({ occupiedZoneId: "p0:mainMonster:2" });

    await startHandDrag();

    expect(candidateZoneIds()).not.toContain("p0:mainMonster:2");
    expect(candidateZoneIds()).toHaveLength(4);
  });

  it("does not drag a card that is not in the hand", async () => {
    const value = fieldPrompt("idleCommand", [
      mountedChoice("summon", "Summon monster", { action: "summon" }),
    ]);
    renderInteractive(value);
    const target = screen.getByRole("button", {
      name: /Open actions for The Legendary Fisherman/,
    });

    await fireEvent.pointerDown(target, { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(target, { clientX: 30, clientY: 30 });

    expect(candidateZoneIds()).toEqual([]);
    expect(
      target.closest(".duel-field-card")?.getAttribute("data-dragging"),
    ).toBeNull();
  });

  /* 2026-08-27 item 2 bottom-anchored the chip stack, and the hand zoom overlay
     draws that stack over the lower half of the card it serves — the card's own
     centre included. The chips are hit-testable, so from that moment a press
     meant for the card landed on a chip and no drag ever began. The gesture has
     to survive a press that starts anywhere on the overlay. */
  it("arms the zones for a drag pressed on the hand zoom overlay", async () => {
    const harness = renderDraggableHand();
    await fireEvent.pointerEnter(handCardArticle());
    const chip = handZoomChip("summon");

    await fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(chip, { clientX: 30, clientY: 30 });

    expect(candidateZoneIds()).toEqual([
      "p0:mainMonster:0",
      "p0:mainMonster:1",
      "p0:mainMonster:2",
      "p0:mainMonster:3",
      "p0:mainMonster:4",
    ]);
    expect(dragGhost()).not.toBeNull();
    expect(
      handCardArticle().getAttribute("data-dragging"),
      "the card the overlay serves is the one being dragged",
    ).toBe("true");
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
  });

  it("commits a drag pressed on the hand zoom overlay onto its zone", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    const chip = handZoomChip("summon");
    await fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(chip, { clientX: 30, clientY: 30 });

    harness.setHit(zoneElement("p0:mainMonster:3"));
    await fireEvent.pointerUp(duelFieldRoot(), { clientX: 30, clientY: 30 });

    expect(harness.onplacementintent.mock.calls).toEqual([
      ["p0:mainMonster:3"],
    ]);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "summon",
    });
    expect(candidateZoneIds()).toEqual([]);
  });

  /* The release click of a forwarded drag has no interactive common ancestor
     left — it presses inside the overlay and releases over a zone — so the
     browser hands it to the field root, which `dismissOnOutsideClick` reads as
     dead ground. It must not answer the prompt the drop just answered. */
  it("does not dismiss on the click a forwarded drag releases", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    const chip = handZoomChip("summon");
    await fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(chip, { clientX: 30, clientY: 30 });
    harness.setHit(zoneElement("p0:mainMonster:3"));
    await fireEvent.pointerUp(duelFieldRoot(), { clientX: 30, clientY: 30 });
    harness.dispatch.mockClear();

    await fireEvent.click(duelFieldRoot());

    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("a single-action drop dispatches immediately", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await startHandDrag();

    await dropAt(harness, zoneElement("p0:mainMonster:3"));

    expect(dropConfirmDialog()).toBeNull();

    expect(harness.onplacementintent.mock.calls).toEqual([
      ["p0:mainMonster:3"],
    ]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "summon",
    });
    expect(candidateZoneIds()).toEqual([]);
  });

  it("resolves a hit on the zone's own label to the enclosing zone", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await startHandDrag();
    const label = zoneElement("p0:mainMonster:1").querySelector(
      '[data-cy="zone-control-label-p0:mainMonster:1"]',
    );
    if (label === null) throw new Error("Missing zone label");

    await dropAt(harness, label);

    expect(harness.onplacementintent.mock.calls).toEqual([
      ["p0:mainMonster:1"],
    ]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("never mistakes an action chip that outranks the zones for a drop target", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();
    // Chips sit above the zones in z-order and stay visible while their card
    // is pinned, so a hit test can land on one mid-drag. A chip belongs to no
    // zone, so the gesture must fall through as a miss rather than guess.
    const chip = document.querySelector('[data-cy^="card-action-chip-"]');
    if (chip === null) throw new Error("Missing action chip");
    expect(chip.closest("[data-zone-id]")).toBeNull();

    await dropAt(harness, chip);

    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(candidateZoneIds()).toEqual([]);
  });

  it("cancels a drop outside any zone", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();

    await dropAt(harness, null);

    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(candidateZoneIds()).toEqual([]);
  });

  it("cancels a drop on a zone that is not a candidate", async () => {
    const harness = renderDraggableHand({ occupiedZoneId: "p0:mainMonster:2" });
    await startHandDrag();

    await dropAt(harness, zoneElement("p0:mainMonster:2"));

    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();

    await startHandDrag();
    await dropAt(harness, zoneElement("p0:field"));

    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  /* Item 6: the drop gesture stops guessing. The owner's own example is a
     spell dragged onto an empty backrow zone, where activating it and setting
     it are both legal and the two are not undoable into each other. */
  it("an ambiguous drop opens the confirm modal", async () => {
    const harness = renderDraggableHand({ spellChoices: true });
    await startHandDrag();

    await dropAt(harness, zoneElement("p0:spellTrap:2"));

    expect(dropConfirmDialog()).not.toBeNull();
    // In the preference order, and worded exactly as the card's own chips are.
    expect(
      [...document.querySelectorAll('[data-cy^="drop-confirm-action-"]')].map(
        (button) => button.textContent?.trim(),
      ),
    ).toEqual(["Activate", "Set"]);
    expect(
      document.querySelector('[data-cy="drop-confirm-cancel"]'),
    ).not.toBeNull();
    // Nothing is committed while the question is still on screen.
    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("choosing an action in the modal plays exactly that action", async () => {
    const harness = renderDraggableHand({ spellChoices: true });
    await startHandDrag();
    await dropAt(harness, zoneElement("p0:spellTrap:2"));

    const set = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-action-setspelltrap"]',
    );
    if (set === null) throw new Error("Missing drop confirm set button");
    await fireEvent.click(set);

    expect(harness.onplacementintent.mock.calls).toEqual([["p0:spellTrap:2"]]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "setspelltrap",
    });
    expect(dropConfirmDialog()).toBeNull();
  });

  it("cancelling the modal dispatches nothing", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();
    await dropAt(harness, zoneElement("p0:mainMonster:3"));
    expect(dropConfirmDialog()).not.toBeNull();

    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-cancel"]',
    );
    if (cancel === null) throw new Error("Missing drop confirm cancel button");
    await fireEvent.click(cancel);

    expect(dropConfirmDialog()).toBeNull();
    // "Cancel and return the card to your hand": the game state is untouched,
    // so not even the placement intent may survive the cancelled gesture.
    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("Escape cancels the modal", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();
    await dropAt(harness, zoneElement("p0:mainMonster:3"));
    expect(dropConfirmDialog()).not.toBeNull();

    await fireEvent.keyDown(window, { key: "Escape" });

    expect(dropConfirmDialog()).toBeNull();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  /* Item 4: an activated Spell does not stay in the zone it was dropped on, so
     the board has no honest place to aim the gesture at. Activation gets a
     target of its own beside the hand, mounted only while a card that offers
     one is actually in the air. */
  it("dragging an activatable hand card mounts the dashed activation zone", async () => {
    const harness = renderDraggableHand({ spellChoices: true });

    await startHandDrag();

    expect(
      document.querySelector('[data-cy="hand-activation-drop-zone"]'),
    ).not.toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("a drag with no activate choice mounts no activation zone", async () => {
    renderDraggableHand();

    await startHandDrag();

    expect(
      document.querySelector('[data-cy="hand-activation-drop-zone"]'),
    ).toBeNull();
  });

  /* The zone is a fact about the card's choices, never about the board: a full
     backrow leaves no drop candidate at all, and an activation that needs no
     free zone must stay reachable anyway. */
  it("the activation zone survives a fully occupied backrow", async () => {
    renderDraggableHand({
      spellChoices: true,
      occupiedZoneIds: [
        "p0:spellTrap:0",
        "p0:spellTrap:1",
        "p0:spellTrap:2",
        "p0:spellTrap:3",
        "p0:spellTrap:4",
      ],
    });

    await startHandDrag();

    expect(
      document.querySelector('[data-cy="hand-activation-drop-zone"]'),
    ).not.toBeNull();
    expect(
      candidateZoneIds().filter((zoneId) => zoneId.startsWith("p0:spellTrap:")),
    ).toEqual([]);
  });

  it("dropping on the activation zone asks before activating", async () => {
    const harness = renderDraggableHand({ spellChoices: true });
    await startHandDrag();

    await dropAt(harness, activationZoneElement());

    expect(dropConfirmDialog()).not.toBeNull();
    expect(
      [...document.querySelectorAll('[data-cy^="drop-confirm-action-"]')].map(
        (button) => button.textContent?.trim(),
      ),
    ).toEqual(["Activate"]);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
  });

  /* No placement intent: the engine's own follow-up place prompt, when it asks
     one at all, is answered by the player on the field. Arming `p0:hand` would
     be a claim about where the card is going that nothing supports. */
  it("confirming an activation drop dispatches activate without a placement intent", async () => {
    const harness = renderDraggableHand({ spellChoices: true });
    await startHandDrag();
    await dropAt(harness, activationZoneElement());

    const activate = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-action-activate"]',
    );
    if (activate === null)
      throw new Error("Missing drop confirm activate button");
    await fireEvent.click(activate);

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "activate",
    });
    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(dropConfirmDialog()).toBeNull();
  });

  it("cancelling an activation drop returns the card with nothing sent", async () => {
    const harness = renderDraggableHand({ spellChoices: true });
    await startHandDrag();
    await dropAt(harness, activationZoneElement());

    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-cancel"]',
    );
    if (cancel === null) throw new Error("Missing drop confirm cancel button");
    await fireEvent.click(cancel);

    expect(dropConfirmDialog()).toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
  });

  /* Item 4's broad cancel: an activation is a question even when it is the
     only reading of the gesture, because it cannot be taken back. The zone is
     still real here, so confirming arms it exactly as before. */
  it("a single-activate backrow drop opens the confirm dialog instead of committing", async () => {
    const harness = renderDraggableHand({ activateOnly: true });
    await startHandDrag();

    await dropAt(harness, zoneElement("p0:spellTrap:2"));

    expect(dropConfirmDialog()).not.toBeNull();
    expect(
      [...document.querySelectorAll('[data-cy^="drop-confirm-action-"]')].map(
        (button) => button.textContent?.trim(),
      ),
    ).toEqual(["Activate"]);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.onplacementintent).not.toHaveBeenCalled();

    const activate = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-action-activate"]',
    );
    if (activate === null)
      throw new Error("Missing drop confirm activate button");
    await fireEvent.click(activate);

    expect(harness.onplacementintent.mock.calls).toEqual([["p0:spellTrap:2"]]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "activate",
    });
  });

  /* The drag answers an activation too, but it is no longer the only pointer
     route to one: hover chips carry the full legal set, the pinned menu keeps
     what it always had (ADR-067). */
  it("hand hover chips carry activate, and so does the pinned menu", async () => {
    const harness = renderDraggableHand({ spellChoices: true });

    expect(
      document.querySelector('[data-cy="card-action-chip-setspelltrap"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="card-action-chip-activate"]'),
    ).not.toBeNull();

    await harness.rendered.rerender({
      session: {
        ...createInteractionSession(harness.spec),
        menuTarget: `card:${HAND_CARD_ID}` as const,
      },
    });
    await tick();

    expect(
      document.querySelector('[data-cy="card-action-chip-activate"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="card-action-chip-setspelltrap"]'),
    ).not.toBeNull();
  });

  it("the hand zoom overlay offers the activate chip beside the rest", async () => {
    renderDraggableHand({ spellChoices: true });

    await clickHandCard();

    expect(handZoomOverlay()).not.toBeNull();
    expect(
      document.querySelector(
        '[data-cy="hand-zoom-overlay-card-action-chip-setspelltrap"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-cy="hand-zoom-overlay-card-action-chip-activate"]',
      ),
    ).not.toBeNull();
  });

  /* Item 5 removed the Select chip from the card; the zoom overlay is the same
     card served larger, so it may not smuggle the chip back in. The invisible
     full-cover toggle stays: it is the click/keyboard surface and the only
     `aria-pressed` carrier the selection has. */
  it("the hand zoom overlay offers no chip during a card selection prompt", async () => {
    const valueBoard = board("ST-01");
    const value = fieldPrompt("selectCard", [
      handChoice("select", "Select The Legendary Fisherman"),
    ]);
    const spec = mapPromptToInteractionSpec(
      value,
      BOARD_VIEW_MODEL_FIXTURES["ST-01"],
      valueBoard,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    render(DuelField, {
      board: valueBoard,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
    });

    await fireEvent.pointerEnter(handCardArticle());

    expect(handZoomOverlay()).not.toBeNull();
    expect(
      document.querySelector(
        '[data-cy^="hand-zoom-overlay-card-action-chips-"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-cy="hand-zoom-overlay-card-action-chip-select"]',
      ),
    ).toBeNull();
    expect(handDragTarget().getAttribute("aria-pressed")).toBe("false");
  });

  /* A response is already in flight, so the actions cannot be answered twice —
     but backing out must stay available, because cancelling sends nothing. */
  it("a pending response disables the modal's actions, never its cancel", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();
    await dropAt(harness, zoneElement("p0:mainMonster:3"));
    await harness.rendered.rerender({ pending: true });
    await tick();

    expect(
      [...document.querySelectorAll('[data-cy^="drop-confirm-action-"]')].map(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toEqual([true, true]);
    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-cy="drop-confirm-cancel"]',
    );
    expect(cancel?.disabled).toBe(false);

    if (cancel === null) throw new Error("Missing drop confirm cancel button");
    await fireEvent.click(cancel);

    expect(dropConfirmDialog()).toBeNull();
    expect(harness.onplacementintent).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  /* The choices the modal holds belong to one prompt. If the engine replaces
     that prompt underneath it, confirming would answer the new prompt with a
     dead choice id, so the question has to leave with the prompt that asked
     it. */
  it("a prompt replacement closes the modal without dispatching", async () => {
    const harness = renderDraggableHand();
    await startHandDrag();
    await dropAt(harness, zoneElement("p0:mainMonster:3"));
    expect(dropConfirmDialog()).not.toBeNull();

    const nextPrompt = fieldPrompt(
      "idleCommand",
      [
        handChoice("summon", "Summon The Legendary Fisherman", {
          action: "summon",
        }),
      ],
      { id: promptId("idleCommand-field-component-drop-replacement") },
    );
    const nextSpec = mapPromptToInteractionSpec(
      nextPrompt,
      BOARD_VIEW_MODEL_FIXTURES["ST-01"],
      harness.board,
      CONTEXT,
    );
    if (nextSpec.kind === "inactive")
      throw new Error("Expected active field spec");
    await harness.rendered.rerender({
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
    });
    await tick();

    expect(dropConfirmDialog()).toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("cancels a drag whose pointer was taken away", async () => {
    const harness = renderDraggableHand();
    const target = await startHandDrag();
    expect(candidateZoneIds()).toHaveLength(5);

    await fireEvent.pointerCancel(target);

    expect(candidateZoneIds()).toEqual([]);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(
      target.closest(".duel-field-card")?.getAttribute("data-dragging"),
    ).toBeNull();
  });

  it("mounts a drag ghost only after crossing the 8px threshold", async () => {
    renderDraggableHand();
    const target = handDragTarget();
    await fireEvent.pointerDown(target, { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(target, { clientX: 13, clientY: 10 });
    expect(dragGhost()).toBeNull();

    await fireEvent.pointerMove(target, { clientX: 30, clientY: 30 });
    const ghost = dragGhost();
    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector('[data-cy="drag-ghost-image"]')).not.toBeNull();
  });

  it("coalesces a burst of pointer moves into a single pending frame", async () => {
    const rafStub = stubRaf();
    try {
      renderDraggableHand();
      await startHandDrag();
      const target = handDragTarget();
      expect(rafStub.raf).toHaveBeenCalledTimes(1);
      await fireEvent.pointerMove(target, { clientX: 40, clientY: 30 });
      await fireEvent.pointerMove(target, { clientX: 50, clientY: 30 });
      // The frame from the threshold crossing itself is still pending, so
      // both further moves must coalesce onto it rather than scheduling more.
      expect(rafStub.raf).toHaveBeenCalledTimes(1);
      expect(rafStub.pendingCount()).toBe(1);
    } finally {
      rafStub.restore();
    }
  });

  it("dispatches the single intent/choice immediately, then springs the ghost to the target and unmounts it", async () => {
    const rafStub = stubRaf();
    try {
      const harness = renderDraggableHand({ singleChoice: true });
      await startHandDrag();
      const zone = zoneElement("p0:mainMonster:3");
      vi.spyOn(zone, "getBoundingClientRect").mockReturnValue({
        left: 400,
        top: 300,
        width: 72,
        height: 104,
        right: 472,
        bottom: 404,
        x: 400,
        y: 300,
        toJSON: () => ({}),
      });

      await dropAt(harness, zone);

      // Exactly one placement intent + one chooseChoice, dispatched before
      // any settle frame runs.
      expect(harness.onplacementintent).toHaveBeenCalledTimes(1);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      expect(dragGhost()).not.toBeNull();

      let now = performance.now();
      for (let i = 0; i < 100; i += 1) {
        now += 16;
        rafStub.flush(now);
      }
      await tick();

      expect(dragGhost()).toBeNull();
      // The spring never re-fires the command.
      expect(harness.onplacementintent).toHaveBeenCalledTimes(1);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
    } finally {
      rafStub.restore();
    }
  });

  it("springs a cancelled drag home and unmounts without dispatching", async () => {
    const rafStub = stubRaf();
    try {
      const harness = renderDraggableHand();
      const target = await startHandDrag();
      expect(dragGhost()).not.toBeNull();

      await fireEvent.pointerCancel(target);

      expect(harness.onplacementintent).not.toHaveBeenCalled();
      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(dragGhost()).not.toBeNull();

      let now = performance.now();
      for (let i = 0; i < 100; i += 1) {
        now += 16;
        rafStub.flush(now);
      }
      await tick();

      expect(dragGhost()).toBeNull();
    } finally {
      rafStub.restore();
    }
  });

  it("reduced motion follows the pointer with zero tilt and removes the ghost immediately on release", async () => {
    const rafStub = stubRaf();
    try {
      const harness = renderDraggableHand({ reducedMotion: true });
      const target = await startHandDrag();
      await fireEvent.pointerMove(target, { clientX: 500, clientY: 30 });
      rafStub.flush();
      const ghost = dragGhost();
      expect(ghost).not.toBeNull();
      expect(ghost?.getAttribute("style")).toContain(
        "--drag-ghost-rotate: 0deg",
      );

      await dropAt(harness, null);

      expect(dragGhost()).toBeNull();
    } finally {
      rafStub.restore();
    }
  });

  it("cancels the pending frame and removes the ghost on a prompt replacement", async () => {
    const rafStub = stubRaf();
    try {
      const harness = renderDraggableHand();
      await startHandDrag();
      expect(dragGhost()).not.toBeNull();

      const nextPrompt = fieldPrompt(
        "idleCommand",
        [
          handChoice("summon", "Summon The Legendary Fisherman", {
            action: "summon",
          }),
        ],
        { id: promptId("idleCommand-field-component-replacement") },
      );
      const nextSpec = mapPromptToInteractionSpec(
        nextPrompt,
        BOARD_VIEW_MODEL_FIXTURES["ST-01"],
        harness.board,
        CONTEXT,
      );
      if (nextSpec.kind === "inactive")
        throw new Error("Expected active field spec");
      await harness.rendered.rerender({
        prompt: nextPrompt,
        spec: nextSpec,
        session: createInteractionSession(nextSpec),
      });
      await tick();

      expect(dragGhost()).toBeNull();
    } finally {
      rafStub.restore();
    }
  });

  it("cancels the pending frame and removes the ghost on unmount", async () => {
    const rafStub = stubRaf();
    try {
      const harness = renderDraggableHand();
      await startHandDrag();
      expect(dragGhost()).not.toBeNull();

      harness.rendered.unmount();

      expect(dragGhost()).toBeNull();
    } finally {
      rafStub.restore();
    }
  });

  it("hover reports a visible card", async () => {
    const harness = renderDraggableHand();
    const card = harness.board.cards.find(({ id }) => id === HAND_CARD_ID);
    if (card === undefined) throw new Error("Missing hand fixture card");

    await fireEvent.pointerEnter(handCardArticle());

    expect(harness.onpreview).toHaveBeenCalledTimes(1);
    expect(harness.onpreview).toHaveBeenCalledWith(card);
  });

  it("keeps the caption for a visible card", () => {
    renderDraggableHand();

    expect(
      handCardArticle().querySelector(".duel-field-card__label")?.textContent,
    ).toContain("The Legendary Fisherman");
  });

  it("does not render a visible caption for a hidden card", () => {
    renderDraggableHand();
    const hidden = screen.getAllByRole("article", {
      name: "Hidden opponent hand card",
    })[0];
    if (hidden === undefined) throw new Error("Missing hidden opponent card");

    expect(hidden.getAttribute("aria-label")).toContain("Hidden");
    expect(hidden.querySelector(".duel-field-card__label")).toBeNull();
  });

  it("marks only opponent stacks as opponent-facing", () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    render(DuelField, { board: value.board });

    const playerStack = document.querySelector(
      '.duel-field-stack[data-player="0"]',
    );
    const opponentStack = document.querySelector(
      '.duel-field-stack[data-player="1"]',
    );
    expect(playerStack?.classList.contains("is-opponent")).toBe(false);
    expect(opponentStack?.classList.contains("is-opponent")).toBe(true);
  });

  it("press reports a visible card", async () => {
    const harness = renderDraggableHand();

    await fireEvent.pointerDown(handDragTarget(), { clientX: 10, clientY: 10 });

    expect(harness.onpreview).toHaveBeenCalledTimes(1);
    expect(harness.onpreview.mock.calls[0]?.[0]).toMatchObject({
      id: HAND_CARD_ID,
    });
    // The same `pointerdown` still opens the drag gesture: previewing must not
    // consume the event or disturb the 8px click-suppression origin.
    await fireEvent.pointerMove(handDragTarget(), { clientX: 30, clientY: 30 });
    expect(candidateZoneIds()).toHaveLength(5);
  });

  it("focus reports a visible card", async () => {
    const harness = renderDraggableHand();

    await fireEvent.focusIn(handDragTarget());

    expect(harness.onpreview).toHaveBeenCalledTimes(1);
    expect(harness.onpreview.mock.calls[0]?.[0]).toMatchObject({
      id: HAND_CARD_ID,
    });
  });

  it("hovering a known face-down board card reports code while rendering back art", async () => {
    const base = board("ST-04");
    const hiddenIndex = base.cards.findIndex(
      ({ hidden, zoneId }) => hidden && zoneId.includes("mainMonster"),
    );
    const hidden = base.cards[hiddenIndex];
    if (hidden === undefined) throw new Error("Missing face-down field card");
    const known = {
      ...hidden,
      code: cardCode(5053103),
      label: "Axe Raider in Your Monster Zone 3, face-down attack",
      image: { kind: "back" as const },
    };
    const knownBoard = {
      ...base,
      cards: base.cards.with(hiddenIndex, known),
    };
    const onpreview = vi.fn();
    render(DuelField, {
      board: knownBoard,
      cardBackUrl: "/cards/back.webp",
      onpreview,
    });

    const card = screen.getByRole("article", { name: /Axe Raider.*face-down/ });
    await fireEvent.pointerEnter(card);

    expect(onpreview).toHaveBeenCalledWith(
      expect.objectContaining({ code: 5053103 }),
    );
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "/cards/back.webp",
    );
  });

  it("hovering a face-down field card previews the hidden card", async () => {
    const harness = renderDraggableHand();
    const hidden = screen.getAllByRole("article", {
      name: "Hidden opponent hand card",
    })[0];
    if (hidden === undefined) throw new Error("Missing hidden opponent card");

    await fireEvent.pointerEnter(hidden);

    expect(harness.onpreview).toHaveBeenCalledTimes(1);
    const previewed = harness.onpreview.mock.calls[0]?.[0];
    expect(previewed).toMatchObject({
      id: hidden.getAttribute("data-card-id"),
    });
    expect(previewed?.code).toBeUndefined();
  });

  it("hovering a stack previews it", async () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    const onstackpreview = vi.fn();
    render(DuelField, { board: value.board, onstackpreview });

    const stack = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (stack === null) throw new Error("Missing graveyard stack");
    await fireEvent.pointerEnter(stack);

    expect(onstackpreview).toHaveBeenCalledTimes(1);
    expect(onstackpreview.mock.calls[0]?.[0]).toMatchObject({
      id: "p0:graveyard",
    });
  });

  it("hidden cards report the hidden preview too", async () => {
    const harness = renderDraggableHand();
    const hidden = screen.getAllByRole("article", {
      name: "Hidden opponent hand card",
    })[0];
    if (hidden === undefined) throw new Error("Missing hidden opponent card");

    await fireEvent.pointerEnter(hidden);
    await fireEvent.focusIn(hidden);

    expect(harness.onpreview).toHaveBeenCalledTimes(2);
    for (const call of harness.onpreview.mock.calls) {
      expect(call[0]).toMatchObject({
        id: hidden.getAttribute("data-card-id"),
      });
      expect(call[0]?.code).toBeUndefined();
    }
  });

  it("pointer leave keeps the panel", async () => {
    const harness = renderDraggableHand();
    const article = handCardArticle();
    await fireEvent.pointerEnter(article);

    await fireEvent.pointerLeave(article);
    await fireEvent.pointerOut(article);

    // There is no clear path at all: leaving fires nothing, and every call the
    // field ever makes carries a card, never a null that would blank the panel.
    expect(harness.onpreview).toHaveBeenCalledTimes(1);
    expect(
      harness.onpreview.mock.calls.every(([value]) => value !== null),
    ).toBe(true);
  });

  /* The overlay used to read a map no caller ever filled, so it rendered the
     "Image unavailable" placeholder over a card whose art was already on the
     board. The guard belongs here, at the seam that broke: the overlay's own
     tests pass the library directly. */
  it("hovering a known hand card zooms its leased art, never the placeholder", async () => {
    const release = vi.fn<() => void>();
    const lease = vi.fn<(code: number) => { url: string; release: () => void }>(
      (code) => ({ url: `blob:zoom-${code}`, release }),
    );
    renderDraggableHand({ imageLibrary: { lease } });

    await fireEvent.pointerEnter(handCardArticle());

    expect(
      document
        .querySelector('[data-cy^="hand-zoom-overlay-image-"]')
        ?.getAttribute("src"),
    ).toBe("blob:zoom-97590747");
    expect(lease).toHaveBeenCalledWith(97590747);
  });

  it("hovering a known hand card mounts the zoom overlay with its actions above", async () => {
    renderDraggableHand();
    const article = handCardArticle();
    await fireEvent.pointerEnter(article);
    const overlay = document.querySelector('[data-cy^="hand-zoom-overlay-"]');
    expect(overlay).not.toBeNull();
    expect(
      overlay!.querySelector(
        '[data-cy^="hand-zoom-overlay-card-action-chips-"]',
      ),
    ).not.toBeNull();
    await fireEvent.pointerLeave(article);
    expect(
      document.querySelector('[data-cy^="hand-zoom-overlay-"]'),
    ).toBeNull();
  });

  /* Item 3: a pinned hand card used to show two chip sets — the overlay's
     stack and its own in-band copy, revealed by the focus the click left
     inside the card. `is-zoom-served` is the CSS's only way to know the
     overlay is currently serving this card, so it is asserted here rather
     than through a computed style jsdom does not resolve. */
  it("marks the hovered hand card as zoom-served while the overlay is mounted", async () => {
    renderDraggableHand();
    const article = handCardArticle();

    await fireEvent.pointerEnter(article);
    expect(handCardArticle().classList.contains("is-zoom-served")).toBe(true);

    await fireEvent(
      article,
      new MouseEvent("pointerleave", {
        relatedTarget: document.querySelector('[data-cy="duel-field"]'),
      }),
    );

    expect(handCardArticle().classList.contains("is-zoom-served")).toBe(false);
  });

  it("a pinned hand card is zoom-served and keeps only the overlay's chip copy revealed", async () => {
    renderDraggableHand();
    await fireEvent.pointerEnter(handCardArticle());

    await clickHandCard();

    expect(handZoomOverlay()).not.toBeNull();
    expect(handCardArticle().classList.contains("is-zoom-served")).toBe(true);
    // Mounted, merely hidden: dismissal is a visibility claim, never a count.
    expect(
      handCardArticle().querySelector('[data-cy^="card-action-chips-"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-cy^="hand-zoom-overlay-card-action-chips-"]',
      ),
    ).not.toBeNull();
  });

  it("the keyboard pin never marks the hand card zoom-served", async () => {
    const user = userEvent.setup();
    renderDraggableHand();
    handDragTarget().focus();

    await user.keyboard("{Enter}");

    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-zoom-served")).toBe(false);
  });

  /* The round-4 strobe: the overlay is anchored on the card's bottom edge, so
     it is drawn over the card that opened it. A crossing into it reports the
     card's own `pointerleave`, and closing on that alone unmounts the overlay
     before the pointer can ever be reported as being on it — which puts the
     pointer back on the card, which reopens it, ~30 times a second. */
  it("a pointer crossing from the hand card onto the overlay keeps that overlay mounted", async () => {
    renderDraggableHand();
    const article = handCardArticle();
    await fireEvent.pointerEnter(article);
    const overlay = document.querySelector('[data-cy^="hand-zoom-overlay-"]');
    expect(overlay).not.toBeNull();
    const overlayArt = overlay!.querySelector(
      '[data-cy^="hand-zoom-overlay-image-"]',
    );
    expect(overlayArt).not.toBeNull();

    /* Built by hand rather than through `fireEvent.pointerLeave`: jsdom ships
       no `PointerEvent`, so the helper degrades to an event carrying no
       `relatedTarget` — the one field under test here. */
    await fireEvent(
      article,
      new MouseEvent("pointerleave", { relatedTarget: overlayArt }),
    );

    // Same node, not merely a node: a remount is exactly what strobes.
    expect(document.querySelector('[data-cy^="hand-zoom-overlay-"]')).toBe(
      overlay,
    );
  });

  it("leaving the hand card for anything outside the overlay still closes it", async () => {
    renderDraggableHand();
    const article = handCardArticle();
    await fireEvent.pointerEnter(article);
    expect(document.querySelector('[data-cy^="hand-zoom-overlay-"]')).not.toBe(
      null,
    );

    await fireEvent(
      article,
      new MouseEvent("pointerleave", {
        relatedTarget: document.querySelector('[data-cy="duel-field"]'),
      }),
    );

    expect(
      document.querySelector('[data-cy^="hand-zoom-overlay-"]'),
    ).toBeNull();
  });

  it("the open overlay leaves every data-cy in the document unique", async () => {
    renderDraggableHand();
    await fireEvent.pointerEnter(handCardArticle());
    expect(document.querySelector('[data-cy^="hand-zoom-overlay-"]')).not.toBe(
      null,
    );

    const seen = new Map<string, number>();
    for (const element of document.querySelectorAll("[data-cy]")) {
      const value = element.getAttribute("data-cy") ?? "";
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }

    expect([...seen].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("an unknown hand card never mounts the zoom overlay", async () => {
    renderDraggableHand();
    const opponentCard = document.querySelector<HTMLElement>(
      ".duel-field-card.is-opponent",
    );
    if (opponentCard === null) throw new Error("Missing opponent hand card");
    await fireEvent.pointerEnter(opponentCard);
    expect(
      document.querySelector('[data-cy^="hand-zoom-overlay-"]'),
    ).toBeNull();
  });

  it("projects legal halo onto hovered actionable hand card zoom", async () => {
    renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());

    expect(handZoomOverlay()?.classList.contains("is-legal")).toBe(true);
    expect(handZoomOverlay()?.classList.contains("is-selected")).toBe(false);
  });

  /* Item 4: a pointer click on a hand card freezes its zoom and its action
     list where they stand instead of answering the prompt. Only a chip in
     that list — or a drag — commits the play. */
  it("clicking a hand card with one action pins instead of committing", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());

    await clickHandCard();

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(handZoomOverlay()).not.toBeNull();
    // Both halves carry the orange selected halo: the card is the one the
    // requirement names, and the overlay is the one the player can see, since
    // it covers the card's own art at 1.6x.
    expect(handCardArticle().classList.contains("is-selected")).toBe(true);
    expect(handZoomOverlay()?.classList.contains("is-selected")).toBe(true);
  });

  /* The pin is navigation state, not an answer, so the in-flight gate leaves
     it alone: its halo survives a submission the player did not make with it. */
  it("keeps the pinned hand halo while a submission is in flight", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();
    expect(handCardArticle().classList.contains("is-selected")).toBe(true);

    const submitting = reduceInteractionSession(
      createInteractionSession(harness.spec),
      harness.spec,
      { type: "submissionAccepted", key: harness.spec.key },
    ).session;
    await harness.rendered.rerender({ session: submitting });

    expect(handCardArticle().classList.contains("is-selected")).toBe(true);
    expect(handZoomOverlay()?.classList.contains("is-selected")).toBe(true);
  });

  it("clicking the pinned card again cancels", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();
    expect(handZoomOverlay()).not.toBeNull();

    await clickHandCard();

    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-selected")).toBe(false);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  /* The two-choice hand card, which used to answer this click with an
     `openMenu`: the pin replaces that dispatch too, not only the single-choice
     commit. */
  it("clicking outside cancels the pin without answering the prompt", async () => {
    const harness = renderDraggableHand();
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();
    expect(handZoomOverlay()).not.toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();

    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await fireEvent.pointerDown(surface);
    await fireEvent.click(surface);

    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-selected")).toBe(false);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("Escape cancels the pin", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();

    await fireEvent.keyDown(document, { key: "Escape" });

    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-selected")).toBe(false);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("clicking an action commits it and unpins", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-cy="hand-zoom-overlay-card-action-chip-summon"]',
    );
    if (chip === null) throw new Error("Missing pinned hand zoom action chip");
    await fireEvent.pointerDown(chip);
    await fireEvent.click(chip);

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "summon",
    });
    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-selected")).toBe(false);
  });

  it("pointer leaving does not cancel a pinned zoom", async () => {
    renderDraggableHand();
    const article = handCardArticle();
    await fireEvent.pointerEnter(article);
    await clickHandCard();
    const overlay = handZoomOverlay();
    expect(overlay).not.toBeNull();

    await fireEvent(
      article,
      new MouseEvent("pointerleave", {
        relatedTarget: document.querySelector('[data-cy="duel-field"]'),
      }),
    );

    // Same node, not merely a node: the pin freezes this overlay in place.
    expect(handZoomOverlay()).toBe(overlay);
  });

  it("dragging a pinned card still commits by drop", async () => {
    const harness = renderDraggableHand({ singleChoice: true });
    await fireEvent.pointerEnter(handCardArticle());
    await clickHandCard();
    expect(handZoomOverlay()).not.toBeNull();

    await startHandDrag();
    await dropAt(harness, zoneElement("p0:mainMonster:3"));

    expect(harness.onplacementintent.mock.calls).toEqual([
      ["p0:mainMonster:3"],
    ]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "chooseChoice",
      choiceId: "summon",
    });
    expect(handZoomOverlay()).toBeNull();
    expect(handCardArticle().classList.contains("is-selected")).toBe(false);
  });

  /* ADR-032 §4: the overlay stays pointer-only. Enter on a focused hand card
     keeps the in-band pin/focus menu, which is the keyboard's only route to a
     hand card's actions — its chips carry `tabindex=-1` and are reachable
     solely through the pin that moves focus into them. */
  it("keyboard activation still opens the hand card's pinned chip menu", async () => {
    const user = userEvent.setup();
    const harness = renderDraggableHand();
    const target = handDragTarget();
    target.focus();

    await user.keyboard("{Enter}");

    expect(harness.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "openMenu",
      target: target.getAttribute("data-field-target"),
    });
    expect(handZoomOverlay()).toBeNull();
  });

  /* Feedback item 1: `.duel-field-hand-band__viewport` clips on the y axis, so
     nothing mounted inside the band can grow past it whatever its z-index. The
     fixed-position overlay is the only escape there is, and a selection has to
     reach it the same way a hover does — the player picking a tribute must see
     the card they picked, not a halo cropped by the band. */
  it("a selected hand card floats over the field with the pointer elsewhere", async () => {
    const harness = renderHandSelection();

    await selectHandTarget(0);

    expect(handZoomOverlay()?.getAttribute("data-cy")).toBe(
      `hand-zoom-overlay-${HAND_CARD_ID}`,
    );
    expect(handZoomOverlay()?.classList.contains("is-selected")).toBe(true);
    expect(harness.getSession().selectedChoiceIds).toEqual(["select-first"]);
  });

  /* Pointer intent beats a state display: the hovered card is the one the
     player is asking about right now, and the selected one returns to the
     overlay the moment that question ends. */
  it("a hovered hand card outranks the selected one and hands it back on leave", async () => {
    renderHandSelection();
    await selectHandTarget(0);

    await fireEvent.pointerEnter(cardArticle(SECOND_HAND_CARD_ID));

    expect(handZoomOverlay()?.getAttribute("data-cy")).toBe(
      `hand-zoom-overlay-${SECOND_HAND_CARD_ID}`,
    );
    expect(handZoomOverlay()?.classList.contains("is-selected")).toBe(false);

    await fireEvent(
      cardArticle(SECOND_HAND_CARD_ID),
      new MouseEvent("pointerleave", { relatedTarget: duelFieldRoot() }),
    );

    expect(handZoomOverlay()?.getAttribute("data-cy")).toBe(
      `hand-zoom-overlay-${HAND_CARD_ID}`,
    );
  });

  it("deselecting the hand card takes its floating overlay away", async () => {
    renderHandSelection();
    await selectHandTarget(0);
    expect(handZoomOverlay()).not.toBeNull();

    await selectHandTarget(0);

    expect(handZoomOverlay()).toBeNull();
  });

  /* A multi-pick prompt carries no ordering of its own — `selectedChoiceIds` is
     rebuilt in prompt order on every toggle — so the overlay serves the card
     the last toggle added, and the older pick keeps its in-band halo. */
  it("a second selection moves the floating overlay onto the newer card", async () => {
    renderHandSelection();

    await selectHandTarget(0);
    await selectHandTarget(1);

    expect(handZoomOverlay()?.getAttribute("data-cy")).toBe(
      `hand-zoom-overlay-${SECOND_HAND_CARD_ID}`,
    );
    expect(cardArticle(HAND_CARD_ID).classList.contains("is-selected")).toBe(
      true,
    );
  });

  it("duel field no longer renders life pills", () => {
    const value = DUEL_FIELD_PUBLIC_STATES["ST-01"];
    render(DuelField, { board: value.board });
    const field = screen.getByRole("region", { name: "Duel field" });
    expect(field.querySelector('[data-cy="life-pill-p0"]')).toBeNull();
    expect(field.querySelector('[data-cy="life-pill-p1"]')).toBeNull();
  });

  function renderGraveyardTargetPrompt(value: BoardViewModel): void {
    const prompt = fieldPrompt("chain", [
      mountedChoice("graveyard-activate", "Activate", {
        card: {
          instanceId: cardInstanceId("prompt-graveyard-activate"),
          controller: 0,
          location: "graveyard",
          sequence: 0,
          position: "faceUpAttack",
        },
      } as Partial<PromptChoice>),
      promptChoice("pass-choice", "Pass", { action: "pass" }),
    ]);
    const spec = activeSpec(prompt);
    render(DuelField, {
      board: value,
      prompt,
      spec,
      session: createInteractionSession(spec),
      pending: false,
    });
  }

  /* Item 12 regression lock: the halo is gated on the active prompt
     offering a stack choice — no prompt, no halo, on any pile. */
  it("no stack wears the halo without a stack choice in the active prompt", () => {
    render(DuelField, { board: board("ST-05") });
    expect(
      document.querySelectorAll(".duel-field-stack.is-actionable").length,
    ).toBe(0);
  });

  it("actionable stack renders the halo when the pile shows what it holds", () => {
    const stackBoard = mapSnapshotToBoard(
      TWO_CARD_GRAVEYARD_STATE,
      BOARD_CARD_TEXTS,
    );
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    renderGraveyardTargetPrompt(stackBoard.value);

    const stack = document.querySelector(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    expect(stack).not.toBeNull();
    expect(stack?.classList.contains("is-actionable")).toBe(true);
    expect(stack?.getAttribute("data-actionable")).toBe("true");
    expect(document.querySelector('[data-cy="prompt-dialog"]')).toBeNull();
  });

  /* Item 12 (2026-08-27): an actionable pile wears the halo whether or not it
     renders its top card — the prompt offering a choice there is the signal,
     not the visible art. Deck/extra/face-down banish included. */
  it("actionable stack keeps the halo even when it shows nothing", () => {
    renderGraveyardTargetPrompt(board("ST-05"));

    const stack = document.querySelector(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    expect(stack).not.toBeNull();
    expect(stack?.classList.contains("is-actionable")).toBe(true);
    expect(stack?.getAttribute("data-actionable")).toBe("true");
  });

  it("maps an engine deck sequence to the matching top-relative list slot", async () => {
    const user = userEvent.setup();
    const snapshot = BOARD_VIEW_MODEL_FIXTURES["ST-05"];
    const stackBoard = mapSnapshotToBoard(snapshot, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const deckCount = snapshot.players[0].deckCount;
    const topRelativeOffset = 1;
    const value = fieldPrompt("idleCommand", [
      promptChoice("deck-activate", "Activate deck card", {
        action: "activate",
        card: {
          instanceId: cardInstanceId("prompt-deck-activate"),
          controller: 0,
          location: "deck",
          sequence: deckCount - 1 - topRelativeOffset,
          position: "faceDownAttack",
        },
      }),
    ]);
    const spec = mapPromptToInteractionSpec(
      value,
      snapshot,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        snapshot,
        BOARD_CARD_TEXTS,
      ),
    });

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(`Your Deck, ${deckCount} cards`),
      }),
    );
    const expectedEntry = document.querySelector<HTMLElement>(
      `[data-cy="zone-list-entry-p0:deck:${topRelativeOffset + 1}"]`,
    );
    if (expectedEntry === null) throw new Error("Missing expected deck entry");

    expect(
      within(expectedEntry).getByRole("button", {
        name: "Activate deck card",
      }),
    ).not.toBeNull();
  });

  it("answers a forced chain whose only source sits in a pile", async () => {
    const user = userEvent.setup();
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const value = fieldPrompt(
      "chain",
      [
        mountedChoice("graveyard-activate", "Chain", {
          card: {
            instanceId: cardInstanceId("prompt-graveyard-activate"),
            controller: 0,
            location: "graveyard",
            sequence: 0,
            position: "faceUpAttack",
          },
        } as Partial<PromptChoice>),
      ],
      { cancelable: false },
    );
    const spec = mapPromptToInteractionSpec(
      value,
      STACK_ART_STATE,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const oninteraction = vi.fn();
    render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        STACK_ART_STATE,
        BOARD_CARD_TEXTS,
      ),
      oninteraction,
    });

    await user.click(
      screen.getByRole("button", { name: /Your Graveyard, 4 cards/ }),
    );
    await user.click(screen.getByRole("button", { name: "Chain" }));

    expect(oninteraction).toHaveBeenCalledWith({
      type: "chooseChoice",
      choiceId: choiceId("graveyard-activate"),
      key: spec.key,
    });
  });

  it("an empty graveyard stays a non-interactive div", () => {
    const value = fieldPrompt("chain", [
      mountedChoice("graveyard-activate", "Activate", {
        card: {
          instanceId: cardInstanceId("prompt-graveyard-activate"),
          controller: 0,
          location: "graveyard",
          sequence: 0,
          position: "faceUpAttack",
        },
      } as Partial<PromptChoice>),
      promptChoice("pass-choice", "Pass", { action: "pass" }),
    ]);
    const spec = activeSpec(value);
    const session = createInteractionSession(spec);
    const oninteraction = vi.fn();
    render(DuelField, {
      board: board("ST-05"),
      prompt: value,
      spec,
      session,
      pending: false,
      oninteraction,
    });

    const stack = document.querySelector(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    expect(stack).not.toBeNull();
    expect(stack?.tagName).toBe("DIV");
    expect(stack?.getAttribute("role")).toBe("group");
    expect(stack?.hasAttribute("onclick")).toBe(false);

    (stack as HTMLElement).click();

    expect(oninteraction).not.toHaveBeenCalled();
  });

  it("graveyard shows its last public card", () => {
    const lease = vi.fn((code: number) => ({
      url: `blob:${code}`,
      release: vi.fn(),
    }));
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    render(DuelField, {
      board: stackBoard.value,
      imageLibrary: { lease },
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(
      document
        .querySelector('[data-cy="stack-control-image-p0:graveyard"]')
        ?.getAttribute("src"),
    ).toBe("blob:89631139");
    expect(
      document.querySelector('[data-cy="stack-control-name-p0:graveyard"]')
        ?.textContent,
    ).toBe("GY");
    expect(
      document.querySelector('[data-cy="stack-control-count-p0:graveyard"]')
        ?.textContent,
    ).toBe("4");
  });

  it("banished shows its last public card", () => {
    const lease = vi.fn((code: number) => ({
      url: `blob:${code}`,
      release: vi.fn(),
    }));
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    render(DuelField, {
      board: stackBoard.value,
      imageLibrary: { lease },
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(
      document.querySelector('[data-cy="stack-control-image-p0:banished"]'),
    ).not.toBeNull();
  });

  it("an empty pile shows no art", () => {
    const lease = vi.fn((code: number) => ({
      url: `blob:${code}`,
      release: vi.fn(),
    }));
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    render(DuelField, {
      board: stackBoard.value,
      imageLibrary: { lease },
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(
      document.querySelector('[data-cy="stack-control-art-p1:graveyard"]'),
    ).toBeNull();
  });

  it("the deck never shows art", () => {
    const lease = vi.fn((code: number) => ({
      url: `blob:${code}`,
      release: vi.fn(),
    }));
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    render(DuelField, {
      board: stackBoard.value,
      imageLibrary: { lease },
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(
      document.querySelector('[data-cy="stack-control-art-p0:deck"]'),
    ).toBeNull();
  });

  it("the lease is released on destroy", () => {
    const release = vi.fn();
    const lease = vi.fn((code: number) => ({
      url: `blob:${code}`,
      release,
    }));
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const rendered = render(DuelField, {
      board: stackBoard.value,
      imageLibrary: { lease },
      placeholderUrl: "/cards/placeholder.webp",
    });

    expect(
      document.querySelector('[data-cy="stack-control-art-p0:graveyard"]'),
    ).not.toBeNull();
    rendered.unmount();

    expect(release).toHaveBeenCalledTimes(2);
  });

  it("clicking a pile opens its list", async () => {
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const zoneLists = zoneListsForBoard(
      stackBoard.value,
      STACK_ART_STATE,
      BOARD_CARD_TEXTS,
    );
    render(DuelField, { board: stackBoard.value, zoneLists });

    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
    const stack = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (stack === null) throw new Error("Missing graveyard stack");
    await fireEvent.click(stack);

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
  });

  it("Escape closes a pile list opened with the mouse", async () => {
    const user = userEvent.setup();
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const zoneLists = zoneListsForBoard(
      stackBoard.value,
      STACK_ART_STATE,
      BOARD_CARD_TEXTS,
    );
    render(DuelField, { board: stackBoard.value, zoneLists });
    const stack = screen.getByRole("button", {
      name: /Your Graveyard, 4 cards/,
    });

    await user.click(stack);
    expect(document.activeElement).toBe(stack);
    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    await fireEvent.keyDown(document, { key: "Escape" });

    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  it("clicking the same pile closes it", async () => {
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const zoneLists = zoneListsForBoard(
      stackBoard.value,
      STACK_ART_STATE,
      BOARD_CARD_TEXTS,
    );
    render(DuelField, { board: stackBoard.value, zoneLists });
    const stack = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (stack === null) throw new Error("Missing graveyard stack");
    await fireEvent.click(stack);
    await fireEvent.click(stack);

    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  it("an empty pile is not clickable", () => {
    const stackBoard = mapSnapshotToBoard(STACK_ART_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    render(DuelField, { board: stackBoard.value });

    const stack = document.querySelector('[data-cy="field-stack-p1:banished"]');
    expect(stack?.tagName).toBe("DIV");
  });

  it("a new prompt closes an open list", async () => {
    const valueBoard = board("ST-05");
    const firstPrompt = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate effect", { action: "activate" }),
    ]);
    const firstSpec = activeSpec(firstPrompt);
    const zoneLists = zoneListsForBoard(
      valueBoard,
      BOARD_VIEW_MODEL_FIXTURES["ST-05"],
      BOARD_CARD_TEXTS,
    );
    const rendered = render(DuelField, {
      board: valueBoard,
      prompt: firstPrompt,
      spec: firstSpec,
      session: createInteractionSession(firstSpec),
      pending: false,
      zoneLists,
    });
    const stack = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:deck"]',
    );
    if (stack === null) throw new Error("Missing deck stack");
    await fireEvent.click(stack);

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();

    const nextPrompt = fieldPrompt("selectCard", [
      mountedChoice("select", "Select monster"),
    ]);
    const nextSpec = activeSpec(nextPrompt);
    await rendered.rerender({
      board: valueBoard,
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
      pending: false,
      zoneLists,
    });

    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  /* T14/ADR-017: the zone list and the confirm surface are two independent
     windows over the still field root. T16 moved off-field confirmation into
     the target list itself, so this suite selects a mounted monster: an
     on-field-only multi selection is what still owns a separate window. */
  function renderWindows(
    overrides: {
      readonly zoneListWindowPosition?: { x: number; y: number } | null;
      readonly confirmWindowPosition?: { x: number; y: number } | null;
    } = {},
  ) {
    const stackBoard = mapSnapshotToBoard(WINDOW_STATE, BOARD_CARD_TEXTS);
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const value = fieldPrompt(
      "selectCard",
      [mountedChoice("monster-select", "Select")],
      { cancelable: true, minimum: 1, maximum: 2 },
    );
    const spec = mapPromptToInteractionSpec(
      value,
      WINDOW_STATE,
      stackBoard.value,
      CONTEXT,
    );
    if (spec.kind === "inactive") throw new Error("Expected active field spec");
    const oninteraction = vi.fn();
    const onzoneListWindowPositionChange = vi.fn();
    const onconfirmWindowPositionChange = vi.fn();
    const rendered = render(DuelField, {
      board: stackBoard.value,
      prompt: value,
      spec,
      session: createInteractionSession(spec),
      pending: false,
      zoneLists: zoneListsForBoard(
        stackBoard.value,
        WINDOW_STATE,
        BOARD_CARD_TEXTS,
      ),
      oninteraction,
      zoneListWindowPosition: overrides.zoneListWindowPosition ?? null,
      confirmWindowPosition: overrides.confirmWindowPosition ?? null,
      onzoneListWindowPositionChange,
      onconfirmWindowPositionChange,
    });
    return {
      rendered,
      spec,
      board: stackBoard.value,
      prompt: value,
      oninteraction,
      onzoneListWindowPositionChange,
      onconfirmWindowPositionChange,
    };
  }

  async function openGraveyardList(): Promise<void> {
    const stack = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (stack === null) throw new Error("Missing graveyard stack");
    await fireEvent.click(stack);
  }

  function windowRoot(id: "zoneList" | "confirm"): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `[data-cy="floating-field-window-${id}"]`,
    );
  }

  it("renders both windows at their own persisted positions", async () => {
    renderWindows({
      zoneListWindowPosition: { x: 12, y: 34 },
      confirmWindowPosition: { x: 56, y: 78 },
    });
    await openGraveyardList();

    const list = windowRoot("zoneList");
    const confirm = windowRoot("confirm");
    expect(list?.style.getPropertyValue("--window-x")).toBe("12px");
    expect(list?.style.getPropertyValue("--window-y")).toBe("34px");
    expect(confirm?.style.getPropertyValue("--window-x")).toBe("56px");
    expect(confirm?.style.getPropertyValue("--window-y")).toBe("78px");
  });

  it("each window reports only its own position", async () => {
    const harness = renderWindows({
      zoneListWindowPosition: { x: 10, y: 10 },
      confirmWindowPosition: { x: 20, y: 20 },
    });
    await openGraveyardList();

    const listHandle = document.querySelector<HTMLElement>(
      '[data-cy="floating-field-window-zoneList-handle"]',
    );
    const confirmHandle = document.querySelector<HTMLElement>(
      '[data-cy="floating-field-window-confirm-handle"]',
    );
    if (listHandle === null || confirmHandle === null)
      throw new Error("Missing window handle");

    await fireEvent.pointerDown(listHandle, {
      clientX: 40,
      clientY: 40,
      pointerId: 1,
    });
    await fireEvent.pointerMove(listHandle, {
      clientX: 60,
      clientY: 50,
      pointerId: 1,
    });
    await fireEvent.pointerUp(listHandle, {
      clientX: 60,
      clientY: 50,
      pointerId: 1,
    });

    expect(harness.onzoneListWindowPositionChange).toHaveBeenCalledTimes(1);
    expect(harness.onzoneListWindowPositionChange).toHaveBeenCalledWith({
      x: 30,
      y: 20,
    });
    expect(harness.onconfirmWindowPositionChange).not.toHaveBeenCalled();
    expect(windowRoot("zoneList")?.classList.contains("is-active")).toBe(true);
    expect(windowRoot("confirm")?.classList.contains("is-active")).toBe(false);

    await fireEvent.pointerDown(confirmHandle, {
      clientX: 40,
      clientY: 40,
      pointerId: 2,
    });
    await fireEvent.pointerMove(confirmHandle, {
      clientX: 45,
      clientY: 60,
      pointerId: 2,
    });
    await fireEvent.pointerUp(confirmHandle, {
      clientX: 45,
      clientY: 60,
      pointerId: 2,
    });

    expect(harness.onconfirmWindowPositionChange).toHaveBeenCalledTimes(1);
    expect(harness.onconfirmWindowPositionChange).toHaveBeenCalledWith({
      x: 25,
      y: 40,
    });
    expect(harness.onzoneListWindowPositionChange).toHaveBeenCalledTimes(1);
    expect(windowRoot("confirm")?.classList.contains("is-active")).toBe(true);
    // Pressing the confirm window counts as outside the list, so the list is
    // gone by now while the confirm window keeps the live decision.
    expect(windowRoot("zoneList")).toBeNull();
  });

  it("an outside press closes the list only and answers nothing", async () => {
    const user = userEvent.setup();
    const harness = renderWindows();
    await openGraveyardList();
    expect(windowRoot("zoneList")).not.toBeNull();

    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await user.click(surface);

    expect(windowRoot("zoneList")).toBeNull();
    expect(windowRoot("confirm")).not.toBeNull();
    expect(harness.oninteraction).not.toHaveBeenCalled();
  });

  it("pressing the confirm window closes the list but keeps the decision", async () => {
    const harness = renderWindows();
    await openGraveyardList();

    const confirmWindow = windowRoot("confirm");
    if (confirmWindow === null) throw new Error("Missing confirm window");
    await fireEvent.pointerDown(confirmWindow);

    expect(windowRoot("zoneList")).toBeNull();
    expect(windowRoot("confirm")).not.toBeNull();
    expect(harness.oninteraction).not.toHaveBeenCalled();
  });

  it("Escape closes the list only", async () => {
    const harness = renderWindows();
    await openGraveyardList();

    await fireEvent.keyDown(document, { key: "Escape" });

    expect(windowRoot("zoneList")).toBeNull();
    expect(windowRoot("confirm")).not.toBeNull();
    expect(harness.oninteraction).not.toHaveBeenCalled();
  });

  it("keeps Cancel and Confirm reducer-owned inside the confirm window", async () => {
    const user = userEvent.setup();
    const harness = renderWindows();

    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-cy="field-action-bar-cancel"]',
    );
    if (cancel === null) throw new Error("Missing cancel button");
    await user.click(cancel);

    expect(harness.oninteraction).toHaveBeenCalledTimes(1);
    expect(harness.oninteraction.mock.calls[0]?.[0]).toMatchObject({
      type: "cancel",
      key: harness.spec.key,
    });
  });

  it("a replacement prompt closes both window surfaces and clears the raised window", async () => {
    const harness = renderWindows();
    await openGraveyardList();
    const listHandle = document.querySelector<HTMLElement>(
      '[data-cy="floating-field-window-zoneList-handle"]',
    );
    if (listHandle === null) throw new Error("Missing list handle");
    await fireEvent.pointerDown(listHandle, {
      clientX: 10,
      clientY: 10,
      pointerId: 5,
    });
    await fireEvent.pointerUp(listHandle, {
      clientX: 10,
      clientY: 10,
      pointerId: 5,
    });
    expect(windowRoot("zoneList")?.classList.contains("is-active")).toBe(true);

    const nextPrompt = fieldPrompt("idleCommand", [
      promptChoice("end", "End turn", { action: "endPhase" }),
    ]);
    const nextSpec = mapPromptToInteractionSpec(
      nextPrompt,
      WINDOW_STATE,
      harness.board,
      CONTEXT,
    );
    if (nextSpec.kind === "inactive")
      throw new Error("Expected active field spec");
    await harness.rendered.rerender({
      board: harness.board,
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
      pending: false,
    });

    expect(windowRoot("zoneList")).toBeNull();
    expect(windowRoot("confirm")).toBeNull();

    await openGraveyardList();
    expect(windowRoot("zoneList")?.classList.contains("is-active")).toBe(true);
  });

  it("the field flags an active targeting prompt", () => {
    const selectionPrompt = fieldPrompt("selectCard", [
      mountedChoice("select", "Select"),
    ]);
    const selectionSpec = activeSpec(selectionPrompt);
    render(DuelField, {
      board: board("ST-05"),
      prompt: selectionPrompt,
      spec: selectionSpec,
      session: createInteractionSession(selectionSpec),
    });
    expect(
      document
        .querySelector('[data-cy="duel-field"]')
        ?.getAttribute("data-targeting"),
    ).toBe("true");

    cleanup();

    const actionPrompt = fieldPrompt("idleCommand", [
      mountedChoice("activate", "Activate"),
    ]);
    const actionSpec = activeSpec(actionPrompt);
    render(DuelField, {
      board: board("ST-05"),
      prompt: actionPrompt,
      spec: actionSpec,
      session: createInteractionSession(actionSpec),
    });
    expect(
      document
        .querySelector('[data-cy="duel-field"]')
        ?.hasAttribute("data-targeting"),
    ).toBe(false);
  });
});

/* T16: every legal off-field target of one prompt in a single window. */
describe("DuelField off-field target list", () => {
  const TARGET_STATE: PublicDuelState = {
    snapshotId: snapshotId("c".repeat(64)),
    revision: 2,
    turn: 3,
    turnPlayer: 0,
    phase: "main1",
    layout: { extraMonsterZones: true },
    players: [
      {
        player: 0,
        lifePoints: 8000,
        deckCount: 3,
        deck: [
          publicStateCard("target-deck-0", 97590747, 0, "deck", 0),
          publicStateCard("target-deck-1", 5053103, 0, "deck", 1),
          publicStateCard("target-deck-2", 89631139, 0, "deck", 2),
        ],
        extraDeckCount: 0,
        handCount: 2,
        hand: [
          publicStateCard("target-hand-0", 97590747, 0, "hand", 0),
          publicStateCard("target-hand-1", 5053103, 0, "hand", 1),
        ],
        extraDeck: [],
        monsters: [
          publicStateCard("target-monster", 46986414, 0, "monster", 0),
        ],
        spellsAndTraps: [],
        graveyard: [
          publicStateCard("target-gy-0", 89631139, 0, "graveyard", 0),
          publicStateCard("target-gy-1", 5053103, 0, "graveyard", 1),
          publicStateCard("target-gy-2", 97590747, 0, "graveyard", 2),
        ],
        banished: [],
      },
      {
        player: 1,
        lifePoints: 8000,
        deckCount: 1,
        deck: deckStubs(),
        extraDeckCount: 0,
        handCount: 1,
        hand: [concealedStateCard("target-opponent-hand", 1, "hand", 0)],
        extraDeck: [],
        monsters: [],
        spellsAndTraps: [],
        graveyard: [],
        banished: [
          concealedStateCard("target-opponent-banished", 1, "banished", 0),
        ],
      },
    ],
    chain: [],
  };

  function deckStubs(): readonly PublicCard[] {
    return [
      {
        instanceId: cardInstanceId("target-opponent-deck-0"),
        owner: 1,
        controller: 1,
        location: "deck",
        sequence: 0,
        position: "faceDownAttack",
        faceUp: false,
        counters: [],
        overlayMaterials: [],
      },
    ];
  }

  function targetBoard() {
    return boardFor(TARGET_STATE);
  }

  function boardFor(state: PublicDuelState) {
    const mapped = mapSnapshotToBoard(state, BOARD_CARD_TEXTS);
    if (!mapped.ok) throw new Error("Target fixture mapping failed");
    return mapped.value;
  }

  function offFieldChoice(
    id: string,
    location: PublicCard["location"],
    sequence: number,
    controller: PlayerIndex = 0,
    label = "Select",
  ): PromptChoice {
    return promptChoice(id, label, {
      card: {
        instanceId: cardInstanceId(`target-choice-${id}`),
        controller,
        location,
        sequence,
        position: "faceDownDefense",
      },
    } as Partial<PromptChoice>);
  }

  /* The projector never emits opponent hand identities, so an opponent-hand
     choice has no card to mount: `resolvePromptChoiceBoardTarget` returns
     `target_not_mounted` and the prompt owns no launcher at all. */
  const UNMOUNTED_TARGET_STATE: PublicDuelState = {
    ...TARGET_STATE,
    players: [
      TARGET_STATE.players[0],
      { ...TARGET_STATE.players[1], handCount: 2, hand: [] },
    ],
  };

  function renderTargets(value: PlayerPrompt, state = TARGET_STATE) {
    const valueBoard = state === TARGET_STATE ? targetBoard() : boardFor(state);
    const mapped = mapPromptToInteractionSpec(
      value,
      state,
      valueBoard,
      CONTEXT,
    );
    if (mapped.kind === "inactive")
      throw new Error("Expected active field spec");
    const spec = mapped;
    let session: InteractionSession = createInteractionSession(spec);
    const commands: string[][] = [];
    const dispatch = vi.fn(async (action: InteractionSessionAction) => {
      const reduction = reduceInteractionSession(session, spec, action);
      session = reduction.session;
      if (reduction.command !== null)
        commands.push([...reduction.command.choiceIds]);
      await rendered.rerender({ session });
      return reduction.command !== null;
    });
    const rendered = render(DuelField, {
      board: valueBoard,
      prompt: value,
      spec,
      session,
      pending: false,
      zoneLists: zoneListsForBoard(valueBoard, state, BOARD_CARD_TEXTS),
      offFieldTargets: offFieldTargetEntries(spec, state, BOARD_CARD_TEXTS),
      oninteraction: dispatch,
    });
    return {
      rendered,
      spec,
      board: valueBoard,
      commands,
      dispatch,
      getSession: () => session,
    };
  }

  function targetButton(entryId: string, choice: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-cy="zone-list-entry-target-choice-${entryId}-${choice}"]`,
    );
    if (button === null)
      throw new Error(`Missing target button ${entryId}/${choice}`);
    return button;
  }

  it("opens the target window once for a list-only prompt", async () => {
    renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-1", "graveyard", 1)]),
    );

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll('[data-cy="floating-field-window-zoneList"]'),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-cy="zone-list-dialog-close-button"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="zone-list-dialog-collapse-button"]'),
    ).not.toBeNull();
  });

  it("lists only the legal cards of a pile, never the whole pile", () => {
    renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-1", "graveyard", 1)]),
    );

    expect(
      [...document.querySelectorAll('[data-cy^="zone-list-entry-target:"]')]
        .map((element) => element.getAttribute("data-cy"))
        .filter((value) => value?.startsWith("zone-list-entry-target:")),
    ).toEqual(["zone-list-entry-target:0:graveyard:1"]);
    expect(
      document.querySelector('[data-cy="zone-list-dialog-count"]')?.textContent,
    ).toBe("1");
  });

  it("aggregates hand, graveyard, deck and an unknown opponent card", () => {
    renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("hand-0", "hand", 0),
          offFieldChoice("gy-0", "graveyard", 0),
          offFieldChoice("deck-2", "deck", 2),
          offFieldChoice("opp-ban", "banished", 0, 1),
        ],
        { minimum: 1, maximum: 4 },
      ),
    );

    expect(
      [...document.querySelectorAll('[data-cy^="zone-list-entry-zone-"]')].map(
        (element) => element.textContent?.trim(),
      ),
    ).toEqual(["HAND", "GRAVEYARD", "DECK", "BANISHED"]);
    const hidden = document.querySelector(
      '[data-cy="zone-list-entry-target:1:banished:0"]',
    );
    expect(hidden).not.toBeNull();
    expect(hidden?.outerHTML).not.toContain("46986414");
    expect(hidden?.outerHTML).not.toContain("Dark Magician");
  });

  it("drafts an exact one-of-one target, then Validate submits it", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-confirm-button"]',
    );
    if (confirm === null) throw new Error("Missing confirm button");
    expect(confirm.disabled).toBe(true);

    await user.click(targetButton("target:0:graveyard:0", "gy-0"));

    expect(harness.commands).toEqual([]);
    expect(harness.dispatch.mock.calls[0]?.[0]).toEqual({
      type: "toggleChoice",
      choiceId: choiceId("gy-0"),
      key: harness.spec.key,
    });
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(harness.commands).toEqual([["gy-0"]]);
    /* The list still owns the confirmation: the always-mounted status bar of
       an exact one-of-one selection carries no Confirm button of its own. */
    expect(
      document.querySelector('[data-cy="field-action-bar-confirm"]'),
    ).toBeNull();
  });

  it("toggles a range selection, counts it and confirms in prompt order", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("gy-0", "graveyard", 0),
          offFieldChoice("hand-1", "hand", 1),
        ],
        { minimum: 1, maximum: 2 },
      ),
    );

    await user.click(targetButton("target:0:hand:1", "hand-1"));
    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("1 selected (choose 1–2)");

    await user.click(targetButton("target:0:graveyard:0", "gy-0"));
    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("2 selected (choose 1–2)");

    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-confirm-button"]',
    );
    if (confirm === null) throw new Error("Missing confirm button");
    await user.click(confirm);

    expect(harness.commands).toEqual([["gy-0", "hand-1"]]);
  });

  it("unselects only the pressed opaque ID from a duplicate-choice tile", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("gy-banish", "graveyard", 0, 0, "Banish"),
          offFieldChoice("gy-shuffle", "graveyard", 0, 0, "Shuffle back"),
        ],
        { minimum: 1, maximum: 2 },
      ),
    );
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-entry-choice-menu-trigger-target:0:graveyard:0"]',
    );
    if (trigger === null) throw new Error("Missing choice-menu trigger");
    await user.click(trigger);
    const banish = document.querySelector<HTMLButtonElement>(
      '[data-cy="projected-choice-target:0:graveyard:0-gy-banish"]',
    );
    const shuffle = document.querySelector<HTMLButtonElement>(
      '[data-cy="projected-choice-target:0:graveyard:0-gy-shuffle"]',
    );
    if (banish === null || shuffle === null)
      throw new Error("Missing duplicate choices");
    await user.click(banish);
    await user.click(shuffle);
    expect(harness.getSession().selectedChoiceIds).toEqual([
      choiceId("gy-banish"),
      choiceId("gy-shuffle"),
    ]);

    await user.click(banish);

    expect(harness.getSession().selectedChoiceIds).toEqual([
      choiceId("gy-shuffle"),
    ]);
    expect(shuffle.getAttribute("aria-pressed")).toBe("true");
    expect(harness.commands).toEqual([]);
  });

  it("keeps a mounted target live beside the list and counts both", async () => {
    const user = userEvent.setup();
    renderTargets(
      fieldPrompt(
        "selectCard",
        [
          mountedChoice("monster-select", "Select monster"),
          offFieldChoice("gy-0", "graveyard", 0),
        ],
        { minimum: 1, maximum: 2 },
      ),
    );

    const card = document.querySelector<HTMLElement>(
      '[data-cy="field-card-target-target-monster"]',
    );
    if (card === null) throw new Error("Missing mounted target");
    await user.click(card);

    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("1 selected (choose 1–2)");

    await user.click(targetButton("target:0:graveyard:0", "gy-0"));

    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("2 selected (choose 1–2)");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-cy="zone-list-dialog-confirm-button"]',
      )?.disabled,
    ).toBe(false);
  });

  it("preserves a pile-target draft across collapse and expand", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("gy-0", "graveyard", 0),
          offFieldChoice("gy-1", "graveyard", 1),
        ],
        { minimum: 1, maximum: 2 },
      ),
    );
    await user.click(targetButton("target:0:graveyard:0", "gy-0"));

    const collapse = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-collapse-button"]',
    );
    if (collapse === null) throw new Error("Missing collapse button");
    await user.click(collapse);

    const collapsedRoot = document.querySelector(
      '[data-cy="floating-field-window-zoneList"]',
    );
    expect(collapsedRoot).not.toBeNull();
    expect(collapsedRoot?.getAttribute("data-collapsed")).toBe("true");

    const expand = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-expand-button"]',
    );
    if (expand === null) throw new Error("Missing expand button");
    await user.click(expand);

    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("1 selected (choose 1–2)");
    expect(
      targetButton("target:0:graveyard:0", "gy-0").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(harness.commands).toEqual([]);
  });

  it("preserves a hand-target draft across collapse and expand", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("hand-0", "hand", 0),
          offFieldChoice("hand-1", "hand", 1),
        ],
        { minimum: 1, maximum: 2 },
      ),
    );
    await user.click(targetButton("target:0:hand:0", "hand-0"));

    const collapse = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-collapse-button"]',
    );
    if (collapse === null) throw new Error("Missing collapse button");
    await user.click(collapse);

    const collapsedRoot = document.querySelector(
      '[data-cy="floating-field-window-zoneList"]',
    );
    expect(collapsedRoot).not.toBeNull();
    expect(collapsedRoot?.getAttribute("data-collapsed")).toBe("true");

    const expand = document.querySelector<HTMLButtonElement>(
      '[data-cy="zone-list-dialog-expand-button"]',
    );
    if (expand === null) throw new Error("Missing expand button");
    await user.click(expand);

    expect(
      document.querySelector('[data-cy="zone-list-dialog-selection-count"]')
        ?.textContent,
    ).toBe("1 selected (choose 1–2)");
    expect(
      targetButton("target:0:hand:0", "hand-0").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(harness.commands).toEqual([]);
  });

  /* R1/F3: with every target unmounted the list is the only surface that can
     answer, and dismissing it recorded `dismissedTargetPromptKey`, which then
     refused every reopen — a `minimum: 2` prompt became unanswerable on the
     first pointerdown outside the window. */
  it("a launcher-less target list refuses to be dismissed", async () => {
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("opp-hand-0", "hand", 0, 1),
          offFieldChoice("opp-hand-1", "hand", 1, 1),
        ],
        { minimum: 2, maximum: 2 },
      ),
      UNMOUNTED_TARGET_STATE,
    );
    expect(harness.spec.offFieldChoices).toHaveLength(2);
    expect(
      document.querySelectorAll('[data-cy^="zone-list-entry-target:1:hand"]'),
    ).toHaveLength(2);

    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await fireEvent.pointerDown(surface);
    await fireEvent.click(surface);
    await fireEvent.keyDown(document, { key: "Escape" });

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("keeps a target list open when it has a mounted launcher", async () => {
    const harness = renderTargets(
      fieldPrompt(
        "selectCard",
        [
          offFieldChoice("gy-0", "graveyard", 0),
          offFieldChoice("gy-1", "graveyard", 1),
        ],
        { minimum: 2, maximum: 2 },
      ),
    );

    const surface = document.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-surface"]',
    );
    if (surface === null) throw new Error("Missing board surface");
    await fireEvent.pointerDown(surface);

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("keeps a browse list stack-specific for a pile with no legal target", async () => {
    renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );

    await fireEvent.click(
      document.querySelector<HTMLElement>(
        '[data-cy="field-stack-p0:deck"]',
      ) as HTMLElement,
    );

    expect(
      document.querySelector('[data-cy="zone-list-dialog-title"]')?.textContent,
    ).toContain("Deck");
    expect(
      document.querySelectorAll('[data-cy^="zone-list-entry-p0:deck:"]'),
    ).toHaveLength(3);
    expect(
      document.querySelector(
        '[data-cy="zone-list-entry-target:0:graveyard:0"]',
      ),
    ).toBeNull();
  });

  it("closes the previous target list and opens only the new prompt's", async () => {
    const harness = renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );
    expect(
      document.querySelector(
        '[data-cy="zone-list-entry-target:0:graveyard:0"]',
      ),
    ).not.toBeNull();

    const nextPrompt = fieldPrompt(
      "selectCard",
      [offFieldChoice("hand-1", "hand", 1)],
      { id: promptId("second-target-prompt") },
    );
    const nextSpec = mapPromptToInteractionSpec(
      nextPrompt,
      TARGET_STATE,
      harness.board,
      CONTEXT,
    );
    if (nextSpec.kind === "inactive")
      throw new Error("Expected active field spec");
    await harness.rendered.rerender({
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
      offFieldTargets: offFieldTargetEntries(
        nextSpec,
        TARGET_STATE,
        BOARD_CARD_TEXTS,
      ),
    });

    expect(
      document.querySelector(
        '[data-cy="zone-list-entry-target:0:graveyard:0"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="zone-list-entry-target:0:hand:1"]'),
    ).not.toBeNull();

    const thirdPrompt = fieldPrompt(
      "idleCommand",
      [promptChoice("end", "End turn", { action: "endPhase" })],
      { id: promptId("third-prompt") },
    );
    const thirdSpec = mapPromptToInteractionSpec(
      thirdPrompt,
      TARGET_STATE,
      harness.board,
      CONTEXT,
    );
    if (thirdSpec.kind === "inactive")
      throw new Error("Expected active field spec");
    await harness.rendered.rerender({
      prompt: thirdPrompt,
      spec: thirdSpec,
      session: createInteractionSession(thirdSpec),
      offFieldTargets: [],
    });

    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
  });

  it("a launcher click collapses the open target list instead of closing it", async () => {
    const user = userEvent.setup();
    renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );
    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();

    const launcher = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (launcher === null) throw new Error("Missing graveyard launcher");
    await user.click(launcher);

    expect(
      document.querySelector('[data-cy="floating-field-window-zoneList"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="zone-list-dialog"]')).toBeNull();
    expect(
      document.querySelector('[data-cy="zone-list-dialog-expand-button"]'),
    ).not.toBeNull();
  });

  it("a second launcher click expands the collapsed target list", async () => {
    const user = userEvent.setup();
    renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );
    const launcher = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (launcher === null) throw new Error("Missing graveyard launcher");
    await user.click(launcher);
    await user.click(launcher);

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="zone-list-dialog-collapse-button"]'),
    ).not.toBeNull();
  });

  it("a new prompt resets the collapse state", async () => {
    const user = userEvent.setup();
    const harness = renderTargets(
      fieldPrompt("selectCard", [offFieldChoice("gy-0", "graveyard", 0)]),
    );
    const launcher = document.querySelector<HTMLElement>(
      '[data-cy="field-stack-p0:graveyard"]',
    );
    if (launcher === null) throw new Error("Missing graveyard launcher");
    await user.click(launcher);
    expect(
      document.querySelector('[data-cy="zone-list-dialog-expand-button"]'),
    ).not.toBeNull();

    const nextPrompt = fieldPrompt(
      "selectCard",
      [offFieldChoice("gy-1", "graveyard", 1)],
      { id: promptId("reset-collapse-prompt") },
    );
    const nextSpec = mapPromptToInteractionSpec(
      nextPrompt,
      TARGET_STATE,
      harness.board,
      CONTEXT,
    );
    if (nextSpec.kind === "inactive")
      throw new Error("Expected active field spec");
    await harness.rendered.rerender({
      prompt: nextPrompt,
      spec: nextSpec,
      session: createInteractionSession(nextSpec),
      offFieldTargets: offFieldTargetEntries(
        nextSpec,
        TARGET_STATE,
        BOARD_CARD_TEXTS,
      ),
    });

    expect(
      document.querySelector('[data-cy="zone-list-dialog"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-cy="zone-list-dialog-collapse-button"]'),
    ).not.toBeNull();
  });
});

describe("FieldBoard", () => {
  /* Svelte writes `null` into a `bind:this` ref as the element unmounts, and
     the queued focus move resumes after that write. The rejection would be
     unhandled — `focusActiveTarget` is `void`-called — so the only observable
     is the process-level report. */
  it("survives unmounting while a queued focus move is in flight", async () => {
    const rejections: unknown[] = [];
    const record = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      const rendered = render(FieldBoard, {
        board: board("ST-05"),
        renderLayout: createFieldRenderLayout(true, 1280, 720),
        planeHeight: 720,
        planeTransform: "",
        cardBackUrl: "card-back.png",
        placeholderUrl: "placeholder.png",
      });
      const zone = document.querySelector<HTMLElement>("[data-field-target]");
      expect(zone).not.toBeNull();

      /* Deliberately not awaited: the focus move must still be suspended on
         `tick()` when the component goes away. */
      void fireEvent.keyDown(zone as HTMLElement, { key: "ArrowRight" });
      rendered.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", record);
    }

    expect(
      rejections.map((reason) =>
        reason instanceof Error ? reason.message : String(reason),
      ),
    ).toEqual([]);
  });

  it("deck and extra stacks render a card back", () => {
    const cardBackUrl = "/cards/back.webp";
    const stackBoard = mapSnapshotToBoard(
      BOARD_VIEW_MODEL_FIXTURES["ST-08"],
      BOARD_CARD_TEXTS,
    );
    if (!stackBoard.ok) throw new Error("Fixture mapping failed");
    const { container } = render(FieldBoard, {
      board: stackBoard.value,
      renderLayout: createFieldRenderLayout(true, 1280, 720),
      planeHeight: 720,
      planeTransform: "",
      cardBackUrl,
      placeholderUrl: "",
    });

    const deckBack = container.querySelector<HTMLDivElement>(
      '[data-cy="stack-control-back-p0:deck"]',
    );
    const extraBack = container.querySelector<HTMLDivElement>(
      '[data-cy="stack-control-back-p0:extra"]',
    );

    expect(deckBack).not.toBeNull();
    expect(extraBack).not.toBeNull();
    expect(
      deckBack?.querySelector<HTMLImageElement>("img")?.getAttribute("src"),
    ).toBe(cardBackUrl);
    expect(
      extraBack?.querySelector<HTMLImageElement>("img")?.getAttribute("src"),
    ).toBe(cardBackUrl);
  });
});

const HAND_CARD_ID = "st01-own-hand";

function handChoice(
  id: string,
  label: string,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return promptChoice(id, label, {
    card: {
      instanceId: cardInstanceId(HAND_CARD_ID),
      controller: 0,
      location: "hand",
      sequence: 0,
    },
    ...overrides,
  } as Partial<PromptChoice>);
}

/** Manual rAF queue: rAF calls never run until `flush` fires them, so a
    component test can assert scheduling counts and drive the ghost's
    animation loop frame-by-frame deterministically. */
function stubRaf() {
  let queue: Array<{ id: number; callback: FrameRequestCallback }> = [];
  let nextId = 0;
  const raf = vi.fn((callback: FrameRequestCallback) => {
    nextId += 1;
    queue.push({ id: nextId, callback });
    return nextId;
  });
  const caf = vi.fn((id: number) => {
    queue = queue.filter((entry) => entry.id !== id);
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  return {
    raf,
    caf,
    pendingCount: () => queue.length,
    flush: (now = performance.now()) => {
      const callbacks = queue;
      queue = [];
      for (const entry of callbacks) entry.callback(now);
    },
    restore: () => vi.unstubAllGlobals(),
  };
}

/** ST-01 gives player 0 one visible hand card and an otherwise empty field. */
function renderDraggableHand(
  options: {
    readonly occupiedZoneId?: string;
    /** The same thing for a whole row: item 4's activation zone has to stay
        reachable with every backrow zone already taken. */
    readonly occupiedZoneIds?: readonly string[];
    readonly reducedMotion?: boolean;
    /** One legal action instead of two: the shape whose click used to commit
        the play outright. */
    readonly singleChoice?: boolean;
    /** Item 6's own example: a hand card offering both `activate` and
        `setSpellTrap`, so a backrow drop is ambiguous. */
    readonly spellChoices?: boolean;
    /** Item 4's broad cancel: a backrow drop that reads as exactly one
        `activate` and used to commit on release. */
    readonly activateOnly?: boolean;
    readonly imageLibrary?: {
      lease: (code: number) => { url: string; release: () => void };
    };
  } = {},
) {
  const base = board("ST-01");
  const occupant = base.cards[0];
  if (occupant === undefined) throw new Error("Missing hand fixture card");
  const occupiedZoneIds = [
    ...(options.occupiedZoneId === undefined ? [] : [options.occupiedZoneId]),
    ...(options.occupiedZoneIds ?? []),
  ];
  const valueBoard =
    occupiedZoneIds.length === 0
      ? base
      : {
          ...base,
          cards: [
            ...base.cards,
            ...occupiedZoneIds.map((zoneId, index) => ({
              ...occupant,
              id: `drag-occupant-${index}`,
              targetId: `card:drag-occupant-${index}` as const,
              zoneId: zoneId as typeof occupant.zoneId,
            })),
          ],
        };
  const value = fieldPrompt(
    "idleCommand",
    options.spellChoices === true
      ? [
          handChoice("activate", "Activate The Legendary Fisherman", {
            action: "activate",
          }),
          handChoice("setspelltrap", "Set The Legendary Fisherman", {
            action: "setSpellTrap",
          }),
        ]
      : options.activateOnly === true
        ? [
            handChoice("activate", "Activate The Legendary Fisherman", {
              action: "activate",
            }),
          ]
        : options.singleChoice === true
          ? [
              handChoice("summon", "Summon The Legendary Fisherman", {
                action: "summon",
              }),
            ]
          : [
              handChoice("summon", "Summon The Legendary Fisherman", {
                action: "summon",
              }),
              handChoice("setmonster", "Set The Legendary Fisherman", {
                action: "setMonster",
              }),
            ],
  );
  const spec = mapPromptToInteractionSpec(
    value,
    BOARD_VIEW_MODEL_FIXTURES["ST-01"],
    valueBoard,
    CONTEXT,
  );
  if (spec.kind === "inactive") throw new Error("Expected active field spec");
  const dispatch = vi.fn();
  const onplacementintent = vi.fn();
  const onpreview = vi.fn();
  let hit: Element | null = null;
  const rendered = render(DuelField, {
    board: valueBoard,
    prompt: value,
    spec,
    session: createInteractionSession(spec),
    pending: false,
    imageLibrary: options.imageLibrary ?? null,
    reducedMotion: options.reducedMotion ?? false,
    oninteraction: dispatch,
    onplacementintent,
    onpreview,
    hitTest: () => hit,
  });
  return {
    rendered,
    board: valueBoard,
    spec,
    dispatch,
    onplacementintent,
    onpreview,
    setHit: (element: Element | null) => {
      hit = element;
    },
  };
}

/** ST-01 with a second visible card in player 0's hand: one hand card can only
    be selected while the pointer is on another when there are two of them. */
const SECOND_HAND_CARD_ID = "st01-own-hand-two";

function handSelectionSnapshot(): PublicDuelState {
  const base = BOARD_VIEW_MODEL_FIXTURES["ST-01"];
  return {
    ...base,
    players: [
      {
        ...base.players[0],
        handCount: 2,
        hand: [
          publicStateCard(
            HAND_CARD_ID,
            97590747,
            0,
            "hand",
            0,
            "faceDownDefense",
          ),
          publicStateCard(
            SECOND_HAND_CARD_ID,
            89631139,
            0,
            "hand",
            1,
            "faceDownDefense",
          ),
        ],
      },
      base.players[1],
    ],
  };
}

function handSelectChoice(
  id: string,
  cardId: string,
  sequence: number,
): PromptChoice {
  return promptChoice(id, `Select ${cardId}`, {
    card: {
      instanceId: cardInstanceId(cardId),
      controller: 0,
      location: "hand",
      sequence,
    },
  } as Partial<PromptChoice>);
}

/** A multi-pick selection prompt over both hand cards, with the session driven
    the way the app drives it: every dispatch reduces and re-renders. */
function renderHandSelection() {
  const snapshot = handSelectionSnapshot();
  const mapped = mapSnapshotToBoard(snapshot, BOARD_CARD_TEXTS);
  if (!mapped.ok)
    throw new Error(`Hand selection mapping failed: ${mapped.error.type}`);
  const valueBoard = mapped.value;
  const value = fieldPrompt(
    "selectCard",
    [
      handSelectChoice("select-first", HAND_CARD_ID, 0),
      handSelectChoice("select-second", SECOND_HAND_CARD_ID, 1),
    ],
    { minimum: 1, maximum: 2 },
  );
  const spec = mapPromptToInteractionSpec(value, snapshot, valueBoard, CONTEXT);
  if (spec.kind === "inactive") throw new Error("Expected active field spec");
  let session: InteractionSession = createInteractionSession(spec);
  const dispatch = vi.fn(async (action: InteractionSessionAction) => {
    const reduction = reduceInteractionSession(session, spec, action);
    const changed = reduction.session !== session;
    session = reduction.session;
    await rendered.rerender({ session });
    return reduction.command !== null || changed;
  });
  const rendered = render(DuelField, {
    board: valueBoard,
    prompt: value,
    spec,
    session,
    pending: false,
    zoneLists: zoneListsForBoard(valueBoard, snapshot, BOARD_CARD_TEXTS),
    offFieldTargets: offFieldTargetEntries(spec, snapshot, BOARD_CARD_TEXTS),
    oninteraction: dispatch,
  });
  return { rendered, spec, dispatch, getSession: () => session };
}

/** T16 routes a hand target through the aggregate target window, so that list
    is where a hand card is picked — its own control only reopens the window. */
async function selectHandTarget(sequence: number): Promise<HTMLElement> {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-cy^="zone-list-entry-target-choice-target:0:hand:${sequence}-"]`,
  );
  if (button === null)
    throw new Error(`Missing hand target button for sequence ${sequence}`);
  await fireEvent.click(button);
  return button;
}

function cardArticle(cardId: string): HTMLElement {
  const article = document.querySelector<HTMLElement>(
    `[data-cy="field-card-${cardId}"]`,
  );
  if (article === null) throw new Error(`Missing card article ${cardId}`);
  return article;
}

function dragGhost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cy="drag-ghost"]');
}

function dropConfirmDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cy="drop-confirm-dialog"]');
}

function activationZoneElement(): HTMLElement {
  const zone = document.querySelector<HTMLElement>(
    '[data-cy="hand-activation-drop-zone"]',
  );
  if (zone === null) throw new Error("Missing hand activation drop zone");
  return zone;
}

function handCardArticle(): HTMLElement {
  const article = document.querySelector<HTMLElement>(
    `[data-cy="field-card-${HAND_CARD_ID}"]`,
  );
  if (article === null) throw new Error("Missing hand card article");
  return article;
}

function handDragTarget(): HTMLElement {
  const target = document.querySelector<HTMLElement>(
    `[data-cy="field-card-target-${HAND_CARD_ID}"]`,
  );
  if (target === null) throw new Error("Missing hand card drag target");
  return target;
}

/** The pointer route, press and release included: a click with no pointer
    behind it is a keyboard activation, which keeps the in-band pin flow. */
async function clickHandCard(): Promise<HTMLElement> {
  const target = handDragTarget();
  await fireEvent.pointerDown(target, { clientX: 10, clientY: 10 });
  await fireEvent.pointerUp(target, { clientX: 10, clientY: 10 });
  await fireEvent.click(target);
  return target;
}

/** The overlay box itself. A `data-cy` prefix would also match its art and
    name strip, counting one overlay three times. */
function handZoomOverlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>("div.hand-zoom-overlay");
}

function duelFieldRoot(): HTMLElement {
  const field = document.querySelector<HTMLElement>('[data-cy="duel-field"]');
  if (field === null) throw new Error("Missing duel field root");
  return field;
}

function handZoomChip(action: string): HTMLButtonElement {
  const chip = document.querySelector<HTMLButtonElement>(
    `[data-cy="hand-zoom-overlay-card-action-chip-${action}"]`,
  );
  if (chip === null)
    throw new Error(`Missing hand zoom overlay chip for ${action}`);
  return chip;
}

/** 20px past the origin clears `CardControl`'s 8px click-suppression gate. */
async function startHandDrag(): Promise<HTMLElement> {
  const target = handDragTarget();
  await fireEvent.pointerDown(target, { clientX: 10, clientY: 10 });
  await fireEvent.pointerMove(target, { clientX: 30, clientY: 30 });
  return target;
}

async function dropAt(
  harness: ReturnType<typeof renderDraggableHand>,
  element: Element | null,
): Promise<void> {
  harness.setHit(element);
  await fireEvent.pointerUp(handDragTarget(), { clientX: 30, clientY: 30 });
}

function zoneElement(zoneId: string): HTMLElement {
  const zone = document.querySelector<HTMLElement>(
    `[data-zone-id="${zoneId}"]`,
  );
  if (zone === null) throw new Error(`Missing zone ${zoneId}`);
  return zone;
}

function candidateZoneIds(): readonly string[] {
  return [...document.querySelectorAll('[data-drop-candidate="true"]')].map(
    (zone) => zone.getAttribute("data-zone-id") ?? "",
  );
}

describe("DuelField material selection", () => {
  it("mounts the visual dialog and submits its selected material through the interaction session", async () => {
    const user = userEvent.setup();
    const value = fieldPrompt(
      "selectCard",
      [
        overlayChoice("material-0", "First material", 0),
        overlayChoice("material-1", "Second material", 1),
      ],
      { minimum: 1, maximum: 1 },
    );
    const harness = renderInteractive(value);

    expect(harness.spec.overlayChoices.size).toBe(2);
    expect(promptSurface(value, harness.spec, false, true)).toBe("field");
    expect(
      document.querySelector('[data-cy="material-select-dialog"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="field-action-bar"]')).toBeNull();

    await user.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cy="material-select-tile-material-1"]',
      )!,
    );
    await user.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cy="material-select-confirm"]',
      )!,
    );

    expect(harness.commands).toEqual([["material-1"]]);
    expect(harness.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      "toggleChoice",
      "confirm",
    ]);
  });

  it("submits an empty response when an optional material prompt is cancelled", async () => {
    const user = userEvent.setup();
    const harness = renderInteractive(
      fieldPrompt(
        "selectTribute",
        [overlayChoice("material-cancel", "Material", 0)],
        { cancelable: true },
      ),
    );

    await user.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cy="material-select-cancel"]',
      )!,
    );

    expect(harness.commands).toEqual([[]]);
    expect(harness.dispatch.mock.calls[0]?.[0].type).toBe("cancel");
  });
});
