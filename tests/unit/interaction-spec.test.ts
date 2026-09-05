import { describe, expect, it } from "vitest";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
  type ChoiceId,
} from "../../src/battle/duel/contracts/ids.ts";
import type {
  PlayerPrompt,
  PromptChoice,
  PromptKind,
} from "../../src/battle/duel/contracts/player-prompt.ts";
import {
  endPhaseChoice,
  fieldActionBarRequired,
  INTERACTION_SPEC_KINDS,
  interactionKey,
  isImmediateSingleSelection,
  isPhaseTransitionChoice,
  interactionChoicesInPromptOrder,
  mapPromptToInteractionSpec,
  OFF_FIELD_TARGET_LOCATIONS,
  type ActiveInteractionSpec,
} from "../../src/battle/app/prompts/interaction-spec.ts";
import type { PublicLocation } from "../../src/battle/duel/contracts/public-duel-state.ts";
import { validatePromptSelection } from "../../src/battle/app/prompts/prompt-selection.ts";
import { mapSnapshotToBoard } from "../../src/battle/field/board-view-model.ts";
import { BOARD_VIEW_MODEL_FIXTURES } from "../fixtures/board-view-model.ts";

const SNAPSHOT = BOARD_VIEW_MODEL_FIXTURES["ST-08"];
const BOARD_RESULT = mapSnapshotToBoard(SNAPSHOT);
if (!BOARD_RESULT.ok)
  throw new Error("Expected valid interaction board fixture");
const BOARD = BOARD_RESULT.value;
const CONTEXT = { workerGeneration: 3, sessionGeneration: 5 } as const;
const FIRST = choiceId("first");
const SECOND = choiceId("second");

function choice(
  id: ChoiceId,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return {
    id,
    label: String(id),
    action: "select",
    ...overrides,
  };
}

function mountedCardChoice(
  id: ChoiceId,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return choice(id, {
    card: {
      instanceId: cardInstanceId(`positional-${id}`),
      controller: 0,
      location: "monster",
      sequence: 2,
      position: "faceUpAttack",
    },
    ...overrides,
  });
}

function overlayCardChoice(
  id: ChoiceId,
  sequence = 4,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return choice(id, {
    card: {
      instanceId: cardInstanceId(`overlay-${id}`),
      controller: 0,
      location: "monster",
      sequence,
      overlay: true,
      code: cardCode(97590747),
    },
    ...overrides,
  });
}

function graveyardCardChoice(
  id: ChoiceId,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return choice(id, {
    card: {
      instanceId: cardInstanceId(`stack-${id}`),
      controller: 0,
      location: "graveyard",
      sequence: 0,
      position: "faceUpAttack",
    },
    ...overrides,
  });
}

function offFieldCardChoice(
  id: ChoiceId,
  location: PublicLocation,
  sequence = 0,
  overrides: Partial<PromptChoice> = {},
): PromptChoice {
  return choice(id, {
    card: {
      instanceId: cardInstanceId(`offfield-${id}`),
      controller: 0,
      location,
      sequence,
      position: "faceDownDefense",
    },
    ...overrides,
  });
}

function prompt(
  kind: PromptKind,
  overrides: Partial<PlayerPrompt> = {},
): PlayerPrompt {
  return {
    id: promptId(`${kind}-interaction`),
    kind,
    player: 0,
    title: "Choose",
    message: "Choose legal option",
    choices: [choice(FIRST), choice(SECOND)],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
    ...overrides,
  };
}

function specFor(value: PlayerPrompt): ActiveInteractionSpec {
  const spec = mapPromptToInteractionSpec(value, SNAPSHOT, BOARD, CONTEXT);
  if (spec.kind === "inactive") throw new Error("Expected active spec");
  return spec;
}

