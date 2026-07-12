import createCore, {
  cardMatchesOpcode,
  OcgMessageType,
  type InitializerSync,
  type OcgAttribute,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgNewCardInfo,
  type OcgRace,
  type OcgResponse,
  type SelectFieldPlace,
} from "../../../vendor/ocgcore-wasm/0.1.2/dist/index.js";
import type { DuelError } from "../../duel/contracts/duel-error.ts";

export type CoreFactory = (options: InitializerSync) => Promise<OcgCoreSync>;
export type EngineDuelHandle = OcgDuelHandle;
export type EngineMessage = OcgMessage;
export type EngineNewCard = OcgNewCardInfo;
export type EngineResponse = OcgResponse;
export type EngineAttribute = OcgAttribute;
export type EngineRace = OcgRace;
export type EngineFieldPlace = SelectFieldPlace;

export interface EngineCardData {
  readonly code: number;
  readonly alias: number;
  readonly setcodes: number[];
  readonly type: number;
  readonly level: number;
  readonly attribute: number;
  readonly race: bigint;
  readonly attack: number;
  readonly defense: number;
  readonly lscale: number;
  readonly rscale: number;
  readonly link_marker: number;
}

export function vendoredMessageTypes(): readonly number[] {
  return Object.freeze(
    Object.values(OcgMessageType).filter(
      (value): value is number => typeof value === "number",
    ),
  );
}

export function engineCardMatchesOpcode(
  card: EngineCardData,
  opcodes: readonly bigint[],
): boolean {
  return cardMatchesOpcode(card, [...opcodes]);
}

export interface EngineDuelOptions {
  readonly flags: bigint;
  readonly seed: [bigint, bigint, bigint, bigint];
  readonly team1: {
    readonly startingLP: number;
    readonly startingDrawCount: number;
    readonly drawCountPerTurn: number;
  };
  readonly team2: {
    readonly startingLP: number;
    readonly startingDrawCount: number;
    readonly drawCountPerTurn: number;
  };
  readonly cardReader: (code: number) => EngineCardData | null;
  readonly scriptReader: (name: string) => string | null;
  readonly errorHandler?: (type: number, text: string) => void;
}

export interface CoreDiagnostic {
  readonly stream: "stdout" | "stderr";
  readonly message: string;
}

export interface CoreInitializationOptions {
  readonly wasmBinary: ArrayBuffer;
  readonly timeoutMs?: number;
  readonly factory?: CoreFactory;
  readonly onDiagnostic?: (diagnostic: CoreDiagnostic) => void;
}

export class OcgCoreAdapter {
  readonly #core: OcgCoreSync;

  private constructor(core: OcgCoreSync) {
    this.#core = core;
  }

  static async initialize(
    options: CoreInitializationOptions,
  ): Promise<OcgCoreAdapter> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const diagnostics = options.onDiagnostic ?? (() => undefined);
    const factory = options.factory ?? createCore;

    try {
      const core = await withTimeout(
        factory({
          sync: true,
          wasmBinary: options.wasmBinary,
          print: (message) => diagnostics({ stream: "stdout", message }),
          printErr: (message) => diagnostics({ stream: "stderr", message }),
        }),
        timeoutMs,
      );
      const version = core.getVersion();
      if (!isCoreVersion(version))
        throw new Error(`Invalid core version: ${JSON.stringify(version)}`);
      return new OcgCoreAdapter(core);
    } catch (error) {
      throw engineInitializationError(error);
    }
  }

  getVersion(): readonly [number, number] {
    return this.#core.getVersion();
  }

  createDuel(options: EngineDuelOptions): EngineDuelHandle | null {
    return this.#core.createDuel(options);
  }

  destroyDuel(handle: EngineDuelHandle): void {
    this.#core.destroyDuel(handle);
  }

  addCard(handle: EngineDuelHandle, card: EngineNewCard): void {
    this.#core.duelNewCard(handle, card);
  }

  loadScript(handle: EngineDuelHandle, name: string, content: string): boolean {
    return this.#core.loadScript(handle, name, content);
  }

  startDuel(handle: EngineDuelHandle): void {
    this.#core.startDuel(handle);
  }

  process(handle: EngineDuelHandle): number {
    return this.#core.duelProcess(handle);
  }

  getMessages(handle: EngineDuelHandle): EngineMessage[] {
    return this.#core.duelGetMessage(handle);
  }

  setResponse(handle: EngineDuelHandle, response: EngineResponse): void {
    this.#core.duelSetResponse(handle, response);
  }

  queryField(
    handle: EngineDuelHandle,
  ): ReturnType<OcgCoreSync["duelQueryField"]> {
    return this.#core.duelQueryField(handle);
  }

  queryLocation(
    handle: EngineDuelHandle,
    query: Parameters<OcgCoreSync["duelQueryLocation"]>[1],
  ): ReturnType<OcgCoreSync["duelQueryLocation"]> {
    return this.#core.duelQueryLocation(handle, query);
  }
}

export class EngineInitializationError extends Error {
  readonly duelError: DuelError;

  constructor(duelError: DuelError, cause?: unknown) {
    super(duelError.message, { cause });
    this.name = "EngineInitializationError";
    this.duelError = duelError;
  }
}

function engineInitializationError(cause: unknown): EngineInitializationError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new EngineInitializationError(
    {
      code: "engine_initialization_failed",
      message: `Unable to initialize vendored ocgcore: ${message}`,
      detail: { cause: message },
      recoverable: false,
    },
    cause,
  );
}

function isCoreVersion(value: readonly [number, number]): boolean {
  return (
    value.length === 2 &&
    value.every((part) => Number.isSafeInteger(part) && part >= 0)
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error(`Invalid timeout: ${timeoutMs}`);
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Initialization timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
