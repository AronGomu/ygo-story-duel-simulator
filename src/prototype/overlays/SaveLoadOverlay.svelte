<script lang="ts">
  import OverlayShell from "./OverlayShell.svelte";
  export let mode: "idle" | "saving" | "success" | "overwrite" | "failure" =
    "idle";
  export let onsave: () => void = () => undefined;
  export let onretry: () => void = () => undefined;
  export let oncontinue: () => void = () => undefined;
  export let onclose: () => void = () => undefined;
  export let restoreFocusTo: HTMLElement | null = null;
</script>

<OverlayShell
  title="Save and load"
  labelId="save-load-title"
  {onclose}
  {restoreFocusTo}
>
  <p>
    Prototype-local state only. Auto and Skip are experimental, not fully
    functional.
  </p>
  {#if mode === "saving"}<p role="status" aria-busy="true">
      Saving prototype state…
    </p>
  {:else if mode === "success"}<p role="status">
      Save complete. Manual slot 1 updated.
    </p>
  {:else if mode === "overwrite"}<div role="alert">
      <h3>Overwrite manual slot?</h3>
      <p>Replace its mock progress with current state.</p>
      <button type="button" onclick={onsave}>Confirm overwrite</button>
    </div>
  {:else if mode === "failure"}<div role="alert">
      <h3>Storage unavailable</h3>
      <p>Current in-memory story remains playable.</p>
      <button type="button" onclick={onretry}>Retry save</button><button
        type="button"
        class="secondary"
        onclick={oncontinue}>Continue Without Saving</button
      >
    </div>
  {:else}<button type="button" onclick={onsave}>Save to manual slot 1</button
    >{/if}
</OverlayShell>
