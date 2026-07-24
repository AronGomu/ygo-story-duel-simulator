<script lang="ts">
  import VisualDirectionBoards from "../components/VisualDirectionBoards.svelte";
  import type { PrototypeScreen } from "../model/prototype-state.ts";
  export let hasProgress = false;
  export let onstart: () => void = () => undefined;
  export let onjump: (screen: PrototypeScreen) => void = () => undefined;
  export let onreset: () => void = () => undefined;
  let showJumps = false;
  const jumps: readonly {
    readonly screen: PrototypeScreen;
    readonly label: string;
  }[] = [
    { screen: "title", label: "Title" },
    { screen: "load", label: "Load" },
    { screen: "narrative", label: "Narrative" },
    { screen: "map", label: "Map" },
    { screen: "pre-battle", label: "Pre-battle" },
    { screen: "battle-mock", label: "Battle mock" },
    { screen: "outcome", label: "Outcome" },
    { screen: "reward", label: "Reward" },
    { screen: "end", label: "End" },
  ];
</script>

<main class="launcher-shell">
  <section class="launcher" aria-labelledby="prototype-heading">
    <p class="eyebrow">Private · disposable · reviewer build</p>
    <h1 id="prototype-heading">Visual novel prototype</h1>
    <p class="lede">
      Provisional names, story, art, and state. Isolated from duel runtime and
      production saves.
    </p>
    {#if hasProgress}<p role="status">
        Mock progress available for Continue/Load review.
      </p>{/if}
    <div class="actions">
      <button type="button" onclick={onstart}>Start full flow</button><button
        type="button"
        class="secondary"
        aria-expanded={showJumps}
        onclick={() => (showJumps = !showJumps)}>Jump to screen or state</button
      ><button type="button" class="secondary" onclick={onreset}
        >Reset prototype</button
      >
    </div>
    {#if showJumps}<nav aria-label="Review state jumps">
        {#each jumps as jump (jump.screen)}<button
            type="button"
            class="secondary"
            onclick={() => onjump(jump.screen)}>Jump to {jump.label}</button
          >{/each}
      </nav>{/if}
    <p class="review-hint">
      Review at 1280×720 desktop, 768px tablet, and 375px mobile. Every state is
      provisional.
    </p>
  </section>
  <VisualDirectionBoards />
</main>

<style>
  .launcher-shell {
    min-height: 100svh;
    display: grid;
    gap: 3rem;
    justify-items: center;
    padding: clamp(1rem, 5vw, 4rem);
  }
  .launcher {
    width: min(48rem, 100%);
    padding: clamp(1.25rem, 4vw, 3rem);
    border: 1px solid var(--prototype-border);
    border-radius: 1rem;
    background: linear-gradient(145deg, #10243a, #0a1828);
  }
  .lede,
  .review-hint {
    color: var(--prototype-muted);
    line-height: 1.6;
  }
  .actions,
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-block: 1rem;
  }
  nav {
    padding: 1rem;
    border: 1px dashed var(--prototype-border);
  }
  @media (max-width: 30rem) {
    .actions > *,
    nav > * {
      width: 100%;
    }
  }
</style>
