<script lang="ts">
  import { onMount } from "svelte";

  export let hasProgress = false;
  export let onnewgame: () => void = () => undefined;
  export let oncontinue: () => void = () => undefined;
  export let onload: () => void = () => undefined;
  export let onsettings: () => void = () => undefined;
  let primary: HTMLButtonElement;
  onMount(() => primary.focus());
</script>

<section class="screen title-screen" aria-labelledby="title-heading">
  <p class="eyebrow">Private visual novel prototype · v0.1</p>
  <h1 id="title-heading" tabindex="-1">Echoes of the Draw</h1>
  <p>One signal. One duel. More than one way forward.</p>
  <nav aria-label="Title menu">
    <button type="button" bind:this={primary} onclick={onnewgame}
      >New Game</button
    >
    {#if hasProgress}<button type="button" onclick={oncontinue}>Continue</button
      >{/if}
    <button type="button" class="secondary" onclick={onload}>Load</button>
    <button type="button" class="secondary" onclick={onsettings}
      >Settings</button
    >
  </nav>
</section>

<style>
  .title-screen {
    min-height: 70svh;
    display: grid;
    align-content: center;
    justify-items: start;
    padding: clamp(1rem, 8vw, 6rem);
    background:
      radial-gradient(circle at 70% 30%, #214b68, transparent 35%),
      linear-gradient(120deg, #08111c, #122b44);
  }
  h1 {
    max-width: 8ch;
    font-family: Georgia, serif;
    font-size: clamp(3rem, 10vw, 7rem);
    line-height: 0.85;
  }
  nav {
    display: grid;
    gap: 0.65rem;
    width: min(20rem, 100%);
    margin-block-start: 2rem;
  }
</style>
