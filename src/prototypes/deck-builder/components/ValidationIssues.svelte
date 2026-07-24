<script lang="ts">
  import type { DeckValidationSummary } from "../../../decks/deck-contracts.ts";

  export let validation: DeckValidationSummary;
  export let onfocusissue: (
    cardCode: number | null,
    zone: string | null,
  ) => void = () => undefined;
</script>

{#if validation.issues.length > 0}
  <section class="validation" aria-labelledby="validation-heading">
    <header>
      <h3 id="validation-heading">Deck checks</h3>
      <span>{validation.issues.length} issue(s)</span>
    </header>
    <ul>
      {#each validation.issues as issue (issue.id)}
        <li class:error={issue.severity === "error"}>
          <button
            type="button"
            class="issue"
            onclick={() =>
              onfocusissue(issue.cardCode ?? null, issue.zone ?? null)}
          >
            <span aria-hidden="true"
              >{issue.severity === "error" ? "×" : "!"}</span
            >
            {issue.message}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .validation {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid #896b28;
    border-radius: 0.55rem;
    background: #2e2819;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h3 {
    margin: 0;
    font-size: 0.92rem;
  }

  header span {
    color: var(--muted);
    font-size: 0.75rem;
  }

  ul {
    display: grid;
    gap: 0.35rem;
    margin: 0.55rem 0 0;
    padding: 0;
    list-style: none;
  }

  .issue {
    width: 100%;
    min-height: 2rem;
    justify-content: flex-start;
    padding: 0.35rem 0.5rem;
    color: #e8edf8;
    border-color: transparent;
    background: transparent;
    text-align: left;
    font-size: 0.78rem;
    font-weight: 600;
  }

  li.error .issue {
    color: #ffd6dc;
  }
</style>
