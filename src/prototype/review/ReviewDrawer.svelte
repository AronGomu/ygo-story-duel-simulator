<script lang="ts">
  import type {
    PrototypeScreen,
    PrototypeState,
  } from "../model/prototype-state.ts";
  import { REVIEW_PRESETS } from "./review-presets.ts";
  import {
    serializeReviewLink,
    type ReviewMapState,
    type ReviewState,
  } from "./review-link.ts";
  export let state: PrototypeState;
  export let missingAssets = false;
  export let storageFailure = false;
  export let reducedMotion = false;
  export let mapState: ReviewMapState = "default";
  export let onchange: (
    field:
      | "preset"
      | "screen"
      | "choice"
      | "map"
      | "outcome"
      | "missingAssets"
      | "storageFailure"
      | "reducedMotion",
    value: string | boolean | null,
  ) => void = () => undefined;
  export let onreset: () => void = () => undefined;
  export let copyText: (value: string) => Promise<void> = async (value) => {
    if (navigator.clipboard?.writeText === undefined)
      throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
  };
  let open = false;
  let copyStatus = "";

  $: reviewState = {
    screen: state.screen,
    choice: state.choice,
    map: mapState,
    outcome: state.outcome,
    missingAssets,
    storageFailure,
    reducedMotion,
  } satisfies ReviewState;

  async function copyLink(): Promise<void> {
    const query = serializeReviewLink(reviewState);
    const url = `${globalThis.location.origin}${globalThis.location.pathname}${query}`;
    try {
      await copyText(url);
      copyStatus = "Review link copied.";
    } catch {
      copyStatus = "Copy unavailable; URL updated in address bar.";
    }
    history.replaceState(null, "", url);
  }
</script>

<aside class:open aria-label="Reviewer tools">
  <button
    type="button"
    class="drawer-toggle"
    aria-expanded={open}
    onclick={() => (open = !open)}>Reviewer tools</button
  >
  {#if open}<div class="drawer-content">
      <p class="reviewer-label">REVIEWER-ONLY · never player UI</p>
      <label
        >State matrix preset<select
          aria-label="State matrix preset"
          value=""
          onchange={(event) => onchange("preset", event.currentTarget.value)}
          ><option value="" disabled>Select a review state</option>
          {#each REVIEW_PRESETS as [id, label] (id)}
            <option value={id}>{label}</option>
          {/each}</select
        ></label
      >
      <label
        >Jump to screen<select
          aria-label="Jump to screen"
          value={state.screen}
          onchange={(event) =>
            onchange("screen", event.currentTarget.value as PrototypeScreen)}
          >{#each ["launcher", "title", "load", "narrative", "map", "pre-battle", "battle-mock", "outcome", "reward", "end"] as screen (screen)}<option
              value={screen}>{screen}</option
            >{/each}</select
        ></label
      >
      <label
        >Choice result<select
          aria-label="Choice result"
          value={state.choice ?? ""}
          onchange={(event) =>
            onchange("choice", event.currentTarget.value || null)}
          ><option value="">unresolved</option><option value="trust-rin"
            >trust-rin</option
          ><option value="challenge-rin">challenge-rin</option><option
            value="observe-first">observe-first</option
          ></select
        ></label
      >
      <label
        >Map state<select
          aria-label="Map state"
          bind:value={mapState}
          onchange={() => onchange("map", mapState)}
          >{#each ["default", "available", "locked", "hidden", "completed", "available-completed"] as option (option)}<option
              value={option}>{option}</option
            >{/each}</select
        ></label
      >
      <label
        >Battle result<select
          aria-label="Battle result"
          value={state.outcome ?? ""}
          onchange={(event) =>
            onchange("outcome", event.currentTarget.value || null)}
          ><option value="">ready</option><option value="win">win</option
          ><option value="loss">loss</option><option value="abort">abort</option
          ><option value="failure">failure</option></select
        ></label
      >
      <label class="check"
        ><input
          aria-label="Missing asset preview"
          type="checkbox"
          checked={missingAssets}
          onchange={(event) =>
            onchange("missingAssets", event.currentTarget.checked)}
        />Missing asset preview</label
      >
      <label class="check"
        ><input
          aria-label="Storage failure preview"
          type="checkbox"
          checked={storageFailure}
          onchange={(event) =>
            onchange("storageFailure", event.currentTarget.checked)}
        />Storage failure preview</label
      >
      <label class="check"
        ><input
          aria-label="Reduced motion preview"
          type="checkbox"
          checked={reducedMotion}
          onchange={(event) =>
            onchange("reducedMotion", event.currentTarget.checked)}
        />Reduced motion preview</label
      >
      <div class="drawer-actions">
        <button type="button" onclick={() => void copyLink()}
          >Copy review link</button
        ><button type="button" class="secondary" onclick={onreset}
          >Reset prototype</button
        >
      </div>
      {#if copyStatus}<p role="status">{copyStatus}</p>{/if}
      <details>
        <summary>Current state JSON</summary>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </details>
    </div>{/if}
</aside>

<style>
  aside {
    position: fixed;
    z-index: 20;
    right: max(0.5rem, env(safe-area-inset-right));
    bottom: max(0.5rem, env(safe-area-inset-bottom));
    max-width: min(25rem, calc(100vw - 1rem));
    border: 2px dashed #e6ba69;
    border-radius: 0.55rem;
    background: #201b19;
    color: #fff;
  }
  .drawer-toggle {
    width: 100%;
    background: #e6ba69;
    border-color: #f4d995;
  }
  .drawer-content {
    max-height: min(42rem, calc(100svh - 5rem));
    overflow: auto;
    padding: 1rem;
  }
  .reviewer-label {
    color: #ffd486;
    font-weight: 900;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }
  .drawer-content > label {
    display: grid;
    gap: 0.25rem;
    margin: 0.7rem 0;
  }
  .drawer-content select {
    min-height: 44px;
    padding: 0.5rem;
    background: #090f18;
    color: #fff;
    border: 1px solid #8f7957;
  }
  .drawer-content .check {
    grid-template-columns: 44px 1fr;
    align-items: center;
  }
  .check input {
    width: 24px;
    height: 24px;
  }
  .drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  pre {
    max-height: 14rem;
    overflow: auto;
    padding: 0.75rem;
    background: #070b10;
    color: #d9f3ef;
    font-size: 0.7rem;
  }
</style>
