<script lang="ts">
  import { afterUpdate, onMount, tick } from "svelte";
  import type { ChoiceId, PromptId } from "../../duel/contracts/ids.ts";
  import type {
    PlayerPrompt,
    PromptCard,
    PromptChoice,
  } from "../../duel/contracts/player-prompt.ts";
  import { promptControlFamily } from "./prompt-control-family.ts";
  import {
    describePromptConstraints,
    validatePromptSelection,
    type PromptSelectionValidation,
  } from "./prompt-selection.ts";

  export let prompt: PlayerPrompt;
  export let disabled = false;
  export let onsubmit: (choiceIds: readonly ChoiceId[]) => boolean | void;
  export let choiceIntent: {
    readonly id: ChoiceId;
    readonly nonce: number;
  } | null = null;
  export let resolveCardImage: (card: PromptCard) => string | undefined = () =>
    undefined;

  let heading: HTMLHeadingElement;
  let activePromptId: PromptId = prompt.id;
  let selected: ChoiceId[] = [];
  let order: PromptChoice[] = [...prompt.choices];
  let allocations: Record<string, number> = {};
  let submitted = false;
  let previousDisabled = disabled;
  let localError: string | null = null;
  let reorderAnnouncement = "";
  let handledIntentNonce = -1;

  $: family = promptControlFamily(prompt.kind);
  $: constraintsId = `${prompt.id}-constraints`;
  $: validationId = `${prompt.id}-validation`;
  $: emptyValidation = validatePromptSelection(prompt, []);
  $: controlsDisabled = disabled || submitted;
  $: selectedValidation = validatePromptSelection(prompt, selected);
  $: orderValidation = validatePromptSelection(
    prompt,
    order.map((choice) => choice.id),
  );
  $: allocatedIds = prompt.choices.flatMap((choice) =>
    Array.from({ length: allocations[choice.id] ?? 0 }, () => choice.id),
  );
  $: allocationValidation = validatePromptSelection(prompt, allocatedIds);
  $: selectedContribution = contributionDescription(prompt, selected);
  $: liveAnnouncement =
    localError ??
    (reorderAnnouncement || null) ??
    (submitted || disabled
      ? "Response sent. Waiting for the engine."
      : (selectedContribution ??
        (!selectedValidation.valid && selected.length > 0
          ? selectedValidation.message
          : allocatedIds.length > 0
            ? `${allocatedIds.length} counters allocated.`
            : "")));

  onMount(() => {
    heading.focus();
  });

  afterUpdate(() => {
    const promptChanged = activePromptId !== prompt.id;
    if (promptChanged) {
      activePromptId = prompt.id;
      selected = [];
      order = [...prompt.choices];
      allocations = {};
      submitted = false;
      localError = null;
      reorderAnnouncement = "";
      void tick().then(() => heading.focus());
    } else if (previousDisabled && !disabled) {
      submitted = false;
    }
    previousDisabled = disabled;
    if (
      choiceIntent !== null &&
      choiceIntent.nonce !== handledIntentNonce &&
      !controlsDisabled
    ) {
      handledIntentNonce = choiceIntent.nonce;
      applyFieldIntent(choiceIntent.id);
    }
  });

  function submit(
    choiceIds: readonly ChoiceId[],
    validation: PromptSelectionValidation = validatePromptSelection(
      prompt,
      choiceIds,
    ),
  ): void {
    if (controlsDisabled) return;
    if (!validation.valid) {
      localError = validation.message;
      return;
    }
    submitted = true;
    localError = null;
    if (onsubmit(Object.freeze([...choiceIds])) === false) submitted = false;
  }

  function applyFieldIntent(id: ChoiceId): void {
    const choice = prompt.choices.find((candidate) => candidate.id === id);
    if (choice === undefined) return;
    switch (family) {
      case "single":
      case "toggle":
        submit([id]);
        break;
      case "multiple":
        setSelected(id, !selected.includes(id));
        break;
      case "counter":
        adjustAllocation(choice, 1);
        break;
      case "order":
        reorderAnnouncement = `${choice.label} is already in the ordering list below.`;
        break;
    }
  }

  function setSelected(id: ChoiceId, checked: boolean): void {
    selected = checked
      ? [...selected, id]
      : selected.filter((choiceId) => choiceId !== id);
    localError = null;
  }

  function moveChoice(index: number, offset: -1 | 1): void {
    const destination = index + offset;
    if (controlsDisabled || destination < 0 || destination >= order.length) {
      return;
    }
    const next = [...order];
    const [choice] = next.splice(index, 1);
    if (choice === undefined) return;
    next.splice(destination, 0, choice);
    order = next;
    reorderAnnouncement = `${choice.label} moved to position ${destination + 1} of ${next.length}.`;
  }

  function adjustAllocation(choice: PromptChoice, delta: -1 | 1): void {
    const current = allocations[choice.id] ?? 0;
    const maximum = choice.allocationMaximum ?? 0;
    const next = Math.min(maximum, Math.max(0, current + delta));
    allocations = { ...allocations, [choice.id]: next };
    localError = null;
  }

  function cardTitle(card: PromptCard, fallback: string): string {
    return (
      card.name ?? (card.code === undefined ? fallback : `Card ${card.code}`)
    );
  }

  function contributionLabel(choice: PromptChoice): string | null {
    const contribution = choice.card?.contribution;
    if (contribution === undefined) return null;
    const alternative = choice.card?.alternativeContribution;
    return alternative === undefined
      ? `Contribution ${contribution}`
      : `Contribution ${contribution} or ${alternative}`;
  }

  function contributionDescription(
    value: PlayerPrompt,
    choiceIds: readonly ChoiceId[],
  ): string | null {
    if (value.kind !== "selectSum" || choiceIds.length === 0) return null;
    const byId = new Map(value.choices.map((choice) => [choice.id, choice]));
    return choiceIds
      .map((id) => {
        const choice = byId.get(id);
        return choice === undefined ? null : contributionLabel(choice);
      })
      .filter((label): label is string => label !== null)
      .join(" + ");
  }
