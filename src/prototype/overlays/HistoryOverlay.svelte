<script lang="ts">
  import OverlayShell from "./OverlayShell.svelte";
  export let entries: readonly {
    readonly speaker: string | null;
    readonly text: string;
  }[] = [];
  export let onclose: () => void = () => undefined;
  export let restoreFocusTo: HTMLElement | null = null;
</script>

<OverlayShell
  title="Dialogue history"
  labelId="history-title"
  {onclose}
  {restoreFocusTo}
>
  <p>Current scene · oldest to newest</p>
  {#if entries.length === 0}<p class="empty">
      No dialogue in this scene yet.
    </p>{:else}<ol>
      {#each entries as entry, index (`${entry.speaker}-${entry.text}-${index}`)}<li
        >
          <strong>{entry.speaker ?? "Narration"}</strong><span
            >{entry.text}</span
          >
        </li>{/each}
    </ol>{/if}
</OverlayShell>

<style>
  ol {
    display: grid;
    gap: 0.75rem;
    padding-left: 1.5rem;
  }
  li {
    padding: 0.75rem;
    border-left: 2px solid var(--prototype-accent);
  }
  li strong,
  li span {
    display: block;
  }
  .empty {
    color: var(--prototype-muted);
  }
</style>
