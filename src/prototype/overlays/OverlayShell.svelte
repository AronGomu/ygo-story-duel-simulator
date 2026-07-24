<script lang="ts">
  import { onMount, tick } from "svelte";
  import { trapTabWithin } from "./focus-trap.ts";
  export let title: string;
  export let labelId = "prototype-overlay-title";
  export let onclose: () => void = () => undefined;
  export let restoreFocusTo: HTMLElement | null = null;
  export let controlsSuspended = false;
  let dialog: HTMLDivElement;

  onMount(() => {
    const mountedDialog = dialog;
    queueMicrotask(() => {
      if (!mountedDialog.isConnected) return;
      (
        mountedDialog.querySelector<HTMLElement>("button:not([disabled])") ??
        mountedDialog
      ).focus();
    });
  });

  async function close(): Promise<void> {
    onclose();
    await tick();
    restoreFocusTo?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const openModals = [
      ...document.querySelectorAll<HTMLElement>("[aria-modal='true']"),
    ];
    if (
      openModals.at(-1) !== dialog ||
      dialog.querySelector("[role='alertdialog']") !== null
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      void close();
      return;
    }
    trapTabWithin(dialog, event);
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<div class="overlay-backdrop">
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelId}
    tabindex="-1"
    bind:this={dialog}
  >
    <header inert={controlsSuspended} aria-hidden={controlsSuspended}>
      <h2 id={labelId}>{title}</h2>
      <button
        type="button"
        class="secondary"
        aria-label={`Close ${title}`}
        onclick={() => void close()}>Close</button
      >
    </header>
    <div class="overlay-content"><slot /></div>
  </div>
</div>

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: max(1rem, env(safe-area-inset-top))
      max(1rem, env(safe-area-inset-right))
      max(1rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    background: #01050bd9;
  }
  .overlay {
    width: min(42rem, 100%);
    max-height: min(48rem, calc(100svh - 2rem));
    overflow: auto;
    padding: 1.25rem;
    border: 1px solid var(--prototype-border);
    border-radius: 0.8rem;
    background: var(--prototype-panel);
    box-shadow: 0 2rem 6rem #000c;
  }
  .overlay:focus {
    outline: 2px solid var(--prototype-accent);
  }
  header {
    position: sticky;
    top: -1.25rem;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin: -1.25rem -1.25rem 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--prototype-border);
    background: var(--prototype-panel);
  }
  h2 {
    margin: 0;
  }
</style>