</script>

<section
  class="controls"
  aria-labelledby="active-prompt-heading"
  data-prompt-kind={prompt.kind}
>
  <p
    class="visually-hidden"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {liveAnnouncement}
  </p>
  <header>
    <p class="prompt-kind">Your decision · {prompt.kind}</p>
    <h2 id="active-prompt-heading" tabindex="-1" bind:this={heading}>
      {prompt.title}
    </h2>
    {#if prompt.message}<p>{prompt.message}</p>{/if}
    <p class="constraints" id={constraintsId}>
      {describePromptConstraints(prompt)}
    </p>
  </header>

  {#if prompt.contextCard}
    <details class="card-detail">
      <summary>Inspect {cardTitle(prompt.contextCard, "effect card")}</summary>
      {#if resolveCardImage(prompt.contextCard)}
        <img
          class="card-image"
          src={resolveCardImage(prompt.contextCard)}
          alt={cardTitle(prompt.contextCard, "Effect card")}
        />
      {/if}
      {#if prompt.contextCard.description}
        <p>{prompt.contextCard.description}</p>
      {:else}
        <p>No effect text is available.</p>
      {/if}
    </details>
  {/if}

  {#if prompt.choices.length === 0}
    {#if emptyValidation.valid}
      <button
        type="button"
        disabled={controlsDisabled}
        onclick={() => submit([], emptyValidation)}
        >{prompt.cancelable ? "Cancel" : "Continue"}</button
      >
    {:else}
      <div class="unsupported" role="alert">
        <h3>No supported choices</h3>
        <p>This prompt cannot be answered by the current interface.</p>
      </div>
    {/if}
  {:else if family === "single" || family === "toggle"}
    <div class="action-grid" role="group" aria-label={prompt.title}>
      {#each prompt.choices as choice (choice.id)}
        <div class="choice-with-detail">
          <button
            type="button"
            aria-pressed={family === "toggle"
              ? choice.selected === true
              : undefined}
            disabled={controlsDisabled}
            onclick={() => submit([choice.id])}
          >
            {choice.label}
            {choice.selected ? " · selected" : ""}
          </button>
          {#if choice.card}
            <details class="card-detail compact">
              <summary>Inspect {cardTitle(choice.card, choice.label)}</summary>
              {#if resolveCardImage(choice.card)}
                <img
                  class="card-image"
                  src={resolveCardImage(choice.card)}
                  alt={cardTitle(choice.card, choice.label)}
                />
              {/if}
              {#if choice.card.description}
                <p>{choice.card.description}</p>
              {:else}
                <p>No effect text is available.</p>
              {/if}
            </details>
          {/if}
        </div>
      {/each}
    </div>
  {:else if family === "multiple"}
    <fieldset
      disabled={controlsDisabled}
      aria-describedby={`${constraintsId}${!selectedValidation.valid && selected.length > 0 ? ` ${validationId}` : ""}`}
    >
      <legend>{prompt.title}</legend>
      <div class="selection-list">
        {#each prompt.choices as choice (choice.id)}
          <div class="selection-choice">
            <label>
              <input
                type="checkbox"
                checked={selected.includes(choice.id)}
                aria-invalid={!selectedValidation.valid && selected.length > 0}
                onchange={(event) =>
                  setSelected(choice.id, event.currentTarget.checked)}
              />
              <span>
                {choice.label}
                {#if contributionLabel(choice)}
                  <small>{contributionLabel(choice)}</small>
                {/if}
              </span>
            </label>
            {#if choice.card}
              <details class="card-detail compact">
                <summary>Inspect {cardTitle(choice.card, choice.label)}</summary
                >
                {#if resolveCardImage(choice.card)}
                  <img
                    class="card-image"
                    src={resolveCardImage(choice.card)}
                    alt={cardTitle(choice.card, choice.label)}
                  />
                {/if}
                {#if choice.card.description}
                  <p>{choice.card.description}</p>
                {:else}
                  <p>No effect text is available.</p>
                {/if}
              </details>
            {/if}
          </div>
        {/each}
      </div>
      {#if selectedContribution}
        <p class="selection-summary">
          Selected: {selectedContribution}
        </p>
      {/if}
      <div class="button-row">
        <button
          type="button"
          disabled={!selectedValidation.valid ||
            (selected.length === 0 && prompt.minimum > 0)}
          onclick={() => submit(selected, selectedValidation)}
        >
          Confirm selection
        </button>
        {#if prompt.cancelable}
          <button type="button" class="secondary" onclick={() => submit([])}
            >Cancel</button
          >
        {/if}
      </div>
      {#if !selectedValidation.valid && selected.length > 0}
        <p class="validation" id={validationId}>
          {selectedValidation.message}
        </p>
      {/if}
    </fieldset>
  {:else if family === "order"}
    <ol class="order-list">
      {#each order as choice, index (choice.id)}
        <li>
          <span><strong>{index + 1}.</strong> {choice.label}</span>
          <span class="order-actions">
            <button
              type="button"
              class="secondary compact-button"
              aria-label={`Move ${choice.label} up`}
              disabled={controlsDisabled || index === 0}
              onclick={() => moveChoice(index, -1)}>↑</button
            >
            <button
              type="button"
              class="secondary compact-button"
              aria-label={`Move ${choice.label} down`}
              disabled={controlsDisabled || index === order.length - 1}
              onclick={() => moveChoice(index, 1)}>↓</button
            >
          </span>
          {#if choice.card}
            <details class="card-detail compact">
              <summary>Inspect {cardTitle(choice.card, choice.label)}</summary>
              {#if resolveCardImage(choice.card)}
                <img
                  class="card-image"
                  src={resolveCardImage(choice.card)}
                  alt={cardTitle(choice.card, choice.label)}
                />
              {/if}
              <p>{choice.card.description || "No effect text is available."}</p>
            </details>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="visually-hidden">{reorderAnnouncement}</p>
    <div class="button-row">
      <button
        type="button"
        disabled={controlsDisabled || !orderValidation.valid}
        onclick={() =>
          submit(
            order.map((choice) => choice.id),
            orderValidation,
          )}>Confirm order</button
      >
      {#if prompt.cancelable}
        <button
          type="button"
          class="secondary"
          disabled={controlsDisabled}
          onclick={() => submit([])}>Cancel ordering</button
        >
      {/if}
    </div>
  {:else if family === "counter"}
    <div class="counter-list">
      {#each prompt.choices as choice (choice.id)}
        <div class="counter-row">
          <span>{choice.label}</span>
          <div role="group" aria-label={`Counters on ${choice.label}`}>
            <button
              type="button"
              class="secondary compact-button"
              aria-label={`Remove one counter from ${choice.label}`}
              disabled={controlsDisabled || (allocations[choice.id] ?? 0) === 0}
              onclick={() => adjustAllocation(choice, -1)}>−</button
            >
            <output aria-live="polite">{allocations[choice.id] ?? 0}</output>
            <button
              type="button"
              class="secondary compact-button"
              aria-label={`Add one counter to ${choice.label}`}
              disabled={controlsDisabled ||
                (allocations[choice.id] ?? 0) >=
                  (choice.allocationMaximum ?? 0) ||
                allocatedIds.length >= prompt.maximum}
              onclick={() => adjustAllocation(choice, 1)}>+</button
            >
          </div>
          {#if choice.card}
            <details class="card-detail compact">
              <summary>Inspect {cardTitle(choice.card, choice.label)}</summary>
              {#if resolveCardImage(choice.card)}
                <img
                  class="card-image"
                  src={resolveCardImage(choice.card)}
                  alt={cardTitle(choice.card, choice.label)}
                />
              {/if}
              <p>{choice.card.description || "No effect text is available."}</p>
            </details>
          {/if}
        </div>
      {/each}
    </div>
    <button
      type="button"
      disabled={controlsDisabled || !allocationValidation.valid}
      onclick={() => submit(allocatedIds, allocationValidation)}
      >Confirm allocation</button
    >
  {/if}

  {#if localError}
    <p class="validation">{localError}</p>
  {/if}
</section>
{#if submitted || disabled}
  <p class="sent">Response sent. Waiting for the engine…</p>
{/if}

<style>
  .controls {
    display: grid;
    gap: 1rem;
  }

  header p:last-child,
  .card-detail p {
    margin-bottom: 0;
  }

  .prompt-kind {
    margin-bottom: 0.35rem;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .constraints,
  .selection-summary,
  .sent {
    color: var(--muted);
  }

  .action-grid,
  .selection-list,
  .counter-list {
    display: grid;
    gap: 0.65rem;
  }

  .action-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  }

  .choice-with-detail,
  .selection-choice,
  .counter-row,
  .order-list li {
    min-width: 0;
    padding: 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    background: #0d1729;
  }

  .choice-with-detail > button {
    width: 100%;
  }

  .card-detail {
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.55rem;
    background: #0a1323;
  }

  .card-detail.compact {
    margin-top: 0.55rem;
    padding: 0.55rem;
  }

  .card-image {
    display: block;
    width: min(11rem, 100%);
    height: auto;
    margin: 0.75rem auto;
    border-radius: 0.45rem;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
  }

  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  .selection-choice label {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    cursor: pointer;
  }

  .selection-choice input {
    width: 1.2rem;
    height: 1.2rem;
    margin-top: 0.15rem;
    accent-color: var(--accent);
  }

  .selection-choice small {
    display: block;
    margin-top: 0.2rem;
    color: var(--muted);
  }

  .button-row,
  .counter-row,
  .counter-row [role="group"],
  .order-list li,
  .order-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .button-row {
    flex-wrap: wrap;
    margin-top: 1rem;
  }

  .counter-row,
  .order-list li {
    justify-content: space-between;
  }

  .counter-row output {
    min-width: 2ch;
    text-align: center;
    font-weight: 800;
  }

  .compact-button {
    min-width: 2.5rem;
    min-height: 2.5rem;
    padding: 0.45rem;
  }

  .order-list {
    display: grid;
    gap: 0.65rem;
    padding: 0;
    list-style: none;
  }

  .validation,
  .unsupported {
    color: var(--danger);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 34rem) {
    .counter-row,
    .order-list li {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
