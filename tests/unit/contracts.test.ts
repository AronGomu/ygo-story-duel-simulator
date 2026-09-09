import { describe, expect, it } from "vitest";
import {
  DuelCommandValidationError,
  parseDuelCommand,
  type DuelCommand,
} from "../../src/battle/duel/contracts/duel-command.ts";
import {
  parseDuelWorkerEvent,
  type DuelWorkerEvent,
} from "../../src/battle/duel/contracts/duel-worker-event.ts";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  duelId,
  promptId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";
import { assertStructuredCloneSafe } from "../../src/battle/duel/contracts/structured-clone.ts";
import { deckSlots } from "../fixtures/board-public-states.ts";

const examples: readonly (DuelCommand | DuelWorkerEvent)[] = [
  { type: "initialize" },
  {
    type: "startDuel",
    duelId: duelId("mvp-preset-v1"),
    player: { kind: "preset", deckId: "chapter-one-starter" },
    opponent: { kind: "cards", main: [46986414], extra: [], side: [] },
  },
  {
    type: "respond",
    promptId: promptId("prompt-1"),
    choiceIds: [choiceId("choice-1")],
  },
  { type: "surrender" },
  { type: "requestDiagnostics" },
  { type: "restore" },
  { type: "dispose" },
  { type: "ready", coreVersion: [11, 0] },
  { type: "disposed", clean: true },
  { type: "restored" },
  { type: "restore_failed", reason: "replay_diverged", detail: "prompt 4" },
  { type: "loading", stage: "snapshot", progress: 0.5 },
  {
    type: "state",
    state: {
      snapshotId: snapshotId("a".repeat(64)),
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
          deck: deckSlots(0, 35),
          extraDeckCount: 0,
          handCount: 0,
          hand: [],
          extraDeck: [],
          monsters: [],
          spellsAndTraps: [],
          graveyard: [],
          banished: [],
        },
        {
          player: 1,
          lifePoints: 8000,
          deckCount: 35,
          deck: deckSlots(1, 35),
          extraDeckCount: 0,
          handCount: 5,
          hand: [],
          extraDeck: [],
          monsters: [],
          spellsAndTraps: [],
          graveyard: [],
          banished: [],
        },
      ],
      chain: [],
    },
  },
  {
    type: "event",
    eventSequence: 1,
    event: { type: "phaseChanged", phase: "main1" },
  },
  {
    type: "result",
    result: { type: "completed", winner: 0, loser: 1, reason: 1 },
  },
  {
    type: "prompt",
    prompt: {
      id: promptId("sum-prompt"),
      kind: "selectSum",
      player: 0,
      title: "Select a valid total",
      choices: [
        {
          id: choiceId("sum-choice"),
          label: "Contribution",
          action: "select",
          card: {
            instanceId: cardInstanceId("sum-card"),
            code: cardCode(97590747),
            controller: 0,
            location: "hand",
            sequence: 0,
            contribution: 2,
            alternativeContribution: 3,
          },
        },
      ],
      minimum: 1,
      maximum: 1,
      cancelable: false,
      ordered: false,
      requiredTotal: 3,
      sumMode: "exact",
      mandatoryContributions: [],
    },
  },
  {
    type: "diagnostics",
    trace: {
      schemaVersion: 2,
      sensitivity: "contains-production-seed",
      presetId: "mvp-preset-v1",
      snapshotId: snapshotId("a".repeat(64)),
      seed: ["1", "2", "3", "4"],
      coreVersion: [11, 0],
      revisions: {
        enginePackage: "ocgcore-wasm",
        engineVersion: "0.1.2",
        babelCdb: "babel",
        cardScripts: "scripts",
        distribution: "strings",
        activeImageManifestSha256: "b".repeat(64),
      },
      entries: [],
    },
  },
  {
    type: "error",
    error: {
      code: "engine_initialization_failed",
      message: "failed",
      recoverable: false,
    },
  },
];

// These compile-only fixtures prove that boundary commands cannot acquire
// non-cloneable payloads without failing the strict TypeScript gate.
// @ts-expect-error bigint is not part of the initialize command contract
const nonCloneableBigIntCommand: DuelCommand = { type: "initialize", seed: 1n };
const nonCloneableFunctionCommand: DuelCommand = {
  type: "initialize",
  // @ts-expect-error functions are not part of the initialize command contract
  callback: () => undefined,
};
void nonCloneableBigIntCommand;
void nonCloneableFunctionCommand;

