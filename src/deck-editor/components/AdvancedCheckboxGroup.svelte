<script lang="ts">
  export let id: string;
  export let label: string;
  export let options: readonly string[];
  export let value: readonly string[];
  export let onchange: (value: readonly string[]) => void;

  function toggle(option: string, checked: boolean): void {
    onchange(
      Object.freeze(
        checked
          ? [...value, option]
          : value.filter((current) => current !== option),
      ),
    );
  }
</script>

<fieldset class="chips" data-cy={`advanced-search-${id}`}>
  <legend data-cy={`advanced-search-${id}-label`}>{label}</legend>
  {#each options as option (option)}
    {@const optionId = option.toLowerCase().replaceAll(" ", "-")}
    <label data-cy={`advanced-search-${id}-${optionId}-field`}>
      <input
        type="checkbox"
        checked={value.includes(option)}
        data-cy={`advanced-search-${id}-${optionId}`}
        onchange={(event) => toggle(option, event.currentTarget.checked)}
      />
      <span data-cy={`advanced-search-${id}-${optionId}-label`}>{option}</span>
    </label>
  {/each}
</fieldset>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    width: 100%;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text);
    font-size: var(--text-xs);
  }

  input {
    width: auto;
    min-height: auto;
  }
</style>
