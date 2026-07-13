import { duelOperationError } from "../../duel/contracts/duel-error.ts";
import type { CardCode } from "../../duel/contracts/ids.ts";
import type { ParsedDeck } from "../../duel/presets/deck-parser.ts";
import {
  normalizeRequestedScriptName,
  type ActiveDuelDependencies,
} from "../assets/active-duel-dependencies.ts";
import {
  EngineDuelFlag,
  EngineLocation,
  EnginePosition,
  EngineProcess,
} from "./engine-constants.ts";
import type {
  EngineDuelHandle,
  EngineMessage,
  EngineNewCard,
  EngineResponse,
  OcgCoreAdapter,
} from "./OcgCoreAdapter.ts";
import {
  createProductionSeed,
  validateProgrammedSeed,
  type DuelSeed,
} from "./duel-seed.ts";

export interface CoreStartupScript {
  readonly name: string;
  readonly source: string;
}

export interface ProgrammedDuelConfiguration {
  readonly mode: "programmed";
  readonly seed: DuelSeed;
  readonly playerDeckOrder: readonly CardCode[];
  readonly opponentDeckOrder: readonly CardCode[];
  readonly startupScripts?: readonly CoreStartupScript[];
  readonly allowFirstTurnAttack?: boolean;
}

export interface ProductionDuelConfiguration {
  readonly mode: "production";
  /** Worker-internal seam used to create diagnostics before core startup. */
  readonly seed?: DuelSeed;
}

export type DuelConfiguration =
  ProgrammedDuelConfiguration | ProductionDuelConfiguration;

export interface DuelProcessBoundary {
  readonly status: "waiting" | "ended";
  readonly messages: readonly EngineMessage[];
  readonly iterations: number;
}

export interface DuelSessionOptions {
  readonly adapter: OcgCoreAdapter;
  readonly dependencies: ActiveDuelDependencies;
  readonly playerDeck: ParsedDeck;
  readonly opponentDeck: ParsedDeck;
  readonly configuration: DuelConfiguration;
  readonly maximumProcessIterations?: number;
  readonly onEngineDiagnostic?: (entry: {
    readonly type: number;
    readonly message: string;
    readonly error?: unknown;
  }) => void;
}

export class DuelSession {
  readonly seed: DuelSeed;
  readonly #adapter: OcgCoreAdapter;
  readonly #handle: EngineDuelHandle;
  readonly #maximumProcessIterations: number;
  #disposed = false;

  private constructor(
    adapter: OcgCoreAdapter,
    handle: EngineDuelHandle,
    seed: DuelSeed,
    maximumProcessIterations: number,
  ) {
    this.#adapter = adapter;
    this.#handle = handle;
    this.seed = seed;
    this.#maximumProcessIterations = maximumProcessIterations;
  }

  static create(options: DuelSessionOptions): DuelSession {
    const maximumProcessIterations = options.maximumProcessIterations ?? 10_000;
    if (
      !Number.isSafeInteger(maximumProcessIterations) ||
      maximumProcessIterations <= 0
    ) {
      throw new Error(
        `Invalid process iteration limit: ${maximumProcessIterations}`,
      );
    }
    const seed =
      options.configuration.mode === "production"
        ? options.configuration.seed === undefined
          ? createProductionSeed()
          : validateProgrammedSeed(options.configuration.seed)
        : validateProgrammedSeed(options.configuration.seed);
    const missingInputs: string[] = [];
    const handle = options.adapter.createDuel({
      flags:
        EngineDuelFlag.MODE_MR5 |
        (options.configuration.mode === "programmed"
          ? EngineDuelFlag.PSEUDO_SHUFFLE |
            (options.configuration.allowFirstTurnAttack === true
              ? EngineDuelFlag.ATTACK_FIRST_TURN
              : 0n)
          : 0n),
      seed: [...seed],
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader: (code) => {
        const card = options.dependencies.cards.get(code);
        if (card === undefined) missingInputs.push(`card:${code}`);
        return card ?? null;
      },
      scriptReader: (requestedName) => {
        try {
          const name = normalizeRequestedScriptName(requestedName);
          const script = options.dependencies.scripts.get(name);
          if (script !== undefined) return script;
          const cardScript = /^c(\d+)\.lua$/.exec(name);
          const code =
            cardScript?.[1] === undefined ? undefined : Number(cardScript[1]);
          if (
            code === 0 ||
            (code !== undefined && options.dependencies.cards.has(code)) ||
            name === "proc_unofficial.lua"
          ) {
            return null;
          }
          missingInputs.push(`script:${name}`);
          return null;
        } catch (error) {
          missingInputs.push(`script:${requestedName}`);
          options.onEngineDiagnostic?.({
            type: 0,
            message: error instanceof Error ? error.message : String(error),
            error,
          });
          return null;
        }
      },
      errorHandler: (type, message) =>
        options.onEngineDiagnostic?.({ type, message }),
    });
    if (handle === null)
      throw new Error("ocgcore refused to create a duel handle");

    try {
      loadGlobalScripts(options.adapter, handle, options.dependencies.scripts);
      loadStartupScripts(
        options.adapter,
        handle,
        options.configuration.mode === "production"
          ? [PRODUCTION_SHUFFLE_SCRIPT]
          : (options.configuration.startupScripts ?? []),
      );
      const playerOrder =
        options.configuration.mode === "programmed"
          ? options.configuration.playerDeckOrder
          : options.playerDeck.main;
      const opponentOrder =
        options.configuration.mode === "programmed"
          ? options.configuration.opponentDeckOrder
          : options.opponentDeck.main;
      assertSameDeck(options.playerDeck.main, playerOrder, "player");
      assertSameDeck(options.opponentDeck.main, opponentOrder, "opponent");
      addDeck(options.adapter, handle, 0, playerOrder, EngineLocation.DECK);
      addDeck(
        options.adapter,
        handle,
        0,
        options.playerDeck.extra,
        EngineLocation.EXTRA,
      );
      addDeck(options.adapter, handle, 1, opponentOrder, EngineLocation.DECK);
      addDeck(
        options.adapter,
        handle,
        1,
        options.opponentDeck.extra,
        EngineLocation.EXTRA,
      );
      options.adapter.startDuel(handle);
      if (missingInputs.length > 0) {
        throw new Error(
          `Core requested missing dependencies: ${[...new Set(missingInputs)].join(", ")}`,
        );
      }
      return new DuelSession(
        options.adapter,
        handle,
        seed,
        maximumProcessIterations,
      );
    } catch (error) {
      try {
        options.adapter.destroyDuel(handle);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Duel creation failed and core-handle cleanup also failed",
          { cause: error },
        );
      }
      throw error;
    }
  }

  processUntilBoundary(): DuelProcessBoundary {
    this.#assertActive();
    const messages: EngineMessage[] = [];
    for (
      let iteration = 1;
      iteration <= this.#maximumProcessIterations;
      iteration += 1
    ) {
      const status = this.#adapter.process(this.#handle);
      messages.push(...this.#adapter.getMessages(this.#handle));
      if (status === EngineProcess.WAITING)
        return { status: "waiting", messages, iterations: iteration };
      if (status === EngineProcess.END)
        return { status: "ended", messages, iterations: iteration };
      if (status !== EngineProcess.CONTINUE)
        throw new Error(`Unknown core process status: ${status}`);
    }
    throw duelOperationError(
      "process_timeout",
      `Core exceeded ${this.#maximumProcessIterations} process iterations`,
    );
  }

  respond(response: EngineResponse): void {
    this.#assertActive();
    this.#adapter.setResponse(this.#handle, response);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#adapter.destroyDuel(this.#handle);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Duel session has been disposed");
  }
}

