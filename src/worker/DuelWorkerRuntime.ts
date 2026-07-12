import { assertNever } from "../duel/contracts/assert-never.ts";
import type { DuelCommand } from "../duel/contracts/duel-command.ts";
import type { DuelError } from "../duel/contracts/duel-error.ts";
import type { DuelWorkerEvent } from "../duel/contracts/duel-worker-event.ts";
import type { SnapshotId } from "../duel/contracts/ids.ts";
import type { MvpPreset } from "../duel/presets/mvp-preset.ts";
import type { ActiveDuelDependencies } from "./assets/active-duel-dependencies.ts";
import { DuelSession } from "./engine/DuelSession.ts";
import type { OcgCoreAdapter } from "./engine/OcgCoreAdapter.ts";
import {
  HeadlessDuelController,
  type DuelAdvance,
} from "./HeadlessDuelController.ts";

export interface DuelRuntimeResources {
  readonly adapter: OcgCoreAdapter;
  readonly dependencies: ActiveDuelDependencies;
  readonly preset: MvpPreset;
  readonly snapshotId: SnapshotId;
}

export type DuelRuntimeInitializer = (
  progress: (stage: string, value?: number) => void,
) => Promise<DuelRuntimeResources>;

export class DuelWorkerRuntime {
  readonly #initializeResources: DuelRuntimeInitializer;
  #resources: DuelRuntimeResources | null = null;
  #controller: HeadlessDuelController | null = null;

  constructor(initializeResources: DuelRuntimeInitializer) {
    this.#initializeResources = initializeResources;
  }

  async handle(command: DuelCommand): Promise<readonly DuelWorkerEvent[]> {
    const events: DuelWorkerEvent[] = [];
    try {
      switch (command.type) {
        case "initialize": {
          if (this.#resources === null) {
            this.#resources = await this.#initializeResources(
              (stage, progress) => {
                events.push({
                  type: "loading",
                  stage,
                  ...(progress === undefined ? {} : { progress }),
                });
              },
            );
          }
          events.push({
            type: "ready",
            coreVersion: this.#resources.adapter.getVersion(),
          });
          break;
        }
        case "startDuel": {
          const resources = this.#requireResources();
          if (this.#controller !== null)
            throw new Error("A duel session is already active");
          if (command.duelId !== resources.preset.id) {
            throw new Error(`Unknown preset duel: ${command.duelId}`);
          }
          const session = DuelSession.create({
            adapter: resources.adapter,
            dependencies: resources.dependencies,
            playerDeck: resources.preset.player,
            opponentDeck: resources.preset.opponent,
            configuration: { mode: "production" },
          });
          this.#controller = new HeadlessDuelController({
            session,
            dependencies: resources.dependencies,
            snapshotId: resources.snapshotId,
            presetId: resources.preset.id,
            deckCounts: [
              resources.preset.player.main.length,
              resources.preset.opponent.main.length,
            ],
            extraDeckCounts: [
              resources.preset.player.extra.length,
              resources.preset.opponent.extra.length,
            ],
          });
          events.push(...advanceEvents(this.#controller.advance()));
          break;
        }
        case "respond": {
          const controller = this.#requireController();
          events.push(
            ...advanceEvents(
              controller.respond(command.promptId, command.choiceIds),
            ),
          );
          break;
        }
        case "surrender": {
          const controller = this.#requireController();
          events.push(...advanceEvents(controller.surrender()));
          this.#controller = null;
          break;
        }
        case "dispose":
          this.#controller?.dispose();
          this.#controller = null;
          break;
        default:
          assertNever(command);
      }
    } catch (error) {
      events.push({ type: "error", error: toDuelError(error) });
    }
    return events;
  }

  dispose(): void {
    this.#controller?.dispose();
    this.#controller = null;
  }

  #requireResources(): DuelRuntimeResources {
    if (this.#resources === null)
      throw new Error("Worker must be initialized before starting a duel");
    return this.#resources;
  }

  #requireController(): HeadlessDuelController {
    if (this.#controller === null) throw new Error("No active duel session");
    return this.#controller;
  }
}

function advanceEvents(advance: DuelAdvance): DuelWorkerEvent[] {
  const events: DuelWorkerEvent[] = advance.events.map((event) => ({
    type: "event",
    event,
  }));
  events.push({ type: "state", state: advance.state });
  if (advance.prompt !== undefined)
    events.push({ type: "prompt", prompt: advance.prompt });
  if (advance.result !== undefined)
    events.push({ type: "result", result: advance.result });
  return events;
}

function toDuelError(error: unknown): DuelError {
  const message = error instanceof Error ? error.message : String(error);
  const code: DuelError["code"] = message.includes("already active")
    ? "duel_already_active"
    : message.includes("initialized")
      ? "engine_initialization_failed"
      : message.includes("prompt") || message.includes("choice")
        ? "invalid_response"
        : "engine_error";
  return {
    code,
    message,
    detail: { cause: message },
    recoverable: code === "invalid_response" || code === "duel_already_active",
  };
}
