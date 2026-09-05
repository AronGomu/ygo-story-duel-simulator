<script lang="ts">
  import type { InteractionChoice } from "../../prompts/interaction-spec.ts";

  export let choice: InteractionChoice | null = null;
  export let armed = false;
  export let disabled = false;
  export let onstart: () => void = () => undefined;

  $: label = choice?.label ?? "End turn";
  $: unavailable = disabled || choice === null;
</script>

<button
  type="button"
  class="end-turn-button warning"
  class:is-armed={armed}
  data-cy="field-end-turn-button"
  data-armed={armed ? "true" : undefined}
  aria-label={armed ? `${label}, intent armed` : label}
  disabled={unavailable}
  onclick={() => {
    if (!unavailable) onstart();
  }}
>
  {label}
</button>
