<script lang="ts">
  import OverlayShell from "./OverlayShell.svelte";
  export let onclose: () => void = () => undefined;
  export let restoreFocusTo: HTMLElement | null = null;
  export let reviewState: "default" | "changed" | "reset" | "audio" = "default";
  let textSpeed = reviewState === "changed" ? 80 : 40;
  let autoSpeed = reviewState === "changed" ? 7 : 3;
  let transitions = reviewState === "changed" ? "off" : "standard";
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled;
  function reset(): void {
    textSpeed = 40;
    autoSpeed = 3;
    transitions = "standard";
  }
</script>

<OverlayShell
  title="Settings"
  labelId="settings-title"
  {onclose}
  {restoreFocusTo}
>
  <div class="settings">
    <p class="review-state" role="status">
      Reviewer state: {reviewState === "audio"
        ? "audio unavailable"
        : reviewState}
    </p>
    <label
      >Text speed <input
        aria-label="Text speed"
        type="number"
        min="0"
        max="100"
        bind:value={textSpeed}
      /></label
    >
    <label
      >Auto speed <input
        aria-label="Auto speed"
        type="range"
        min="1"
        max="8"
        bind:value={autoSpeed}
      /></label
    >
    <label
      >Transitions <select aria-label="Transitions" bind:value={transitions}
        ><option value="standard">Standard</option><option value="reduced"
          >Reduced</option
        ><option value="off">Off</option></select
      ></label
    >
    <label
      >Music volume <input
        aria-label="Music volume"
        type="range"
        disabled
      /></label
    >
    <label
      >Sound volume <input
        aria-label="Sound volume"
        type="range"
        disabled
      /></label
    >
    <p>Audio not included in this prototype.</p>
    <p>Fullscreen {fullscreenSupported ? "supported" : "unavailable"}</p>
    <button type="button" class="secondary" onclick={reset}
      >Reset settings</button
    >
  </div>
</OverlayShell>

<style>
  .settings {
    display: grid;
    gap: 1rem;
  }
  .settings label {
    display: grid;
    gap: 0.4rem;
  }
  input,
  select {
    min-height: 44px;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--prototype-border);
    border-radius: 0.35rem;
    background: #071522;
    color: var(--prototype-text);
  }
</style>
