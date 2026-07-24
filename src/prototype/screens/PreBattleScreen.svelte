<script lang="ts">
  export let allowReturn = true;
  export let onstart: () => void = () => undefined;
  export let onreturn: () => void = () => undefined;
  let started = false;
  function start(): void {
    if (started) return;
    started = true;
    onstart();
  }
</script>

<section class="briefing" aria-labelledby="briefing-heading">
  <div
    class="opponent-art"
    role="img"
    aria-label="Provisional silhouette of Rin's Echo"
  >
    RE
  </div>
  <div class="briefing-copy">
    <p class="eyebrow">Pre-battle briefing</p>
    <h1 id="briefing-heading">Rin's Echo</h1>
    <p>
      The arena transmitter shaped Rin's warning into an opponent. Win or lose,
      finish the duel to decode its challenge.
    </p>
    <dl>
      <div>
        <dt>Your deck</dt>
        <dd>Signal Deck</dd>
      </div>
      <div>
        <dt>Opponent deck</dt>
        <dd>Relay Deck</dd>
      </div>
      <div>
        <dt>Format</dt>
        <dd>Single duel · prototype rules</dd>
      </div>
      <div>
        <dt>Objective</dt>
        <dd>Decode the challenge signal</dd>
      </div>
    </dl>
    <p class="checkpoint" role="status">Mock checkpoint saved before battle.</p>
    <div class="actions">
      <button type="button" disabled={started} onclick={start}
        >{started ? "Entering duel…" : "Start Duel"}</button
      >{#if allowReturn}<button
          type="button"
          class="secondary"
          onclick={onreturn}>Return to Map</button
        >{/if}
    </div>
  </div>
</section>

<style>
  .briefing {
    min-height: 100svh;
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(0, 1.3fr);
    align-items: center;
    gap: clamp(1rem, 5vw, 5rem);
    padding: clamp(1rem, 6vw, 5rem);
    background:
      radial-gradient(circle at 20% 50%, #284b63, transparent 25%), #07111f;
  }
  .opponent-art {
    aspect-ratio: 3/4;
    display: grid;
    place-items: center;
    border: 1px solid var(--prototype-border);
    border-radius: 45% 45% 12% 12%;
    background: linear-gradient(#31566d, #0d1825);
    font: 800 clamp(4rem, 15vw, 10rem) Georgia;
    color: #b9d8e8;
  }
  .briefing-copy {
    max-width: 42rem;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  dl div {
    padding: 0.8rem;
    background: #10243a;
  }
  dt {
    color: var(--prototype-muted);
    font-size: 0.8rem;
  }
  dd {
    margin: 0.2rem 0 0;
    font-weight: 800;
  }
  .checkpoint {
    padding: 0.7rem;
    border-left: 3px solid var(--prototype-accent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  @media (max-width: 42rem) {
    .briefing {
      grid-template-columns: 1fr;
    }
    .opponent-art {
      max-height: 30svh;
      aspect-ratio: 16/7;
    }
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