const PRODUCTION_SHUFFLE_SCRIPT: CoreStartupScript = Object.freeze({
  name: "mvp_production_shuffle.lua",
  source: `local mvp_production_shuffle = Effect.GlobalEffect()
mvp_production_shuffle:SetType(EFFECT_TYPE_FIELD + EFFECT_TYPE_CONTINUOUS)
mvp_production_shuffle:SetCode(EVENT_STARTUP)
mvp_production_shuffle:SetOperation(function()
  Duel.ShuffleDeck(0)
  Duel.ShuffleDeck(1)
end)
Duel.RegisterEffect(mvp_production_shuffle, 0)`,
});

function loadStartupScripts(
  adapter: OcgCoreAdapter,
  handle: EngineDuelHandle,
  scripts: readonly CoreStartupScript[],
): void {
  const names = new Set<string>();
  for (const script of scripts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.lua$/.test(script.name))
      throw new Error(`Invalid startup script name: ${script.name}`);
    if (names.has(script.name))
      throw new Error(`Duplicate startup script name: ${script.name}`);
    if (script.source.trim().length === 0)
      throw new Error(`Startup script is empty: ${script.name}`);
    names.add(script.name);
    if (!adapter.loadScript(handle, script.name, script.source))
      throw new Error(`Core rejected startup script: ${script.name}`);
  }
}

function loadGlobalScripts(
  adapter: OcgCoreAdapter,
  handle: EngineDuelHandle,
  scripts: ReadonlyMap<string, string>,
): void {
  const requiredFirst = ["constant.lua", "utility.lua"];
  const cardScriptPattern = /^c\d+\.lua$/;
  const remaining = [...scripts.keys()]
    .filter(
      (name) => !requiredFirst.includes(name) && !cardScriptPattern.test(name),
    )
    .sort();
  for (const name of [...requiredFirst, ...remaining]) {
    const script = scripts.get(name);
    if (script === undefined)
      throw new Error(`Required global script is missing: ${name}`);
    if (!adapter.loadScript(handle, name, script))
      throw new Error(`Core rejected global script: ${name}`);
  }
}

function addDeck(
  adapter: OcgCoreAdapter,
  handle: EngineDuelHandle,
  player: 0 | 1,
  order: readonly CardCode[],
  location: EngineNewCard["location"],
): void {
  for (const code of [...order].reverse()) {
    adapter.addCard(handle, {
      team: player,
      duelist: 0,
      code,
      controller: player,
      location,
      sequence: 0,
      position: EnginePosition.FACE_DOWN_DEFENSE,
    });
  }
}

function assertSameDeck(
  productionDeck: readonly CardCode[],
  orderedDeck: readonly CardCode[],
  label: string,
): void {
  if (productionDeck.length !== orderedDeck.length) {
    throw new Error(`Programmed ${label} deck order has the wrong card count`);
  }
  const expected = counts(productionDeck);
  const actual = counts(orderedDeck);
  if (
    expected.size !== actual.size ||
    [...expected].some(([code, count]) => actual.get(code) !== count)
  ) {
    throw new Error(
      `Programmed ${label} deck order does not match the production preset`,
    );
  }
}

function counts(cards: readonly CardCode[]): ReadonlyMap<CardCode, number> {
  const result = new Map<CardCode, number>();
  for (const card of cards) result.set(card, (result.get(card) ?? 0) + 1);
  return result;
}
