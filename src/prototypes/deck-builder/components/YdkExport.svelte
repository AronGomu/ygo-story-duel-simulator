<script lang="ts">
  import { onMount } from "svelte";
  import { handleModalKeydown } from "../focus-trap.ts";
  import type { DeckRecord } from "../../../decks/deck-contracts.ts";
  import { exportYdk, ydkFilename } from "../../../decks/ydk-adapter.ts";

  export let deck: DeckRecord;
  export let oncancel: () => void;

  let message = "";
  let heading: HTMLHeadingElement;
  $: source = exportYdk(deck);
  $: filename = ydkFilename(deck.name);

  onMount(() => heading.focus());

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(source);
      message = "YDK text copied.";
    } catch (error) {
      message = `Copy failed: ${error instanceof Error ? error.message : "Clipboard unavailable"}`;
    }
  }

  function download(): void {
    try {
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/plain" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      message = `Downloaded ${filename}.`;
    } catch (error) {
      message = `Download failed: ${error instanceof Error ? error.message : "Browser download unavailable"}`;
    }
  }
</script>

<div
  class="dialog"
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-labelledby="ydk-export-heading"
  onkeydown={(event) => handleModalKeydown(event, oncancel)}
>
  <header>
    <div>
      <p>YDK export</p>
      <h2 id="ydk-export-heading" tabindex="-1" bind:this={heading}>
        Export {deck.name}
      </h2>
    </div>
    <button type="button" class="secondary" onclick={oncancel}>Close</button>
  </header>
  <p>
    Main {deck.main.length} · Extra {deck.extra.length} · Side {deck.side
      .length}
  </p>
  {#if deck.validation.status === "errors"}
    <p class="warning" role="alert">
      Deck is invalid. Export is allowed, but VN deck resolution will reject it.
    </p>
  {/if}
  <label>
    <span>Filename</span>
    <input value={filename} readonly />
  </label>
  <textarea rows="12" readonly value={source} aria-label="YDK text"></textarea>
  <div class="actions">
    <button type="button" onclick={() => void copyText()}>Copy YDK text</button>
    <button type="button" class="secondary" onclick={download}
      >Download .ydk</button
    >
  </div>
  {#if message}<p role="status">{message}</p>{/if}
</div>

<style>
  .dialog {
    position: fixed;
    z-index: 30;
    inset: 50% auto auto 50%;
    width: min(42rem, calc(100vw - 3rem));
    max-height: calc(100vh - 3rem);
    padding: 1rem;
    overflow-y: auto;
    transform: translate(-50%, -50%);
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    background: #111b2f;
    box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 0.55);
  }

  header,
  .actions {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h2,
  p {
    margin-top: 0;
  }

  header p,
  label span {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 750;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  input,
  textarea {
    width: 100%;
    padding: 0.6rem;
    color: #e8edf8;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: #08101f;
  }

  textarea {
    margin-block: 0.75rem;
    resize: vertical;
  }

  .warning {
    padding: 0.7rem;
    border: 1px solid #896b28;
    border-radius: 0.5rem;
    background: #2e2819;
  }
</style>
