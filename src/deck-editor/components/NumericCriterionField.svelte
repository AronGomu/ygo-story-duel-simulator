<script lang="ts">
  import {
    numericCriterionError,
    type NumericCriterion,
    type NumericOperator,
  } from "../../decks/catalog/deck-catalog.ts";

  export let id: string;
  export let label: string;
  export let criterion: NumericCriterion | null;
  export let onchange: (criterion: NumericCriterion | null) => void;
  export let allowedMin = Number.NEGATIVE_INFINITY;
  export let allowedMax = Number.POSITIVE_INFINITY;

  $: operator = criterion?.op ?? "range";
  $: minimum = criterion?.op === "range" ? criterion.min : null;
  $: maximum = criterion?.op === "range" ? criterion.max : null;
  $: value =
    criterion !== null && criterion.op !== "range" ? criterion.value : null;
  $: error = numericCriterionError(criterion, allowedMin, allowedMax);

  function parsed(raw: string): number | null {
    if (raw.trim() === "") return null;
    const result = Number(raw);
    return Number.isFinite(result) ? result : Number.NaN;
  }

  function changeOperator(event: Event): void {
    const next = (event.currentTarget as HTMLSelectElement)
      .value as NumericOperator;
    onchange(
      next === "range"
        ? { op: "range", min: null, max: null }
        : { op: next, value: Number.NaN },
    );
  }

  function changeRange(bound: "min" | "max", raw: string): void {
    const next = parsed(raw);
    onchange({
      op: "range",
      min: bound === "min" ? next : minimum,
      max: bound === "max" ? next : maximum,
    });
  }

  function changeValue(raw: string): void {
    const next = parsed(raw);
    onchange({
      op: operator === "range" ? "eq" : operator,
      value: next ?? Number.NaN,
    });
  }
</script>

<fieldset
  class="numeric-field"
  aria-describedby={error === null ? undefined : `advanced-${id}-error`}
  data-cy={`advanced-${id}-field`}
>
  <legend data-cy={`advanced-${id}-label`}>{label}</legend>
  <select
    value={operator}
    aria-label={`${label} operator`}
    data-cy={`advanced-${id}-operator`}
    onchange={changeOperator}
  >
    <option value="range" data-cy={`advanced-${id}-operator-range`}
      >Range</option
    >
    <option value="eq" data-cy={`advanced-${id}-operator-eq`}>=</option>
    <option value="lt" data-cy={`advanced-${id}-operator-lt`}>&lt;</option>
    <option value="lte" data-cy={`advanced-${id}-operator-lte`}>≤</option>
    <option value="gt" data-cy={`advanced-${id}-operator-gt`}>&gt;</option>
    <option value="gte" data-cy={`advanced-${id}-operator-gte`}>≥</option>
  </select>
  {#if operator === "range"}
    <input
      type="number"
      value={minimum ?? ""}
      min={Number.isFinite(allowedMin) ? allowedMin : undefined}
      max={Number.isFinite(allowedMax) ? allowedMax : undefined}
      aria-label={`${label} minimum`}
      aria-invalid={error !== null}
      data-cy={`advanced-${id}-minimum`}
      oninput={(event) => changeRange("min", event.currentTarget.value)}
    />
    <input
      type="number"
      value={maximum ?? ""}
      min={Number.isFinite(allowedMin) ? allowedMin : undefined}
      max={Number.isFinite(allowedMax) ? allowedMax : undefined}
      aria-label={`${label} maximum`}
      aria-invalid={error !== null}
      data-cy={`advanced-${id}-maximum`}
      oninput={(event) => changeRange("max", event.currentTarget.value)}
    />
  {:else}
    <input
      type="number"
      value={value ?? ""}
      min={Number.isFinite(allowedMin) ? allowedMin : undefined}
      max={Number.isFinite(allowedMax) ? allowedMax : undefined}
      aria-label={`${label} value`}
      aria-invalid={error !== null}
      data-cy={`advanced-${id}-value`}
      oninput={(event) => changeValue(event.currentTarget.value)}
    />
  {/if}
  {#if error !== null}
    <span
      id={`advanced-${id}-error`}
      class="error"
      role="alert"
      data-cy={`advanced-${id}-error`}>{error}</span
    >
  {/if}
</fieldset>

<style>
  .numeric-field {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.35rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    grid-column: 1 / -1;
    padding: 0;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  select,
  input {
    min-width: 0;
    min-height: 2rem;
    padding: 0.3rem 0.4rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-chain);
  }

  .error {
    grid-column: 1 / -1;
    color: var(--danger);
    font-size: var(--text-xs);
  }
</style>
