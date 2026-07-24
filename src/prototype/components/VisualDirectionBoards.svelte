<script lang="ts">
  const directions = [
    {
      id: "continuity",
      name: "Existing client continuity",
      benefit: "Natural transition from current duel client.",
      risk: "Product chrome may mute story atmosphere.",
    },
    {
      id: "broadcast",
      name: "Duel-anime broadcast",
      benefit: "High-energy objectives and chapter framing.",
      risk: "Dense motifs can become noisy.",
    },
    {
      id: "cinematic",
      name: "Cinematic visual novel",
      benefit: "Art and dialogue carry emotional focus.",
      risk: "Quiet chrome may clash with dense duel UI.",
    },
  ] as const;
  let selected: (typeof directions)[number]["id"] = "continuity";
</script>

<section class="direction-comparison" aria-labelledby="direction-heading">
  <div class="section-heading">
    <p class="eyebrow">Direction study · proposed, not approved</p>
    <h2 id="direction-heading">Compare visual directions</h2>
  </div>
  <div class="boards" role="radiogroup" aria-label="Visual direction">
    {#each directions as direction (direction.id)}
      <button
        type="button"
        role="radio"
        aria-checked={selected === direction.id}
        class:active={selected === direction.id}
        class={`board ${direction.id}`}
        onclick={() => (selected = direction.id)}
        onkeydown={(event) => {
          if (event.key === " " || event.key === "Enter")
            selected = direction.id;
        }}
      >
        <span class="direction-name">{direction.name}</span>
        <span class="sample-title">The Signal Beneath the City</span>
        <span class="sample-stage" aria-hidden="true">
          <span class="moon"></span><span class="marker">Old Arena</span>
        </span>
        <span class="sample-dialogue"><strong>Rin</strong> “You came.”</span>
        <span class="tradeoff"
          ><strong>Benefit:</strong> {direction.benefit}</span
        >
        <span class="tradeoff"><strong>Risk:</strong> {direction.risk}</span>
      </button>
    {/each}
  </div>
</section>

<style>
  .direction-comparison {
    width: min(74rem, 100%);
  }
  .section-heading {
    margin-block-end: 1rem;
  }
  h2 {
    margin: 0.35rem 0;
    font-size: clamp(1.5rem, 4vw, 2.4rem);
  }
  .boards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }
  .board {
    min-width: 0;
    min-height: 26rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    align-items: stretch;
    text-align: left;
    color: #eef8ff;
    background: #0e2235;
    border-color: #45647b;
  }
  .board.active {
    border-color: #47d7cc;
    box-shadow: inset 0 0 0 2px #47d7cc;
  }
  .direction-name {
    min-height: 2.6rem;
    color: #8ef1e9;
    font-weight: 800;
  }
  .sample-title {
    font-size: 1.35rem;
    line-height: 1.05;
  }
  .sample-stage {
    position: relative;
    min-height: 8rem;
    overflow: hidden;
    border-radius: 0.4rem;
    background:
      radial-gradient(circle at 70% 25%, #d8efff 0 5%, transparent 6%),
      linear-gradient(#173d58, #08111d);
  }
  .marker {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    padding: 0.35rem;
    border: 1px solid currentColor;
  }
  .sample-dialogue {
    padding: 0.75rem;
    background: #06111ddd;
  }
  .tradeoff {
    color: #c7d7e3;
    font-size: 0.85rem;
    line-height: 1.4;
  }
  .broadcast {
    border-width: 3px;
    text-transform: uppercase;
    background: repeating-linear-gradient(
      135deg,
      #321548 0 12px,
      #1a2f58 12px 24px
    );
  }
  .broadcast .sample-title {
    padding: 0.5rem;
    background: #ffcc3d;
    color: #1b1020;
    transform: skew(-3deg);
  }
  .cinematic {
    justify-content: flex-end;
    background:
      linear-gradient(transparent 20%, #050b14 75%),
      radial-gradient(circle at 50% 30%, #36536d, #080f18);
  }
  .cinematic .sample-stage {
    min-height: 11rem;
    order: -1;
  }
  .cinematic .direction-name {
    min-height: auto;
    font-family: Georgia, serif;
    letter-spacing: 0.08em;
  }
  @media (max-width: 55rem) {
    .boards {
      grid-template-columns: 1fr;
    }
    .board {
      min-height: 22rem;
    }
  }
</style>
