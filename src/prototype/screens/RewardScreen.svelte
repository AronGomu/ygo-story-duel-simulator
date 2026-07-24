<script lang="ts">
  export let autosaveStatus: "idle" | "success" | "failure" = "idle";
  export let onretry: () => void = () => undefined;
  export let oncontinue: () => void = () => undefined;
  let continued = false;
  function proceed(): void {
    if (continued) return;
    continued = true;
    oncontinue();
  }
</script>

<section class="reward-screen" aria-labelledby="reward-heading">
  <p class="eyebrow">Progress updated</p>
  <div class="reward-icon" aria-hidden="true">◇</div>
  <h1 id="reward-heading">Signal Cipher</h1>
  <p>
    You decoded a route key. The Archive route can now be inspected from the
    city map.
  </p>
  <dl>
    <div>
      <dt>Old Arena</dt>
      <dd>Completed · remains available</dd>
    </div>
    <div>
      <dt>Objective</dt>
      <dd>Inspect the opened Archive route</dd>
    </div>
  </dl>
  {#if autosaveStatus === "success"}
    <p role="status" class="autosave">
      Autosave complete at stable story boundary.
    </p>
  {:else if autosaveStatus === "failure"}
    <div class="autosave failure" role="alert">
      <p>Autosave failed. In-memory progress remains playable.</p>
      <button type="button" class="secondary" onclick={onretry}
        >Retry autosave</button
      >
    </div>
  {:else}
    <p role="status" class="autosave">Autosave pending.</p>
  {/if}
  <button type="button" disabled={continued} onclick={proceed}
    >{continued ? "Opening map…" : "Continue to updated map"}</button
  >
</section>

<style>
  .reward-screen {
    min-height: 100svh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.8rem;
    padding: 1rem;
    text-align: center;
    background: radial-gradient(circle, #244e5e, #07111f 55%);
  }
  .reward-icon {
    width: 8rem;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 2px solid #f0d17b;
    border-radius: 50%;
    font-size: 5rem;
    color: #f0d17b;
    box-shadow: 0 0 3rem #f0d17455;
  }
  .reward-screen p {
    max-width: 40rem;
    line-height: 1.6;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
  }
  dl div {
    padding: 0.8rem 1rem;
    background: #10243a;
  }
  dt {
    color: var(--prototype-muted);
  }
  dd {
    margin: 0.2rem 0 0;
    font-weight: 800;
  }
  .autosave {
    color: #8ef1e9;
  }
  .autosave.failure {
    color: #ffd2d7;
  }
</style>
