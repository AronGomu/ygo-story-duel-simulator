import Phaser from "phaser";
import type { DuelPresentationEvent } from "../duel/contracts/duel-presentation-event.ts";
import type { PlayerPrompt } from "../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../duel/contracts/public-duel-state.ts";
import type { DuelPresentationBridge } from "../app/presentation/duel-presentation-bridge.ts";
import {
  PresentationScheduler,
  presentationCommandForEvent,
} from "../app/presentation/presentation-command.ts";
import { DuelScene } from "./DuelScene.ts";
import { DUEL_FIELD_HEIGHT, DUEL_FIELD_WIDTH } from "./duel-field-layout.ts";

export interface PhaserPresentationBridgeOptions {
  readonly parent: HTMLElement;
  readonly imageUrls: ReadonlyMap<number, string>;
  readonly cardBackUrl: string;
  readonly placeholderUrl: string;
  readonly onCardIntent: (instanceId: string) => void;
  readonly onZoneIntent: (zoneId: string) => void;
  readonly reducedMotion?: boolean;
  readonly signal?: AbortSignal;
  readonly onError?: (error: unknown) => void;
  readonly onWarning?: (message: string) => void;
}

export async function createPhaserPresentationBridge(
  options: PhaserPresentationBridgeOptions,
): Promise<DuelPresentationBridge> {
  options.signal?.throwIfAborted();
  let ready: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const scene = new DuelScene({
    onReady: ready,
    onCardIntent: options.onCardIntent,
    onZoneIntent: options.onZoneIntent,
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    width: DUEL_FIELD_WIDTH,
    height: DUEL_FIELD_HEIGHT,
    backgroundColor: "#08111f",
    scene: [scene],
    render: { antialias: true, pixelArt: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DUEL_FIELD_WIDTH,
      height: DUEL_FIELD_HEIGHT,
    },
  });
  let disposed = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    if (sleepTimer !== undefined) clearTimeout(sleepTimer);
    game.destroy(true, false);
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  if (options.signal?.aborted) {
    destroy();
    throw options.signal.reason;
  }
  try {
    await withPresentationTimeout(
      readyPromise,
      10_000,
      "Duel field scene did not start in time",
      options.signal,
    );
  } catch (error) {
    destroy();
    throw error;
  }
  const canvas = game.canvas;
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-testid", "duel-field-canvas");
  const imagesReady = new Promise<void>((resolve) => {
    scene.events.once(
      "card-images-ready",
      ({
        faceImages,
        cardBack,
        failed,
      }: {
        faceImages: number;
        cardBack: boolean;
        failed: readonly string[];
      }) => {
        canvas.dataset.loadedFaceImages = String(faceImages);
        canvas.dataset.cardBackReady = String(cardBack);
        canvas.dataset.failedTextures = String(failed.length);
        if (failed.length > 0)
          options.onWarning?.(
            `${failed.length} visual field texture${failed.length === 1 ? "" : "s"} failed to load.`,
          );
        resolve();
      },
    );
  });
  scene.events.on(
    "field-rendered",
    ({
      hiddenCards,
      faceImages,
    }: {
      hiddenCards: number;
      faceImages: number;
    }) => {
      canvas.dataset.hiddenCards = String(hiddenCards);
      canvas.dataset.visibleCardImages = String(faceImages);
    },
  );
  scene.setImages(
    options.imageUrls,
    options.cardBackUrl,
    options.placeholderUrl,
  );
  try {
    await withPresentationTimeout(
      imagesReady,
      10_000,
      "Duel field images did not finish loading in time",
      options.signal,
    );
  } catch (error) {
    destroy();
    throw error;
  }
  const scheduler = new PresentationScheduler();
  const reducedMotion =
    options.reducedMotion ??
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false;
  canvas.dataset.reducedMotion = String(reducedMotion);
  const wakeFor = (milliseconds: number): void => {
    if (disposed) return;
    if (sleepTimer !== undefined) clearTimeout(sleepTimer);
    game.loop.wake();
    sleepTimer = setTimeout(() => {
      if (!disposed) game.loop.sleep();
    }, milliseconds + 100);
  };
  wakeFor(100);

  return {
    applySnapshot(snapshot: PublicDuelState): void {
      if (disposed) return;
      try {
        game.loop.wake();
        scene.applySnapshot(snapshot);
        wakeFor(100);
      } catch (error) {
        options.onError?.(error);
      }
    },
    applyPrompt(prompt: PlayerPrompt | null): void {
      if (disposed) return;
      try {
        game.loop.wake();
        scene.applyPrompt(prompt);
        wakeFor(100);
      } catch (error) {
        options.onError?.(error);
      }
    },
    present(event: DuelPresentationEvent): void {
      if (disposed) return;
      const command = presentationCommandForEvent(event, reducedMotion);
      wakeFor(command.durationMs + 500);
      scheduler.run(command, (scheduled) => {
        try {
          scene.present(scheduled);
        } catch (error) {
          options.onError?.(error);
        }
      });
    },
    reset(): void {
      if (disposed) return;
      scheduler.cancel();
      try {
        game.loop.wake();
        scene.resetPresentation();
        wakeFor(100);
      } catch (error) {
        options.onError?.(error);
      }
    },
    dispose(): void {
      if (disposed) return;
      scheduler.cancel();
      options.signal?.removeEventListener("abort", destroy);
      destroy();
    },
  };
}

function withPresentationTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(message));
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