const EXPECTED_KINDS = {
  idleCommand: "cardAction",
  battleCommand: "cardAction",
  yesNo: "nonField",
  effectYesNo: "nonField",
  option: "nonField",
  chain: "cardAction",
  selectCard: "cardSelection",
  selectTribute: "cardSelection",
  selectSum: "cardSelection",
  selectUnselectCard: "cardSelection",
  selectPlace: "placeSelection",
  selectDisabledField: "placeSelection",
  selectPosition: "nonField",
  sortCard: "order",
  sortChain: "order",
  selectCounter: "counterAllocation",
  announceNumber: "nonField",
  announceAttribute: "nonField",
  announceRace: "nonField",
  announceCard: "nonField",
  rockPaperScissors: "nonField",
} as const satisfies Readonly<
  Record<PromptKind, ActiveInteractionSpec["kind"]>
>;

describe("prompt interaction spec", () => {
  it("classifies every PromptKind exhaustively", () => {
    expect(INTERACTION_SPEC_KINDS).toEqual(EXPECTED_KINDS);
    for (const [kind, expected] of Object.entries(EXPECTED_KINDS)) {
      expect(specFor(prompt(kind as PromptKind)).kind).toBe(expected);
    }
  });

  it.each([
    ["action", "idleCommand", "cardAction", "single"],
    ["single card", "selectCard", "cardSelection", "multiple"],
    ["multiple cards", "selectCard", "cardSelection", "multiple"],
    ["tribute", "selectTribute", "cardSelection", "multiple"],
    ["sum", "selectSum", "cardSelection", "multiple"],
    ["unselect", "selectUnselectCard", "cardSelection", "toggle"],
    ["place", "selectPlace", "placeSelection", "multiple"],
    ["disabled field", "selectDisabledField", "placeSelection", "multiple"],
    ["counter", "selectCounter", "counterAllocation", "counter"],
    ["order", "sortCard", "order", "order"],
    ["non-field", "yesNo", "nonField", "single"],
  ] as const)(
    "maps %s prompt fixture",
    (_name, kind, expectedKind, expectedFamily) => {
      const cardChoices =
        kind === "idleCommand" ||
        kind === "selectCard" ||
        kind === "selectTribute" ||
        kind === "selectSum" ||
        kind === "selectUnselectCard" ||
        kind === "selectCounter" ||
        kind === "sortCard"
          ? [
              mountedCardChoice(FIRST, {
                ...(kind === "selectCounter" ? { allocationMaximum: 2 } : {}),
              }),
            ]
          : undefined;
      const placeChoices =
        kind === "selectPlace" || kind === "selectDisabledField"
          ? [
              choice(FIRST, {
                place: { player: 0, location: "monster", sequence: 0 },
              }),
            ]
          : undefined;
      const choices = cardChoices ?? placeChoices ?? [choice(FIRST)];
      const spec = specFor(
        prompt(kind, {
          choices,
          maximum: _name === "multiple cards" ? 2 : 1,
          ordered: kind === "sortCard",
          ...(kind === "selectSum"
            ? { requiredTotal: 2, sumMode: "exact" as const }
            : {}),
        }),
      );

      expect(spec.kind).toBe(expectedKind);
      expect(spec.constraints.controlFamily).toBe(expectedFamily);
      expect(spec.key).toEqual({
        workerGeneration: 3,
        sessionGeneration: 5,
        promptId: promptId(`${kind}-interaction`),
      });
    },
  );

  it("keeps multiple opaque actions on one positional card distinct", () => {
    const value = prompt("idleCommand", {
      choices: [
        mountedCardChoice(FIRST, { action: "activate", label: "Activate" }),
        mountedCardChoice(SECOND, {
          action: "changePosition",
          label: "Change position",
        }),
      ],
    });

    const spec = specFor(value);
    expect(spec.kind).toBe("cardAction");
    expect(spec.fieldCapable).toBe(true);
    expect(
      spec.cardChoices.get("card:st08-chain-source")?.map(({ id }) => id),
    ).toEqual([FIRST, SECOND]);
    expect(validatePromptSelection(value, [SECOND])).toEqual({ valid: true });
  });

  it("spec collects stack choices separately", () => {
    const spec = specFor(
      prompt("chain", {
        choices: [
          graveyardCardChoice(FIRST, { action: "activate", label: "Activate" }),
          choice(SECOND, { action: "pass" }),
        ],
      }),
    );

    expect(spec.stackChoices.get("stack:p0:graveyard")).toHaveLength(1);
    expect(spec.cardChoices.size).toBe(0);
    expect([...spec.globalChoices.values()].map(({ id }) => id)).toEqual([
      SECOND,
    ]);
  });

  it("stack choices now make a prompt field capable", () => {
    const spec = specFor(
      prompt("chain", {
        choices: [
          graveyardCardChoice(FIRST, { action: "activate", label: "Activate" }),
          choice(SECOND, { action: "pass" }),
        ],
      }),
    );

    expect(spec.fieldCapable).toBe(true);
  });

  it("choices carry their card address", () => {
    const spec = specFor(
      prompt("chain", {
        choices: [
          choice(FIRST, {
            action: "activate",
            label: "Activate",
            card: {
              instanceId: cardInstanceId("gy-seq-2"),
              controller: 0,
              location: "graveyard",
              sequence: 2,
              position: "faceUpAttack",
            },
          }),
        ],
      }),
    );

    const choices = spec.stackChoices.get("stack:p0:graveyard");
    expect(choices?.[0]?.cardAddress).toEqual({
      controller: 0,
      location: "graveyard",
      sequence: 2,
    });
  });

  it("resolves public positional identity and routes unresolved cards to semantic fallback", () => {
    const unresolved = choiceId("closed-stack-card");
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          mountedCardChoice(FIRST),
          choice(unresolved, {
            card: {
              instanceId: cardInstanceId("stale-monster-instance"),
              controller: 0,
              location: "monster",
              sequence: 9,
              position: "faceUpAttack",
            },
          }),
        ],
      }),
    );

    expect(spec.cardChoices.get("card:st08-chain-source")?.[0]?.id).toBe(FIRST);
    expect(spec.globalChoices.get(unresolved)?.id).toBe(unresolved);
    expect(
      [...spec.cardChoices.values()].flat().some(({ id }) => id === unresolved),
    ).toBe(false);
  });

  it("maps physical places while keeping unsupported addresses in semantic fallback", () => {
    const unsupported = choiceId("unsupported-place");
    const spec = specFor(
      prompt("selectPlace", {
        choices: [
          choice(FIRST, {
            place: { player: 0, location: "monster", sequence: 0 },
          }),
          choice(unsupported, {
            place: { player: 0, location: "field", sequence: 1 },
          }),
        ],
      }),
    );

    expect(spec.zoneChoices.get("zone:p0:mainMonster:0")?.[0]?.id).toBe(FIRST);
    expect(spec.globalChoices.get(unsupported)?.id).toBe(unsupported);
  });

  it("contains constraints but no mutable selection, order, or allocation state", () => {
    const counter = specFor(
      prompt("selectCounter", {
        choices: [mountedCardChoice(FIRST, { allocationMaximum: 3 })],
        minimum: 2,
        maximum: 2,
      }),
    );
    const unselect = specFor(
      prompt("selectUnselectCard", {
        choices: [mountedCardChoice(FIRST, { selected: true })],
      }),
    );
    const order = specFor(
      prompt("sortCard", {
        choices: [mountedCardChoice(FIRST)],
        ordered: true,
      }),
    );
    const keys = collectKeys([counter, unselect, order]);

    expect(keys).not.toContain("selected");
    expect(keys).not.toContain("selectedChoiceIds");
    expect(keys).not.toContain("order");
    expect(keys).not.toContain("allocations");
    expect(counter.constraints).toMatchObject({ minimum: 2, maximum: 2 });
    expect(
      unselect.cardChoices.get("card:st08-chain-source")?.[0]?.toggleState,
    ).toBe("selected");
    expect(
      counter.cardChoices.get("card:st08-chain-source")?.[0],
    ).toMatchObject({
      id: FIRST,
      allocationMaximum: 3,
    });
    expect(Object.isFrozen(counter.cardChoices)).toBe(true);
    expect(Object.isFrozen(counter.zoneChoices)).toBe(true);
    expect(Object.isFrozen(counter.globalChoices)).toBe(true);
  });

  it("never turns malformed, ambiguous, duplicate, or unknown choices into field targets", () => {
    const duplicate = choiceId("duplicate");
    const malformed: readonly PromptChoice[] = [
      choice(duplicate, { card: mountedCardChoice(FIRST).card! }),
      choice(duplicate, { card: mountedCardChoice(SECOND).card! }),
      malformedChoice({
        ...mountedCardChoice(choiceId("unknown-action")),
        action: "unknown-action",
      }),
      malformedChoice({
        ...choice(choiceId("bad-place")),
        place: { player: 7, location: "monster", sequence: 0 },
      }),
      malformedChoice({
        ...mountedCardChoice(choiceId("ambiguous")),
        place: { player: 0, location: "monster", sequence: 0 },
      }),
    ];
    const spec = specFor(prompt("selectCard", { choices: malformed }));

    expect(spec.fieldCapable).toBe(false);
    expect(spec.cardChoices.size).toBe(0);
    expect(spec.zoneChoices.size).toBe(0);
    expect(spec.globalChoices.size).toBe(0);
  });

  it("produces structured-cloneable domain data without elements or functions", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [mountedCardChoice(FIRST), choice(SECOND, { action: "pass" })],
      }),
    );
    const cloned = structuredClone(spec);

    expect(cloned).toEqual(spec);
    expect(containsFunctionOrElement(cloned)).toBe(false);
  });

  it("sanitizeChoice keeps the engine card code for an own-card choice", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          choice(FIRST, {
            card: {
              instanceId: cardInstanceId("own-deck-card"),
              controller: 0,
              location: "deck",
              sequence: 3,
              position: "faceDownDefense",
              code: cardCode(12345),
            },
          }),
        ],
      }),
    );
    expect(spec.offFieldChoices[0]?.cardCode).toBe(cardCode(12345));
  });

  it("sanitizeChoice drops the card code for an opponent-controlled choice", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          choice(FIRST, {
            card: {
              instanceId: cardInstanceId("opp-deck-card"),
              controller: 1,
              location: "deck",
              sequence: 3,
              position: "faceDownDefense",
              code: cardCode(12345),
            },
          }),
        ],
      }),
    );
    expect(spec.offFieldChoices[0]?.cardCode).toBeUndefined();
  });

  it("creates stable value keys and an inactive spec without a prompt", () => {
    expect(interactionKey(3, 5, promptId("stable"))).toEqual(
      interactionKey(3, 5, promptId("stable")),
    );
    expect(mapPromptToInteractionSpec(null, SNAPSHOT, BOARD, CONTEXT)).toEqual({
      kind: "inactive",
    });
  });
});

