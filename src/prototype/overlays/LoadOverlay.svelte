<script lang="ts">
  import LoadScreen from "../screens/LoadScreen.svelte";
  import OverlayShell from "./OverlayShell.svelte";

  export let showCorrupt = false;
  export let onload: (slot: "manual" | "autosave") => void = () => undefined;
  export let ondelete: () => boolean = () => true;
  export let onclose: () => void = () => undefined;
  export let restoreFocusTo: HTMLElement | null = null;
  let confirmationOpen = false;
</script>

<OverlayShell
  title="Load game"
  labelId="load-overlay-title"
  {onclose}
  {restoreFocusTo}
  controlsSuspended={confirmationOpen}
>
  <LoadScreen
    {showCorrupt}
    {onload}
    {ondelete}
    onconfirmchange={(open) => (confirmationOpen = open)}
    onback={onclose}
  />
</OverlayShell>
