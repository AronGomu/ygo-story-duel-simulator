<script lang="ts">
  import { onMount } from "svelte";
  import { coreGateMessage, type CoreGate } from "../core/core-gate.ts";

  export let coreGate: CoreGate;
  export let onclose: () => void;

  let heading: HTMLHeadingElement | undefined;

  onMount(() => {
    heading?.focus();
  });
</script>

<div class="dialog-backdrop" data-cy="shell-settings-backdrop">
  <div
    class="dialog-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shell-settings-heading"
    data-cy="shell-settings-dialog"
  >
    <h2
      id="shell-settings-heading"
      tabindex="-1"
      bind:this={heading}
      data-cy="shell-settings-heading"
    >
      Settings
    </h2>
    <p class="hint" role="status" data-cy="shell-settings-content-status">
      {coreGateMessage(coreGate)}
    </p>
    <p class="hint" data-cy="shell-settings-fullscreen-hint">
      Press F11 for fullscreen.
    </p>
    <button type="button" data-cy="shell-settings-close" onclick={onclose}
      >Close</button
    >
  </div>
</div>

<style>
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
