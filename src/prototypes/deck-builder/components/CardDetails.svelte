<script lang="ts">
  import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
  import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
  import { quantityLimit } from "../../../decks/catalog/pinned-ruleset.ts";

  export let card: DeckBuilderCardView | null = null;
  export let missingCode: number | null = null;
  export let copies: Readonly<{ main: number; extra: number; side: number }> = {
    main: 0,
    extra: 0,
    side: 0,
  };
  export let ruleset: PinnedDeckRuleset;

  $: limit = card === null ? 3 : quantityLimit(ruleset, card.code);
  $: limitLabel =
    limit === 0
      ? "Forbidden"
      : limit === 1
        ? "Limited"
        : limit === 2
          ? "Semi-Limited"
          : "Unlimited";
</script>

<aside class="details" aria-labelledby="card-details-heading">
  <p class="section-label">Pinned card details</p>
  {#if card === null && missingCode !== null}
    <h2 id="card-details-heading">Unknown card #{missingCode}</h2>
    <div class="missing-details" role="alert">
      <p class="section-label">Missing catalog entry</p>
      <p class="muted">
        Card data, text, and art are unavailable. Remove placeholder from its
        deck zone or restore catalog data.
      </p>
      <dl>
        <div>
          <dt>Code</dt>
          <dd>{missingCode}</dd>
        </div>
        <div>
          <dt>Copies</dt>
          <dd>
            {copies.main} Main · {copies.extra} Extra · {copies.side} Side
          </dd>
        </div>
      </dl>
    </div>
  {:else if card === null}
    <h2 id="card-details-heading">Select a card</h2>
    <p class="muted">
      Choose a catalog or deck tile to inspect full card text.
    </p>
  {:else}
    <div class="art">
      {#if card.imageUrl}
        <img src={card.imageUrl} alt={card.name} />
      {:else}
        <span aria-hidden="true">{card.family.slice(0, 1).toUpperCase()}</span>
        <small>Artwork unavailable</small>
      {/if}
      <span class={`limit limit-${limit}`}>{limit}</span>
    </div>
    <h2 id="card-details-heading">{card.name}</h2>
    <p class="type-line">{[card.family, ...card.subtypes].join(" · ")}</p>
    <dl>
      <div>
        <dt>Code</dt>
        <dd>{card.code}</dd>
      </div>
      {#if card.attribute}<div>
          <dt>Attribute</dt>
          <dd>{card.attribute}</dd>
        </div>{/if}
      {#if card.race}<div>
          <dt>Monster type</dt>
          <dd>{card.race}</dd>
        </div>{/if}
      {#if card.ratingLabel}<div>
          <dt>{card.ratingLabel}</dt>
          <dd>{card.levelRankLink}</dd>
        </div>{/if}
      {#if card.attack !== null}<div>
          <dt>ATK</dt>
          <dd>{card.attack}</dd>
        </div>{/if}
      {#if card.defense !== null}<div>
          <dt>DEF</dt>
          <dd>{card.defense}</dd>
        </div>{/if}
      {#if card.pendulumScales}<div>
          <dt>Scales</dt>
          <dd>{card.pendulumScales.join(" / ")}</dd>
        </div>{/if}
      {#if card.linkMarkers.length > 0}<div>
          <dt>Markers</dt>
          <dd>{card.linkMarkers.join(", ")}</dd>
        </div>{/if}
      <div>
        <dt>Target</dt>
        <dd>{card.canonicalZone === "main" ? "Main Deck" : "Extra Deck"}</dd>
      </div>
      <div>
        <dt>Limit</dt>
        <dd>{limitLabel} ({limit})</dd>
      </div>
      <div>
        <dt>Copies</dt>
        <dd>{copies.main} Main · {copies.extra} Extra · {copies.side} Side</dd>
      </div>
    </dl>
    <section class="effect-text" aria-label="Card text">
      <h3>Card text</h3>
      <p>{card.description || "No card text is available."}</p>
    </section>
  {/if}
</aside>

<style>
  .details {
    min-width: 0;
    height: calc(100vh - 9.5rem);
    overflow-y: auto;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--surface);
  }

  h2,
  h3,
  p {
    margin-top: 0;
  }

  .section-label,
  .muted,
  .type-line,
  dt {
    color: var(--muted);
  }

  .section-label {
    margin-bottom: 0.3rem;
    font-size: 0.76rem;
    font-weight: 750;
  }

  .art {
    position: relative;
    display: grid;
    width: min(12rem, 100%);
    aspect-ratio: 59 / 86;
    margin: 0 auto 1rem;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.55rem;
    background: #0d1729;
    font-size: 3rem;
  }

  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .art small {
    font-size: 0.72rem;
  }

  .limit {
    position: absolute;
    top: 0.35rem;
    left: 0.35rem;
    display: grid;
    width: 1.55rem;
    height: 1.55rem;
    place-items: center;
    border: 2px solid currentColor;
    border-radius: 999px;
    color: #08101f;
    background: #73daca;
    font-size: 0.78rem;
    font-weight: 900;
  }

  .limit-0 {
    color: #fff;
    background: #b52140;
  }
  .limit-1 {
    background: #ff8c9b;
  }
  .limit-2 {
    background: #ffd580;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  dl div {
    min-width: 0;
  }

  dt {
    font-size: 0.7rem;
  }

  dd {
    margin: 0.15rem 0 0;
    overflow-wrap: anywhere;
    font-weight: 700;
  }

  .effect-text {
    padding-top: 0.85rem;
    border-top: 1px solid var(--border);
  }

  .effect-text p {
    white-space: pre-line;
    line-height: 1.55;
  }
</style>
