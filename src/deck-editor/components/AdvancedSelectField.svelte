<script lang="ts">
  interface AdvancedSelectOption {
    readonly value: string;
    readonly label: string;
  }

  export let id: string;
  export let label: string;
  export let value: string | null;
  export let options: readonly AdvancedSelectOption[];
  export let onchange: (value: string | null) => void;
</script>

<label data-cy={`advanced-search-${id}-field`}>
  <span data-cy={`advanced-search-${id}-label`}>{label}</span>
  <select
    value={value ?? ""}
    data-cy={`advanced-search-${id}`}
    onchange={(event) => onchange(event.currentTarget.value || null)}
  >
    <option value="" data-cy={`advanced-search-${id}-any`}>Any</option>
    {#each options as option (option.value)}
      <option
        value={option.value}
        data-cy={`advanced-search-${id}-${option.value.toLowerCase().replaceAll(" ", "-")}`}
        >{option.label}</option
      >
    {/each}
  </select>
</label>

<style>
  label {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  select {
    width: 100%;
    min-width: 0;
    min-height: 2rem;
    padding: 0.3rem 0.4rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-chain);
  }
</style>