describe("overlay material choices (synthetic contract fixtures)", () => {
  it("routes overlay choices into overlayChoices instead of the global list", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [overlayCardChoice(FIRST), overlayCardChoice(SECOND, 4)],
        minimum: 1,
        maximum: 2,
      }),
    );

    expect([...spec.overlayChoices.keys()]).toEqual([FIRST, SECOND]);
    expect(spec.overlayChoices.get(FIRST)?.cardCode).toBe(cardCode(97590747));
    expect(spec.globalChoices.has(FIRST)).toBe(false);
    expect(spec.globalChoices.has(SECOND)).toBe(false);
    expect(spec.offFieldChoices).toEqual([]);
  });

  /* A material rides on its host's monster zone, so its engine address can
     collide with a mounted card. The divert runs before that resolution, or
     the detach choice would silently answer as the host instead. */
  it("routes an overlay choice whose address collides with a mounted card", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [overlayCardChoice(FIRST, 2), mountedCardChoice(SECOND)],
      }),
    );

    expect([...spec.overlayChoices.keys()]).toEqual([FIRST]);
    expect([...spec.cardChoices.values()].flat().map(({ id }) => id)).toEqual([
      SECOND,
    ]);
  });

  it("keeps a concealed overlay choice without attesting a code", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          choice(FIRST, {
            card: {
              instanceId: cardInstanceId("overlay-concealed"),
              controller: 1,
              location: "monster",
              sequence: 0,
              overlay: true,
              code: cardCode(97590747),
            },
          }),
        ],
      }),
    );

    expect(spec.overlayChoices.get(FIRST)?.cardCode).toBeUndefined();
  });

  it("keeps overlay choices answerable in raw prompt order", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [overlayCardChoice(FIRST), choice(SECOND, { action: "pass" })],
        minimum: 1,
        maximum: 1,
      }),
    );

    expect(spec.choiceOrder).toEqual([FIRST, SECOND]);
    expect(interactionChoicesInPromptOrder(spec).map(({ id }) => id)).toEqual([
      FIRST,
      SECOND,
    ]);
  });

  it("leaves a non-overlay card selection untouched", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST), graveyardCardChoice(SECOND)],
      }),
    );

    expect(spec.overlayChoices.size).toBe(0);
  });
});