function contractPlayer(player: 0 | 1, deckCount: number) {
  return {
    player,
    lifePoints: 8000,
    deckCount,
    deck: deckSlots(player, deckCount),
    extraDeckCount: 0,
    handCount: 0,
    hand: [],
    extraDeck: [],
    monsters: [],
    spellsAndTraps: [],
    graveyard: [],
    banished: [],
  };
}

describe("Worker contracts", () => {
  it.each(examples)("survives structured cloning: $type", (example) => {
    expect(() => assertStructuredCloneSafe(example)).not.toThrow();
    expect(structuredClone(example)).toEqual(example);
  });

  it("rejects a mismatched deck length", () => {
    const player = contractPlayer(0, 40);
    expect(() =>
      parseDuelWorkerEvent({
        type: "state",
        state: {
          snapshotId: "a".repeat(64),
          revision: 0,
          turn: 0,
          turnPlayer: 0,
          phase: "unknown",
          layout: { extraMonsterZones: true },
          players: [
            { ...player, deck: player.deck.slice(0, 39) },
            contractPlayer(1, 40),
          ],
          chain: [],
        },
      }),
    ).toThrow("deck count");
  });

  it("rejects a display order outside the hand", () => {
    const player = contractPlayer(0, 40);
    const card = {
      instanceId: "card-1",
      code: 97590747,
      owner: 0 as const,
      controller: 0 as const,
      location: "graveyard" as const,
      sequence: 0,
      displayOrder: 0,
      position: "faceUpAttack" as const,
      faceUp: true,
      counters: [],
      overlayMaterials: [],
    };
    expect(() =>
      parseDuelWorkerEvent({
        type: "state",
        state: {
          snapshotId: "a".repeat(64),
          revision: 0,
          turn: 0,
          turnPlayer: 0,
          phase: "unknown",
          layout: { extraMonsterZones: true },
          players: [{ ...player, graveyard: [card] }, contractPlayer(1, 40)],
          chain: [],
        },
      }),
    ).toThrow("graveyard[0].displayOrder");
  });

  it.each([
    ["missing", undefined],
    ["non-boolean", { extraMonsterZones: "false" }],
    ["empty", {}],
    ["extended", { extraMonsterZones: true, rules: "mr5" }],
  ])("rejects a %s projected layout", (_label, layout) => {
    expect(() =>
      parseDuelWorkerEvent({
        type: "state",
        state: {
          snapshotId: "a".repeat(64),
          revision: 0,
          turn: 0,
          turnPlayer: 0,
          phase: "unknown",
          ...(layout === undefined ? {} : { layout }),
          players: [contractPlayer(0, 40), contractPlayer(1, 40)],
          chain: [],
        },
      }),
    ).toThrow(/invalid|layout/);
  });

  it.each([true, false])(
    "accepts either immutable Extra Monster Zone layout: %s",
    (extraMonsterZones) => {
      const event = {
        type: "state" as const,
        state: {
          snapshotId: "a".repeat(64),
          revision: 0,
          turn: 0,
          turnPlayer: 0 as const,
          phase: "unknown" as const,
          layout: { extraMonsterZones },
          players: [contractPlayer(0, 40), contractPlayer(1, 40)],
          chain: [],
        },
      };

      expect(parseDuelWorkerEvent(event)).toEqual(event);
    },
  );

  it("carries recovery on the error that offers it and nothing else", () => {
    const failure = {
      code: "engine_error",
      message: "ocgcore rejected the previous response",
      recoverable: false,
    };
    for (const event of [
      { type: "error", error: failure },
      { type: "error", error: failure, canRestore: false },
      { type: "error", error: failure, canRestore: true },
      { type: "restored" },
      { type: "restore_failed", reason: "no_restore_point" },
      { type: "restore_failed", reason: "duel_active" },
      { type: "restore_failed", reason: "replay_failed", detail: "refused" },
    ]) {
      expect(parseDuelWorkerEvent(event)).toEqual(event);
    }

    expect(() =>
      parseDuelWorkerEvent({
        type: "error",
        error: failure,
        canRestore: "yes",
      }),
    ).toThrow("error.canRestore");
    expect(() =>
      parseDuelWorkerEvent({ type: "restored", promptId: "worker-prompt-1" }),
    ).toThrow("restored event.promptId");
    expect(() =>
      parseDuelWorkerEvent({ type: "restore_failed", reason: "because" }),
    ).toThrow("restore_failed.reason");
    expect(() =>
      parseDuelWorkerEvent({
        type: "restore_failed",
        reason: "replay_failed",
        trace: {},
      }),
    ).toThrow("restore_failed event.trace");
  });

  it("requires a positive safe presentation event sequence", () => {
    expect(
      parseDuelWorkerEvent({
        type: "event",
        eventSequence: 1,
        event: { type: "phaseChanged", phase: "main1" },
      }),
    ).toEqual({
      type: "event",
      eventSequence: 1,
      event: { type: "phaseChanged", phase: "main1" },
    });

    for (const eventSequence of [
      undefined,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const candidate = {
        type: "event",
        ...(eventSequence === undefined ? {} : { eventSequence }),
        event: { type: "phaseChanged", phase: "main1" },
      };
      expect(() => parseDuelWorkerEvent(candidate)).toThrow();
    }
    expect(() =>
      parseDuelWorkerEvent({
        type: "event",
        eventSequence: 1,
        event: { type: "phaseChanged", phase: "main1" },
        duplicate: true,
      }),
    ).toThrow("presentation event.duplicate");
  });

  it("parses a startDuel command with preset selections", () => {
    expect(
      parseDuelCommand({
        type: "startDuel",
        duelId: "mvp-preset-v1",
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
    ).toEqual({
      type: "startDuel",
      duelId: "mvp-preset-v1",
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
  });

  it("rejects an unexpected startDuel command field", () => {
    expect(() =>
      parseDuelCommand({
        type: "startDuel",
        duelId: "mvp-preset-v1",
        player: { kind: "preset", deckId: "chapter-one-starter" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
        seed: 42,
      }),
    ).toThrow(DuelCommandValidationError);
  });

  it("rejects a startDuel command with an unknown deck id", () => {
    expect(() =>
      parseDuelCommand({
        type: "startDuel",
        duelId: "mvp-preset-v1",
        player: { kind: "preset", deckId: "evil" },
        opponent: { kind: "preset", deckId: "chapter-one-practice" },
      }),
    ).toThrow("Duel deck selection deckId is not a bundled deck");
  });

  it("rejects a startDuel command missing the deck selections", () => {
    expect(() =>
      parseDuelCommand({ type: "startDuel", duelId: "mvp-preset-v1" }),
    ).toThrow();
  });

  it("validates untrusted Worker commands and bounds response selections", () => {
    expect(
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: ["choice-1", "choice-2"],
      }),
    ).toEqual({
      type: "respond",
      promptId: "prompt-1",
      choiceIds: ["choice-1", "choice-2"],
    });
    expect(() => parseDuelCommand({ type: "unknown" })).toThrow(
      "Unsupported duel command",
    );
    expect(() =>
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: Array.from({ length: 257 }, () => "choice"),
      }),
    ).toThrow("at most 256 choice IDs");

    const sparseChoices = new Array<string>(1);
    expect(() =>
      parseDuelCommand({
        type: "respond",
        promptId: "prompt-1",
        choiceIds: sparseChoices,
      }),
    ).toThrow("dense array");

    const dangerousType = {
      toString: () => {
        throw new Error("must not stringify untrusted command data");
      },
    };
    expect(() => parseDuelCommand({ type: dangerousType })).toThrow(
      "Unsupported duel command",
    );
  });

  it.each([
    {
      type: "event",
      eventSequence: 1,
      event: { type: "phaseChanged" },
    },
    {
      type: "state",
      state: {
        snapshotId: "snapshot",
        revision: 1,
        turn: 1,
        turnPlayer: 0,
        phase: "main1",
        layout: { extraMonsterZones: true },
        players: [null, null],
        chain: [],
      },
    },
    {
      type: "prompt",
      prompt: {
        id: "prompt",
        kind: "selectSum",
        player: 0,
        title: "Select",
        choices: [],
        minimum: 0,
        maximum: 0,
        cancelable: false,
        ordered: false,
        mandatoryContributions: "wrong",
      },
    },
    { type: "result", result: { type: "completed", winner: 0 } },
  ])("rejects malformed Worker event payloads", (event) => {
    expect(() => parseDuelWorkerEvent(event)).toThrow(
      /invalid|must be an object/,
    );
  });

  it("rejects opponent decisions and concealed opponent prompt identities", () => {
    expect(() =>
      parseDuelWorkerEvent({
        type: "prompt",
        prompt: {
          id: "opponent-prompt",
          kind: "yesNo",
          player: 1,
          title: "Private decision",
          choices: [],
          minimum: 0,
          maximum: 0,
          cancelable: false,
          ordered: false,
        },
      }),
    ).toThrow(/privacy/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "prompt",
        prompt: {
          id: "concealed-card",
          kind: "selectCard",
          player: 0,
          title: "Select",
          choices: [
            {
              id: "private-choice",
              label: "Private card",
              action: "select",
              card: {
                instanceId: "private-card",
                code: 123,
                name: "Leaked identity",
                controller: 1,
                location: "hand",
                sequence: 0,
              },
            },
          ],
          minimum: 1,
          maximum: 1,
          cancelable: false,
          ordered: false,
        },
      }),
    ).toThrow(/identity privacy/);
  });

  it("accepts projector-attested code on an opponent face-down fixed field card", () => {
    const event = structuredClone(
      examples.find((example) => example.type === "state"),
    );
    if (event?.type !== "state") throw new Error("State fixture missing");
    const opponent = event.state.players[1] as unknown as Record<
      string,
      unknown
    >;
    const hiddenCard = (
      location: "monster" | "spellTrap",
      sequence: number,
    ) => ({
      instanceId: cardInstanceId(`known-${location}`),
      code: cardCode(5053103),
      owner: 1,
      controller: 1,
      location,
      sequence,
      position: "faceDownDefense",
      faceUp: false,
      counters: [],
      overlayMaterials: [],
    });
    opponent.monsters = [hiddenCard("monster", 0)];
    opponent.spellsAndTraps = [hiddenCard("spellTrap", 0)];

    expect(() => parseDuelWorkerEvent(event)).not.toThrow();
  });

  it.each(["deck", "hand", "extraDeck", "banished"] as const)(
    "still rejects code in concealed opponent %s",
    (zone) => {
      const event = structuredClone(
        examples.find((example) => example.type === "state"),
      );
      if (event?.type !== "state") throw new Error("State fixture missing");
      const opponent = event.state.players[1] as unknown as Record<
        string,
        unknown
      >;
      const locations = {
        deck: "deck",
        hand: "hand",
        extraDeck: "extra",
        banished: "banished",
      } as const;
      const hidden = {
        instanceId: cardInstanceId(`private-${zone}`),
        code: cardCode(5053103),
        owner: 1,
        controller: 1,
        location: locations[zone],
        sequence: 0,
        position: "faceDownDefense",
        faceUp: false,
        counters: [],
        overlayMaterials: [],
      };
      if (zone === "deck") {
        opponent.deckCount = 1;
        opponent.deck = [hidden];
      } else {
        if (zone === "hand") opponent.handCount = 1;
        if (zone === "extraDeck") opponent.extraDeckCount = 1;
        opponent[zone] = [hidden];
      }

      expect(() => parseDuelWorkerEvent(event)).toThrow(/code privacy/);
    },
  );

  it("enforces Extra/material privacy, uniqueness, shallow shape, and global bounds", () => {
    const baseEvent = structuredClone(
      examples.find((example) => example.type === "state"),
    );
    if (baseEvent?.type !== "state") throw new Error("State fixture missing");
    const hiddenOpponentExtra = {
      instanceId: cardInstanceId("opponent-hidden-extra"),
      owner: 1 as const,
      controller: 1 as const,
      location: "extra" as const,
      sequence: 0,
      position: "faceDownDefense" as const,
      faceUp: false,
      counters: [],
      overlayMaterials: [],
    };
    const opponent = baseEvent.state.players[1] as unknown as Record<
      string,
      unknown
    >;
    opponent.extraDeckCount = 1;
    opponent.extraDeck = [hiddenOpponentExtra];
    const parsed = parseDuelWorkerEvent(baseEvent);
    expect(structuredClone(parsed)).toEqual(parsed);
    const missingCollection = structuredClone(baseEvent) as unknown as Record<
      string,
      unknown
    >;
    const missingPlayer = (
      (missingCollection.state as Record<string, unknown>).players as Record<
        string,
        unknown
      >[]
    )[0]!;
    delete missingPlayer.extraDeck;
    expect(() => parseDuelWorkerEvent(missingCollection)).toThrow(/extraDeck/);

    const leaked = structuredClone(baseEvent);
    if (leaked.type !== "state") throw new Error("State fixture missing");
    const leakedOpponent = leaked.state.players[1] as unknown as Record<
      string,
      unknown
    >;
    leakedOpponent.extraDeck = [
      { ...hiddenOpponentExtra, code: cardCode(5053103) },
    ];
    expect(() => parseDuelWorkerEvent(leaked)).toThrow(/code privacy/);

    const duplicate = structuredClone(baseEvent);
    if (duplicate.type !== "state") throw new Error("State fixture missing");
    const duplicateHuman = duplicate.state.players[0] as unknown as Record<
      string,
      unknown
    >;
    duplicateHuman.monsters = [
      {
        instanceId: cardInstanceId("host"),
        code: cardCode(97590747),
        owner: 0,
        controller: 0,
        location: "monster",
        sequence: 0,
        position: "faceUpAttack",
        faceUp: true,
        counters: [],
        overlayMaterials: [
          {
            instanceId: cardInstanceId("host"),
            code: cardCode(5053103),
            identityVisible: true,
            sequence: 0,
          },
        ],
      },
    ];
    expect(() => parseDuelWorkerEvent(duplicate)).toThrow(/duplicate/);

    const nested = structuredClone(duplicate) as unknown as Record<
      string,
      unknown
    >;
    const nestedMaterial = (
      (
        (nested.state as Record<string, unknown>).players as Record<
          string,
          unknown
        >[]
      )[0]!.monsters as Record<string, unknown>[]
    )[0]!.overlayMaterials as Record<string, unknown>[];
    nestedMaterial[0]!.instanceId = "material";
    nestedMaterial[0]!.overlayMaterials = [];
    expect(() => parseDuelWorkerEvent(nested)).toThrow(/overlayMaterials/);

    const tooMany = structuredClone(baseEvent);
    if (tooMany.type !== "state") throw new Error("State fixture missing");
    const makeCard = (index: number, location: "hand" | "graveyard") => ({
      instanceId: cardInstanceId(`bounded-${location}-${index}`),
      code: cardCode(97590747),
      owner: 0 as const,
      controller: 0 as const,
      location,
      sequence: index,
      position: "faceUpAttack" as const,
      faceUp: true,
      counters: [],
      overlayMaterials: [],
    });
    const manyHuman = tooMany.state.players[0] as unknown as Record<
      string,
      unknown
    >;
    manyHuman.handCount = 128;
    manyHuman.hand = Array.from({ length: 128 }, (_, index) =>
      makeCard(index, "hand"),
    );
    manyHuman.graveyard = Array.from({ length: 129 }, (_, index) =>
      makeCard(index, "graveyard"),
    );
    expect(() => parseDuelWorkerEvent(tooMany)).toThrow(/instance limit/);
  });

  it("rejects inconsistent Extra collections and overlay material shapes", () => {
    const fixture = structuredClone(
      examples.find((example) => example.type === "state"),
    );
    if (fixture?.type !== "state") throw new Error("State fixture missing");
    const own = fixture.state.players[0] as unknown as Record<string, unknown>;
    const ownExtra = {
      instanceId: cardInstanceId("own-extra"),
      code: cardCode(97590747),
      owner: 0,
      controller: 0,
      location: "extra",
      sequence: 0,
      position: "faceDownDefense",
      faceUp: false,
      counters: [],
      overlayMaterials: [],
    };

    own.extraDeckCount = 2;
    own.extraDeck = [ownExtra];
    expect(() => parseDuelWorkerEvent(fixture)).toThrow(
      /complete own collection/,
    );

    own.extraDeckCount = 1;
    own.extraDeck = [{ ...ownExtra, owner: 1 }];
    expect(() => parseDuelWorkerEvent(fixture)).toThrow(/owner/);

    own.extraDeck = [{ ...ownExtra, sequence: 1 }];
    expect(() => parseDuelWorkerEvent(fixture)).toThrow(/sequence order/);
    own.extraDeckCount = 0;
    own.extraDeck = [];

    const opponent = fixture.state.players[1] as unknown as Record<
      string,
      unknown
    >;
    opponent.extraDeckCount = 0;
    opponent.extraDeck = [
      {
        ...ownExtra,
        instanceId: cardInstanceId("opponent-extra"),
        owner: 1,
        controller: 1,
        code: undefined,
      },
    ];
    expect(() => parseDuelWorkerEvent(fixture)).toThrow(/extraDeck count/);

    own.extraDeckCount = 0;
    own.extraDeck = [];
    opponent.extraDeck = [];
    const host = {
      instanceId: cardInstanceId("material-host"),
      code: cardCode(97590747),
      owner: 0,
      controller: 0,
      location: "monster",
      sequence: 0,
      position: "faceUpAttack",
      faceUp: true,
      counters: [],
      overlayMaterials: [
        {
          instanceId: cardInstanceId("material"),
          code: cardCode(5053103),
          identityVisible: false,
          sequence: 0,
        },
      ],
    };
    own.monsters = [host];
    const material = host.overlayMaterials[0] as Record<string, unknown>;
    for (const key of ["code", "identityVisible"] as const) {
      const original = material[key];
      delete material[key];
      expect(() => parseDuelWorkerEvent(fixture)).toThrow(
        new RegExp(`${key}$`),
      );
      material[key] = original;
    }
    for (const key of ["owner", "controller"] as const) {
      material[key] = 0;
      expect(() => parseDuelWorkerEvent(fixture)).toThrow(
        new RegExp(`${key}$`),
      );
      delete material[key];
    }

    host.overlayMaterials[0]!.sequence = 1;
    expect(() => parseDuelWorkerEvent(fixture)).toThrow(/sequence order/);
  });

  it("validates exact counter and actual chain contracts with recursive bounds", () => {
    const base = structuredClone(
      examples.find((example) => example.type === "state"),
    );
    if (base?.type !== "state") throw new Error("State fixture missing");
    const card = {
      instanceId: cardInstanceId("counter-host"),
      code: cardCode(97590747),
      owner: 0 as const,
      controller: 0 as const,
      location: "monster" as const,
      sequence: 0,
      position: "faceUpAttack" as const,
      faceUp: true,
      counters: [
        { type: 1, name: "Spell Counter", count: 2 },
        { type: 0x1002, name: "Signal Counter", count: 1 },
      ],
      overlayMaterials: [],
    };
    const stateOf = (event: unknown) =>
      (event as { state: unknown }).state as {
        players: [Record<string, unknown>, Record<string, unknown>];
        chain: Record<string, unknown>[];
      };
    const mutableState = stateOf(base);
    mutableState.players[0].monsters = [card];
    mutableState.chain = [
      {
        index: 1,
        controller: 1,
        sourceIdentityVisible: true,
        sourceInstanceId: card.instanceId,
        sourceCard: card.code,
        label: "Visible Source",
        description: "Resolved effect",
        phase: "solving",
        outcome: "disabled",
        targets: [
          {
            identityVisible: true,
            controller: 0,
            location: "monster",
            instanceId: card.instanceId,
            card: card.code,
          },
          { identityVisible: false, controller: 1, location: "spellTrap" },
        ],
      },
      {
        index: 2,
        controller: 0,
        sourceIdentityVisible: false,
        label: "Card effect",
        phase: "pending",
        outcome: "normal",
      },
    ];
    const parsed = parseDuelWorkerEvent(base);
    expect(structuredClone(parsed)).toEqual(parsed);

    const mutate = (change: (event: unknown) => void) => {
      const event: unknown = structuredClone(base);
      change(event);
      return () => parseDuelWorkerEvent(event);
    };
    expect(
      mutate((event) => {
        const monsters = stateOf(event).players[0].monsters as Record<
          string,
          unknown
        >[];
        delete monsters[0]!.counters;
      }),
    ).toThrow(/counters/);
    expect(
      mutate((event) => {
        const monsters = stateOf(event).players[0].monsters as Record<
          string,
          unknown
        >[];
        monsters[0]!.counters = [
          { type: 2, name: "Two", count: 1 },
          { type: 1, name: "One", count: 1 },
        ];
      }),
    ).toThrow(/type order/);
    expect(
      mutate((event) => {
        const monsters = stateOf(event).players[0].monsters as Record<
          string,
          unknown
        >[];
        monsters[0]!.counters = [{ type: 1, name: "One", count: 0 }];
      }),
    ).toThrow(/count/);
    expect(
      mutate((event) => {
        stateOf(event).chain[0]!.index = 2;
      }),
    ).toThrow(/index order/);
    expect(
      mutate((event) => {
        const chain = stateOf(event).chain;
        chain[1] = { ...chain[1]!, sourceCard: cardCode(5053103) };
      }),
    ).toThrow(/hidden source identity/);
    expect(
      mutate((event) => {
        const chain = stateOf(event).chain;
        chain[1] = { ...chain[1]!, label: "Leaked source" };
      }),
    ).toThrow(/hidden source identity/);

    const contractMutations: readonly [
      string,
      (event: unknown) => void,
      RegExp,
    ][] = [
      [
        "counter exact keys",
        (event) => {
          const monsters = stateOf(event).players[0].monsters as Record<
            string,
            unknown
          >[];
          (monsters[0]!.counters as Record<string, unknown>[])[0]!.extra = 1;
        },
        /extra/,
      ],
      [
        "counter trimmed name",
        (event) => {
          const monsters = stateOf(event).players[0].monsters as Record<
            string,
            unknown
          >[];
          (monsters[0]!.counters as Record<string, unknown>[])[0]!.name =
            " Spell Counter ";
        },
        /name/,
      ],
      [
        "chain exact keys",
        (event) => {
          stateOf(event).chain[0]!.extra = 1;
        },
        /extra/,
      ],
      [
        "chain target hidden identity",
        (event) => {
          const targets = stateOf(event).chain[0]!.targets as Record<
            string,
            unknown
          >[];
          targets[1]!.card = cardCode(5053103);
        },
        /hidden target identity/,
      ],
      [
        "chain target location enum",
        (event) => {
          const targets = stateOf(event).chain[0]!.targets as Record<
            string,
            unknown
          >[];
          targets[0]!.location = "pendulum";
        },
        /location/,
      ],
      [
        "chain target exact keys",
        (event) => {
          const targets = stateOf(event).chain[0]!.targets as Record<
            string,
            unknown
          >[];
          targets[0]!.extra = 1;
        },
        /extra/,
      ],
      [
        "chain phase enum",
        (event) => {
          stateOf(event).chain[0]!.phase = "unknown";
        },
        /phase/,
      ],
      [
        "chain outcome enum",
        (event) => {
          stateOf(event).chain[0]!.outcome = "unknown";
        },
        /outcome/,
      ],
      [
        "visible source requires instance",
        (event) => {
          delete stateOf(event).chain[0]!.sourceInstanceId;
        },
        /visible source identity/,
      ],
      [
        "chain label trim",
        (event) => {
          stateOf(event).chain[0]!.label = " Visible Source ";
        },
        /label/,
      ],
      [
        "chain description trim",
        (event) => {
          stateOf(event).chain[0]!.description = " Resolved effect ";
        },
        /description/,
      ],
    ];
    for (const [, change, expected] of contractMutations)
      expect(mutate(change)).toThrow(expected);

    expect(
      mutate((event) => {
        const monsters = stateOf(event).players[0].monsters as Record<
          string,
          unknown
        >[];
        monsters[0]!.counters = Array.from({ length: 257 }, (_, index) => ({
          type: index + 1,
          name: `Counter ${index + 1}`,
          count: 1,
        }));
      }),
    ).toThrow(/counters/);
    const exactChain: unknown = structuredClone(base);
    stateOf(exactChain).chain = Array.from({ length: 255 }, (_, index) => ({
      index: index + 1,
      controller: 0,
      sourceIdentityVisible: false,
      label: "Card effect",
      phase: "pending",
      outcome: "normal",
    }));
    expect(() => parseDuelWorkerEvent(exactChain)).not.toThrow();
    expect(
      mutate((event) => {
        stateOf(event).chain = Array.from({ length: 256 }, (_, index) => ({
          index: index + 1,
          controller: 0,
          sourceIdentityVisible: false,
          label: "Card effect",
          phase: "pending",
          outcome: "normal",
        }));
      }),
    ).toThrow(/state.chain/);

    const exactText: unknown = structuredClone(base);
    const exactTextState = stateOf(exactText);
    exactTextState.chain = [];
    const exactTextCards = exactTextState.players[0].monsters as Record<
      string,
      unknown
    >[];
    exactTextCards[0]!.counters = Array.from({ length: 256 }, (_, index) => ({
      type: index + 1,
      name: "x".repeat(1_024),
      count: 1,
    }));
    expect(() => parseDuelWorkerEvent(exactText)).not.toThrow();
    exactTextState.chain = [
      {
        index: 1,
        controller: 0,
        sourceIdentityVisible: false,
        label: "Card effect",
        phase: "pending",
        outcome: "normal",
      },
    ];
    expect(() => parseDuelWorkerEvent(exactText)).toThrow(/text limit/);

    const fanIn: unknown = structuredClone(base);
    const fanInState = stateOf(fanIn);
    fanInState.chain = [];
    fanInState.players[0].handCount = 1;
    fanInState.players[0].extraDeckCount = 1;
    fanInState.players[0].hand = [
      {
        ...card,
        instanceId: cardInstanceId("counter-hand"),
        location: "hand",
        sequence: 0,
      },
    ];
    fanInState.players[0].extraDeck = [
      {
        ...card,
        instanceId: cardInstanceId("counter-extra"),
        location: "extra",
        sequence: 0,
      },
    ];
    fanInState.players[0].monsters = [
      { ...card, instanceId: cardInstanceId("counter-fixed") },
    ];
    expect(() => parseDuelWorkerEvent(fanIn)).not.toThrow();
    for (const zone of ["hand", "extraDeck", "monsters"] as const) {
      const missing: unknown = structuredClone(fanIn);
      const player = stateOf(missing).players[0];
      const cards = player[zone] as Record<string, unknown>[];
      delete cards[0]!.counters;
      expect(() => parseDuelWorkerEvent(missing)).toThrow(/counters/);
    }

    const global: unknown = structuredClone(base);
    const globalState = stateOf(global);
    globalState.chain = [];
    globalState.players[0].monsters = [];
    globalState.players[0].graveyard = Array.from(
      { length: 5 },
      (_, cardIndex) => ({
        ...card,
        instanceId: cardInstanceId(`counter-host-${cardIndex}`),
        location: "graveyard" as const,
        sequence: cardIndex,
        counters: Array.from({ length: 205 }, (_, index) => ({
          type: index + 1,
          name: `Counter ${index + 1}`,
          count: 1,
        })),
      }),
    );
    expect(() => parseDuelWorkerEvent(global)).toThrow(/counter entry limit/);
  });

  it("returns a detached validated value rather than the untrusted input", () => {
    const input = { type: "ready", coreVersion: [11, 0] };
    const parsed = parseDuelWorkerEvent(input);
    input.coreVersion[0] = 99;
    expect(parsed).toEqual({ type: "ready", coreVersion: [11, 0] });
  });

  it("rejects sparse arrays, contradictory errors, and undeclared fields", () => {
    const sparseVersion = new Array<number>(2);
    sparseVersion[0] = 11;
    expect(() =>
      parseDuelWorkerEvent({ type: "ready", coreVersion: sparseVersion }),
    ).toThrow(/dense array/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "ready",
        coreVersion: [11, 0],
        snapshotId: "not-a-digest",
      }),
    ).toThrow(/snapshotId/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "error",
        error: {
          code: "worker_error",
          message: "failed",
          recoverable: true,
        },
      }),
    ).toThrow(/recoverable/);
    expect(() =>
      parseDuelWorkerEvent({
        type: "loading",
        stage: "manifest",
        privateSeed: 123,
      }),
    ).toThrow(/privateSeed/);
  });

  it.each([1n, () => undefined, Symbol("value")])(
    "rejects non-contract value %s",
    (value) => {
      expect(() => assertStructuredCloneSafe({ value })).toThrow(
        /non-clone contract value/,
      );
    },
  );
});
