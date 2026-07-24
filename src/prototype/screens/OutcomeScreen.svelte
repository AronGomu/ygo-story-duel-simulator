<script lang="ts">
  import type { BattleResult } from "../model/prototype-state.ts";
  export let outcome: BattleResult = "win";
  export let oncontinue: () => void = () => undefined;
  export let onretry: () => void = () => undefined;
  export let onreturn: () => void = () => undefined;
</script>

<section
  class:recovery={outcome === "abort" || outcome === "failure"}
  class="outcome-screen"
  aria-labelledby="outcome-heading"
>
  <p class="eyebrow">Authored outcome · {outcome}</p>
  {#if outcome === "win"}<h1 id="outcome-heading">Signal broken</h1>
    <p>
      The final attack cuts through the false arena. Rin catches the decoded
      pulse before it fades.
    </p>
    <p>
      “You won us an answer,” she says. “Now we find who asked the question.”
    </p>
    <button type="button" onclick={oncontinue}>Continue story</button>
  {:else if outcome === "loss"}<h1 id="outcome-heading">Signal endures</h1>
    <p>
      Your last card falls, but the arena does not close. The opponent lowers
      its duel disk.
    </p>
    <p>
      Rin smiles. “It wanted a complete duel, not a victory. We still have its
      answer.”
    </p>
    <button type="button" onclick={oncontinue}>Continue story</button>
  {:else if outcome === "abort"}<h1 id="outcome-heading">Duel paused</h1>
    <p>No story progress changed. Resume when ready or return safely.</p>
    <div>
      <button type="button" onclick={onretry}>Retry duel</button><button
        type="button"
        class="secondary"
        onclick={onreturn}>Return to map</button
      >
    </div>
  {:else}<h1 id="outcome-heading">Connection interrupted</h1>
    <p>
      Technical failure stopped the mock duel. This is not an authored loss.
    </p>
    <div>
      <button type="button" onclick={onretry}>Retry duel</button><button
        type="button"
        class="secondary"
        onclick={onreturn}>Return to map</button
      >
    </div>{/if}
</section>

<style>
  .outcome-screen {
    min-height: 100svh;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 0.75rem;
    padding: clamp(1rem, 8vw, 7rem);
    background:
      radial-gradient(circle at 70% 50%, #3c796b, transparent 25%), #07111f;
  }
  .outcome-screen.recovery {
    background:
      radial-gradient(circle at 70% 50%, #60445c, transparent 25%), #07111f;
  }
  .outcome-screen p {
    max-width: 55ch;
    font-size: clamp(1rem, 2.5vw, 1.3rem);
    line-height: 1.6;
  }
  .outcome-screen div {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
</style>