describe("off-field target collection", () => {
  it("names exactly the five off-field locations", () => {
    expect([...OFF_FIELD_TARGET_LOCATIONS].sort()).toEqual([
      "banished",
      "deck",
      "extra",
      "graveyard",
      "hand",
    ]);
  });

  it("collects a card selection target from every off-field location", () => {
    const locations = [
      "hand",
      "graveyard",
      "deck",
      "banished",
      "extra",
    ] as const;
    const spec = specFor(
      prompt("selectCard", {
        choices: locations.map((location) =>
          offFieldCardChoice(choiceId(location), location),
        ),
        minimum: 1,
        maximum: 5,
      }),
    );

    expect(spec.offFieldChoices.map(({ id }) => id)).toEqual(
      locations.map((location) => choiceId(location)),
    );
    expect(Object.isFrozen(spec.offFieldChoices)).toBe(true);
  });

  it("never collects a mounted monster, spell/trap or field target", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          mountedCardChoice(FIRST),
          offFieldCardChoice(choiceId("spell-trap"), "spellTrap"),
          offFieldCardChoice(choiceId("field-zone"), "field"),
        ],
        minimum: 1,
        maximum: 3,
      }),
    );

    expect(spec.offFieldChoices).toEqual([]);
  });

  it("leaves a cardAction graveyard choice out of the off-field list", () => {
    const spec = specFor(
      prompt("chain", {
        choices: [
          graveyardCardChoice(FIRST, { action: "activate", label: "Activate" }),
          choice(SECOND, { action: "pass" }),
        ],
      }),
    );

    expect(spec.kind).toBe("cardAction");
    expect(spec.offFieldChoices).toEqual([]);
    expect(spec.stackChoices.get("stack:p0:graveyard")).toHaveLength(1);
  });

  it("keeps an off-field target in its launcher map as well", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [offFieldCardChoice(FIRST, "graveyard")],
      }),
    );

    expect(spec.offFieldChoices.map(({ id }) => id)).toEqual([FIRST]);
    expect(
      spec.stackChoices.get("stack:p0:graveyard")?.map(({ id }) => id),
    ).toEqual([FIRST]);
  });

  it("keeps mounted and off-field targets of one mixed prompt side by side", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          mountedCardChoice(FIRST),
          offFieldCardChoice(SECOND, "graveyard"),
        ],
        minimum: 1,
        maximum: 2,
      }),
    );

    expect(spec.cardChoices.get("card:st08-chain-source")?.[0]?.id).toBe(FIRST);
    expect(spec.offFieldChoices.map(({ id }) => id)).toEqual([SECOND]);
  });

  it("is field capable with an off-field target alone", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [offFieldCardChoice(FIRST, "hand", 3)],
      }),
    );

    expect(spec.fieldCapable).toBe(true);
  });

  it("keeps choiceOrder in raw prompt order and drops only invalid choices", () => {
    const invalid = choiceId("ambiguous");
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          offFieldCardChoice(choiceId("gy"), "graveyard"),
          malformedChoice({
            ...mountedCardChoice(invalid),
            place: { player: 0, location: "monster", sequence: 0 },
          }),
          mountedCardChoice(FIRST),
          offFieldCardChoice(SECOND, "deck", 4),
        ],
        minimum: 1,
        maximum: 3,
      }),
    );

    expect(spec.choiceOrder).toEqual([choiceId("gy"), FIRST, SECOND]);
    expect(Object.isFrozen(spec.choiceOrder)).toBe(true);
  });
});

