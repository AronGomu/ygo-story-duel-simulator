import { describe, expect, it } from "vitest";
import {
  createFakeOcgCoreAdapter,
  EMPTY_DECK,
  FAKE_DEPENDENCIES,
  FAKE_SNAPSHOT_ID,
  type FakeDuelProgram,
} from "../fixtures/fake-ocgcore-adapter.ts";
import { DuelSession } from "../../src/worker/engine/DuelSession.ts";
import {
  EngineMessageType,
  EngineProcess,
} from "../../src/worker/engine/engine-constants.ts";
import { HeadlessDuelController } from "../../src/worker/HeadlessDuelController.ts";

const WIN_MESSAGE = {
  type: EngineMessageType.WIN,
  player: 1,
  reason: 1,
} as const;

describe("headless duel handle lifecycle", () => {
  it("destroys the core handle exactly once after MSG_WIN", async () => {
    const { controller, session, harness } = await createController({
      steps: [
        {
          status: EngineProcess.END,
          messages: [WIN_MESSAGE],
        },
      ],
    });

    expect(controller.advance().result).toEqual({
      type: "completed",
      winner: 1,
      loser: 0,
      reason: 1,
    });
    expect(session.disposed).toBe(true);
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
    expect(harness.activeHandles()).toBe(0);
    expect(controller.trace().entries).toContainEqual(
      expect.objectContaining({
        kind: "process",
        status: EngineProcess.END,
        detail: "iteration 1 of 1",
      }),
    );
    expect(controller.trace().entries.at(-1)).toMatchObject({
      kind: "lifecycle",
      detail: "session_closed:completed",
    });

    controller.dispose();
    expect(harness.counters.destroyDuel).toBe(1);
  });

  it("prioritizes a terminal result over an earlier prompt in the same core batch", async () => {
    const { controller, session, harness } = await createController({
      steps: [
        {
          status: EngineProcess.END,
          messages: [
            {
              type: EngineMessageType.SELECT_YES_NO,
              player: 0,
              description: 0n,
            },
            WIN_MESSAGE,
          ],
        },
      ],
    });

    const advance = controller.advance();
    expect(advance.prompt).toBeUndefined();
    expect(advance.result).toEqual({
      type: "completed",
      winner: 1,
      loser: 0,
      reason: 1,
    });
    expect(session.disposed).toBe(true);
    expect(harness.counters.destroyDuel).toBe(1);
  });

  it("preserves both creation and cleanup failures", async () => {
    const cleanupError = new Error("fake creation cleanup failure");
    const harness = await createFakeOcgCoreAdapter(() => ({ steps: [] }), {
      destroyError: cleanupError,
    });

    let failure: unknown;
    try {
      DuelSession.create({
        adapter: harness.adapter,
        dependencies: FAKE_DEPENDENCIES,
        playerDeck: EMPTY_DECK,
        opponentDeck: EMPTY_DECK,
        configuration: {
          mode: "programmed",
          seed: [1n, 2n, 3n, 4n],
          playerDeckOrder: EMPTY_DECK.main,
          opponentDeckOrder: EMPTY_DECK.main,
          startupScripts: [{ name: "../invalid.lua", source: "return" }],
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({
        message: "Invalid startup script name: ../invalid.lua",
      }),
      cleanupError,
    ]);
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
  });

  it("does not retry an uncertain core destruction after cleanup throws", async () => {
    const destroyError = new Error("fake destroy failure");
    const { controller, session, harness } = await createController(
      {
        steps: [
          {
            status: EngineProcess.END,
            messages: [WIN_MESSAGE],
          },
        ],
      },
      10,
      destroyError,
    );

    expect(() => controller.advance()).toThrow("fake destroy failure");
    expect(session.disposed).toBe(true);
    expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
    expect(harness.activeHandles()).toBe(1);

    expect(() => controller.dispose()).not.toThrow();
    expect(harness.counters.destroyDuel).toBe(1);
  });

  it.each([
    {
      name: "engine failure",
      program: {
        steps: [{ error: new Error("fake engine failure") }],
      } satisfies FakeDuelProgram,
      maximumProcessIterations: 10,
      expectedMessage: "fake engine failure",
    },
    {
      name: "process timeout",
      program: {
        steps: [],
        fallback: { status: EngineProcess.CONTINUE },
      } satisfies FakeDuelProgram,
      maximumProcessIterations: 2,
      expectedMessage: "exceeded 2 process iterations",
    },
    {
      name: "unsupported waiting state",
      program: {
        steps: [{ status: EngineProcess.WAITING }],
      } satisfies FakeDuelProgram,
      maximumProcessIterations: 10,
      expectedMessage: "waiting but emitted no supported player prompt",
    },
  ])(
    "destroys the core handle exactly once after $name",
    async ({ program, maximumProcessIterations, expectedMessage }) => {
      const { controller, session, harness } = await createController(
        program,
        maximumProcessIterations,
      );

      expect(() => controller.advance()).toThrow(expectedMessage);
      expect(session.disposed).toBe(true);
      expect(harness.counters).toEqual({ createDuel: 1, destroyDuel: 1 });
      expect(harness.activeHandles()).toBe(0);
      expect(controller.trace().entries).toContainEqual(
        expect.objectContaining({
          kind: "error",
          detail: expect.stringContaining(expectedMessage),
        }),
      );
      expect(controller.trace().entries.at(-1)).toMatchObject({
        kind: "lifecycle",
        detail: "session_closed:failed",
      });

      controller.dispose();
      expect(harness.counters.destroyDuel).toBe(1);
    },
  );
});

async function createController(
  program: FakeDuelProgram,
  maximumProcessIterations = 10,
  destroyError?: Error,
) {
  const harness = await createFakeOcgCoreAdapter(
    () => program,
    destroyError === undefined ? {} : { destroyError },
  );
  const session = DuelSession.create({
    adapter: harness.adapter,
    dependencies: FAKE_DEPENDENCIES,
    playerDeck: EMPTY_DECK,
    opponentDeck: EMPTY_DECK,
    configuration: {
      mode: "programmed",
      seed: [1n, 2n, 3n, 4n],
      playerDeckOrder: EMPTY_DECK.main,
      opponentDeckOrder: EMPTY_DECK.main,
    },
    maximumProcessIterations,
  });
  const controller = new HeadlessDuelController({
    session,
    dependencies: FAKE_DEPENDENCIES,
    snapshotId: FAKE_SNAPSHOT_ID,
    presetId: "fake-preset",
    deckCounts: [0, 0],
    extraDeckCounts: [0, 0],
  });
  return { controller, session, harness };
}
