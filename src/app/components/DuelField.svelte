<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { PlayerPrompt } from "../../duel/contracts/player-prompt.ts";
  import type { PublicDuelState } from "../../duel/contracts/public-duel-state.ts";
  import type { DuelPresentationBridge } from "../presentation/duel-presentation-bridge.ts";
  import type { SequencedPresentationEvent } from "../stores/duel-store.ts";

  export let snapshot: PublicDuelState | null;
  export let prompt: PlayerPrompt | null;
  export let events: readonly SequencedPresentationEvent[];
  export let imageUrls: ReadonlyMap<number, string>;
  export let cardBackUrl: string;
  export let placeholderUrl: string;
  export let oncardintent: (instanceId: string) => void;
  export let onzoneintent: (zoneId: string) => void;

  let host: HTMLDivElement;
  let bridge: DuelPresentationBridge | null = null;
  let bridgeError: string | null = null;
  let bridgeWarning: string | null = null;
  let bridgeLoading = true;
  let handledSequence = Math.max(0, (events.at(-1)?.sequence ?? 0) - 1);
  let mounted = false;
  let bridgeAbortController: AbortController | null = null;

  function failBridge(error: unknown): void {
    console.error({ event: "duel.field.presentation_failed", err: error });
    bridgeAbortController?.abort(
      new DOMException("Visual field failed", "AbortError"),
    );
    bridge?.dispose();
    bridge = null;
    bridgeLoading = false;
    bridgeError =
      error instanceof Error ? error.message : "Unable to render duel field";
  }

  async function startBridge(): Promise<void> {
    if (!mounted) return;
    bridgeAbortController?.abort(
      new DOMException("Visual field attempt replaced", "AbortError"),
    );
    bridge?.dispose();
    bridge = null;
    bridgeError = null;
    bridgeWarning = null;
    bridgeLoading = true;
    const controller = new AbortController();
    bridgeAbortController = controller;
    await tick();
    try {
      const { createPhaserPresentationBridge } = await withFieldDeadline(
        import("../../field/create-phaser-presentation-bridge.ts"),
        10_000,
        "Visual field code did not load in time",
        controller.signal,
      );
      const value = await createPhaserPresentationBridge({
        parent: host,
        imageUrls,
        cardBackUrl,
        placeholderUrl,
        onCardIntent: oncardintent,
        onZoneIntent: onzoneintent,
        signal: controller.signal,
        onError: failBridge,
        onWarning: (message) => {
          if (!mounted) return;
          console.warn({ event: "duel.field.texture_load_failed", message });
          bridgeWarning = message;
        },
      });
      if (!mounted || controller.signal.aborted) {
        value.dispose();
        return;
      }
      bridge = value;
      bridgeLoading = false;
      handledSequence = Math.max(
        handledSequence,
        (events.at(-1)?.sequence ?? 0) - 1,
      );
      if (snapshot !== null) value.applySnapshot(snapshot);
      value.applyPrompt(prompt);
    } catch (error) {
      if (!mounted || controller.signal.aborted) return;
      failBridge(error);
    }
  }

  function withFieldDeadline<T>(
    operation: Promise<T>,
    milliseconds: number,
    message: string,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      };
      const abort = (): void => {
        cleanup();
        reject(signal.reason);
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        reject(new Error(message));
      }, milliseconds);
      signal.addEventListener("abort", abort, { once: true });
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

  onMount(() => {
    mounted = true;
    void startBridge();
    return () => {
      mounted = false;
      bridgeAbortController?.abort(
        new DOMException("Visual field disposed", "AbortError"),
      );
      bridgeAbortController = null;
      bridge?.dispose();
      bridge = null;
    };
  });

  $: if (bridge !== null && snapshot !== null) bridge.applySnapshot(snapshot);
  $: if (bridge !== null) bridge.applyPrompt(prompt);
  $: if (bridge !== null) {
    const pendingEvents = events.filter(
      ({ sequence }) => sequence > handledSequence,
    );
    for (const entry of pendingEvents) bridge.present(entry.event);
    if (pendingEvents.length > 0) {
      handledSequence = pendingEvents.at(-1)?.sequence ?? handledSequence;
    }
  }
</script>

<section
  class="field-shell"
  aria-labelledby="duel-field-heading"
  aria-busy={bridgeLoading}
>
  <div class="field-heading">
    <div>
      <p class="eyebrow">Presentation-only field</p>
      <h2 id="duel-field-heading">Duel field</h2>
    </div>
    <p class="field-help">
      Use the controls below for complete keyboard access.
    </p>
  </div>
  <p class="field-status" aria-live="polite" aria-atomic="true">
    {bridgeLoading
      ? "Loading visual duel field…"
      : bridgeError
        ? `Visual duel field unavailable: ${bridgeError}. The text view remains available.`
        : (bridgeWarning ?? "")}
  </p>
  {#if bridgeError}
    <div class="field-fallback">
      <strong>Text view remains available.</strong>
      <span>{bridgeError}</span>
      <button type="button" class="secondary" onclick={() => void startBridge()}
        >Retry visual field</button
      >
    </div>
  {:else}
    {#if bridgeWarning}
      <div class="field-fallback">
        <span>{bridgeWarning}</span>
        <button
          type="button"
          class="secondary"
          onclick={() => void startBridge()}>Retry visual textures</button
        >
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (focus enables horizontal keyboard scrolling) -->
    <div
      class="canvas-frame"
      role="region"
      tabindex="0"
      bind:this={host}
      aria-label="Visual duel field"
    ></div>
  {/if}
</section>

<style>
  .field-shell {
    min-width: 0;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: linear-gradient(180deg, #0b1728, #08111f);
    box-shadow: var(--shadow);
  }

  .field-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.8rem;
  }

  .field-heading h2,
  .field-heading p {
    margin-bottom: 0;
  }

  .field-help,
  .field-fallback,
  .field-status {
    color: var(--muted);
  }

  .field-status {
    min-height: 1.25rem;
    margin: 0 0 0.5rem;
  }

  .canvas-frame {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: min(56.25vw, 45rem);
    overflow: hidden;
    border-radius: 0.75rem;
    background: #08111f;
  }

  .canvas-frame :global(canvas) {
    display: block;
    max-width: 100%;
    margin-inline: auto;
  }

  .field-fallback {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px dashed var(--border);
    border-radius: 0.75rem;
  }

  @media (max-width: 48rem) {
    .canvas-frame {
      min-height: 27rem;
      overflow-x: auto;
    }

    .canvas-frame :global(canvas) {
      min-width: 48rem;
      max-width: none;
    }
  }
</style>