describe("fieldActionBarRequired", () => {
  it("is required even when the target list is open (T7 constant status)", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          offFieldCardChoice(FIRST, "graveyard"),
          offFieldCardChoice(SECOND, "graveyard", 1),
        ],
        minimum: 1,
        maximum: 2,
      }),
    );

    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for a mixed prompt (T7 constant status)", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [
          mountedCardChoice(FIRST),
          offFieldCardChoice(SECOND, "banished"),
        ],
        minimum: 1,
        maximum: 2,
      }),
    );

    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  /* Answerability outranks the suppression: a Finish/Cancel choice has no
     field control of its own, so target mode must not hide its window. */
  it("is still required when a genuine global choice accompanies the targets", () => {
    const spec = specFor(
      prompt("selectUnselectCard", {
        choices: [
          offFieldCardChoice(FIRST, "graveyard"),
          choice(choiceId("finish"), { action: "finish", label: "Finish" }),
        ],
      }),
    );

    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for an exact singleton card selection (T7 constant status)", () => {
    const spec = specFor(
      prompt("selectCard", { choices: [mountedCardChoice(FIRST)] }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for a multi card selection", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST), mountedCardChoice(SECOND)],
        minimum: 1,
        maximum: 2,
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for counter allocation", () => {
    const spec = specFor(
      prompt("selectCounter", {
        choices: [mountedCardChoice(FIRST, { allocationMaximum: 2 })],
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for order", () => {
    const spec = specFor(
      prompt("sortCard", {
        choices: [mountedCardChoice(FIRST)],
        ordered: true,
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required for a multi-place selection", () => {
    const spec = specFor(
      prompt("selectPlace", {
        choices: [
          choice(FIRST, {
            place: { player: 0, location: "monster", sequence: 0 },
          }),
          choice(SECOND, {
            place: { player: 0, location: "monster", sequence: 1 },
          }),
        ],
        minimum: 2,
        maximum: 2,
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("single placement needs no confirm bar", () => {
    const spec = specFor(
      prompt("selectPlace", {
        choices: [
          choice(FIRST, {
            place: { player: 0, location: "monster", sequence: 0 },
          }),
        ],
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(false);
  });

  it("single placement still shows the bar for global choices", () => {
    const spec = specFor(
      prompt("selectPlace", {
        choices: [
          choice(FIRST, {
            place: { player: 0, location: "monster", sequence: 0 },
          }),
          choice(SECOND, { action: "pass" }),
        ],
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is required when a card action has global choices", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [mountedCardChoice(FIRST), choice(SECOND, { action: "pass" })],
      }),
    );
    expect(spec.kind).toBe("cardAction");
    expect(spec.globalChoices.size).toBeGreaterThan(0);
    expect(fieldActionBarRequired(spec)).toBe(true);
  });

  it("is not required for a bare card action", () => {
    const spec = specFor(
      prompt("idleCommand", { choices: [mountedCardChoice(FIRST)] }),
    );
    expect(spec.kind).toBe("cardAction");
    expect(spec.globalChoices.size).toBe(0);
    expect(fieldActionBarRequired(spec)).toBe(false);
  });

  it("is not required for non-field specs", () => {
    const spec = specFor(prompt("yesNo"));
    expect(spec.kind).toBe("nonField");
    expect(fieldActionBarRequired(spec)).toBe(false);
  });

  it("is not required when endPhase is the only global choice", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [
          mountedCardChoice(FIRST),
          choice(SECOND, { action: "endPhase", label: "End turn" }),
        ],
      }),
    );
    expect(spec.kind).toBe("cardAction");
    expect(fieldActionBarRequired(spec)).toBe(false);
  });

  it("is not required when only phase-transition globals accompany a card action", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [
          mountedCardChoice(FIRST),
          choice(SECOND, { action: "endPhase", label: "End turn" }),
          choice(choiceId("battle-phase"), {
            action: "battlePhase",
            label: "Enter Battle Phase",
          }),
          choice(choiceId("main-phase-2"), {
            action: "mainPhase2",
            label: "Enter Main Phase 2",
          }),
        ],
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(false);
  });

  it("is required when a genuine global choice accompanies the phase transitions", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [
          mountedCardChoice(FIRST),
          choice(SECOND, { action: "endPhase", label: "End turn" }),
          choice(choiceId("battle-phase"), {
            action: "battlePhase",
            label: "Enter Battle Phase",
          }),
          choice(choiceId("pass"), { action: "pass", label: "Pass" }),
        ],
      }),
    );
    expect(fieldActionBarRequired(spec)).toBe(true);
  });
});

describe("isImmediateSingleSelection", () => {
  it("is true for an exact 1/1 constraint", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST)],
        minimum: 1,
        maximum: 1,
      }),
    );
    expect(isImmediateSingleSelection(spec)).toBe(true);
  });

  it("is false for 0/1", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST)],
        minimum: 0,
        maximum: 1,
      }),
    );
    expect(isImmediateSingleSelection(spec)).toBe(false);
  });

  it("is false for 1/2", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST), mountedCardChoice(SECOND)],
        minimum: 1,
        maximum: 2,
      }),
    );
    expect(isImmediateSingleSelection(spec)).toBe(false);
  });

  it("is false for 2/2", () => {
    const spec = specFor(
      prompt("selectCard", {
        choices: [mountedCardChoice(FIRST), mountedCardChoice(SECOND)],
        minimum: 2,
        maximum: 2,
      }),
    );
    expect(isImmediateSingleSelection(spec)).toBe(false);
  });
});

describe("isPhaseTransitionChoice", () => {
  it("is true for battlePhase, mainPhase2 and endPhase", () => {
    expect(isPhaseTransitionChoice({ action: "battlePhase" })).toBe(true);
    expect(isPhaseTransitionChoice({ action: "mainPhase2" })).toBe(true);
    expect(isPhaseTransitionChoice({ action: "endPhase" })).toBe(true);
  });

  it("is false for attack, select and pass", () => {
    expect(isPhaseTransitionChoice({ action: "attack" })).toBe(false);
    expect(isPhaseTransitionChoice({ action: "select" })).toBe(false);
    expect(isPhaseTransitionChoice({ action: "pass" })).toBe(false);
  });
});

describe("endPhaseChoice", () => {
  it("finds the endPhase choice among the spec's global choices", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [
          choice(FIRST, { action: "battlePhase", label: "Enter Battle Phase" }),
          choice(SECOND, { action: "endPhase", label: "End turn" }),
        ],
      }),
    );
    expect(endPhaseChoice(spec)).toEqual(spec.globalChoices.get(SECOND));
  });

  it("returns null when the spec has no endPhase choice", () => {
    const spec = specFor(
      prompt("idleCommand", {
        choices: [
          choice(FIRST, { action: "battlePhase", label: "Enter Battle Phase" }),
        ],
      }),
    );
    expect(endPhaseChoice(spec)).toBeNull();
  });

  it("tolerates a null spec", () => {
    expect(endPhaseChoice(null)).toBeNull();
  });
});

function malformedChoice(value: object): PromptChoice {
  return value as PromptChoice;
}

function collectKeys(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Map) {
    return [...value].flatMap(([key, entry]) => [
      ...collectKeys(key, seen),
      ...collectKeys(entry, seen),
    ]);
  }
  if (Array.isArray(value))
    return value.flatMap((entry) => collectKeys(entry, seen));
  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...collectKeys(entry, seen),
  ]);
}

function containsFunctionOrElement(
  value: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object" || seen.has(value))
    return false;
  seen.add(value);
  if (typeof Element !== "undefined" && value instanceof Element) return true;
  if (value instanceof Map) {
    return [...value].some(
      ([key, entry]) =>
        containsFunctionOrElement(key, seen) ||
        containsFunctionOrElement(entry, seen),
    );
  }
  return Object.values(value).some((entry) =>
    containsFunctionOrElement(entry, seen),
  );
}
