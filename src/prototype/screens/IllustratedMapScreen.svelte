<script lang="ts">
  import mapAsset from "../assets/city-map-placeholder.svg";
  import type {
    LocationId,
    PrototypeLocationState,
  } from "../model/prototype-state.ts";
  export let locations: readonly PrototypeLocationState[] = [];
  export let objective = "Investigate the Old Arena signal";
  export let choiceAcknowledgment: string | null = null;
  export let allowBack = false;
  export let onselect: (id: LocationId) => void = () => undefined;
  export let onback: () => void = () => undefined;

  const details: Record<
    LocationId,
    {
      readonly name: string;
      readonly marker: string;
      readonly summary: string;
      readonly lockedReason?: string;
      readonly x: string;
      readonly y: string;
    }
  > = {
    "old-arena": {
      name: "Old Arena",
      marker: "battle",
      summary: "A dormant transmitter is staging an unanswered duel.",
      x: "29%",
      y: "55%",
    },
    archive: {
      name: "Archive",
      marker: "story",
      summary: "Signal records from the first city tournament.",
      lockedReason: "Requires decoded arena signal.",
      x: "74%",
      y: "34%",
    },
    "hidden-gate": {
      name: "Hidden Gate",
      marker: "story",
      summary: "Reviewer-only hidden location.",
      x: "52%",
      y: "25%",
    },
  };
  let selectedId: LocationId | null = null;
  $: visibleLocations = locations.filter(({ access }) => access !== "hidden");
  $: if (
    selectedId === null ||
    !visibleLocations.some(({ id }) => id === selectedId)
  )
    selectedId = visibleLocations[0]?.id ?? null;

  function label(location: PrototypeLocationState): string {
    const detail = details[location.id];
    return `${detail.name}, ${detail.marker} marker, ${location.access}${location.completed ? ", completed" : ", not completed"}`;
  }
  function inspect(location: PrototypeLocationState): void {
    selectedId = location.id;
  }
  function activate(location: PrototypeLocationState): void {
    selectedId = location.id;
    if (location.access === "available") onselect(location.id);
  }
</script>

<section class="map-screen" aria-labelledby="map-heading">
  <header>
    <p class="eyebrow">Chapter 1 · River district</p>
    <h1 id="map-heading">City signal map</h1>
    <p class="objective"><strong>Objective:</strong> {objective}</p>
    {#if choiceAcknowledgment}
      <p class="choice-acknowledgment" role="status">
        <strong>Earlier choice:</strong>
        {choiceAcknowledgment}
      </p>
    {/if}
  </header>
  <div class="map-layout">
    <div class="map-art">
      <img src={mapAsset} alt="Illustrated city map of the river district" />
      <div class="hotspots" aria-label="Map hotspots">
        {#each visibleLocations as location (location.id)}
          <button
            type="button"
            class:locked={location.access === "locked"}
            class:completed={location.completed}
            class="hotspot"
            style:left={details[location.id].x}
            style:top={details[location.id].y}
            data-location-id={location.id}
            aria-label={label(location)}
            aria-disabled={location.access !== "available"}
            aria-pressed={selectedId === location.id}
            onfocus={() => inspect(location)}
            onmouseenter={() => inspect(location)}
            onclick={() => activate(location)}
            ><span aria-hidden="true"
              >{location.access === "locked"
                ? "◆"
                : location.completed
                  ? "✓"
                  : "!"}</span
            ></button
          >
        {/each}
      </div>
    </div>
    <div class="map-sidebar">
      <ul aria-label="Location list">
        {#each visibleLocations as location (location.id)}
          <li>
            <button
              type="button"
              class:locked={location.access === "locked"}
              class:completed={location.completed}
              data-location-id={location.id}
              aria-label={label(location)}
              aria-disabled={location.access !== "available"}
              aria-pressed={selectedId === location.id}
              onfocus={() => inspect(location)}
              onmouseenter={() => inspect(location)}
              onclick={() => activate(location)}
              ><strong>{details[location.id].name}</strong><span
                >{details[location.id].marker} · {location.access}{location.completed
                  ? " · completed"
                  : ""}</span
              ></button
            >
          </li>
        {/each}
      </ul>
      {#if selectedId}
        <section class="detail" aria-label="Location detail">
          <h2>{details[selectedId].name}</h2>
          <p>{details[selectedId].summary}</p>
          {#if locations.find(({ id }) => id === selectedId)?.access === "locked"}<p
              class="locked-reason"
            >
              Locked: {details[selectedId].lockedReason ??
                "Unavailable in this story state."}
            </p>{/if}
        </section>
      {/if}
      {#if allowBack}<button type="button" class="secondary" onclick={onback}
          >Back</button
        >{/if}
    </div>
  </div>
</section>

<style>
  .map-screen {
    min-height: 100svh;
    padding: clamp(1rem, 4vw, 3rem);
    background: #07111f;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  h1 {
    margin: 0.2rem 0;
  }
  .objective,
  .choice-acknowledgment {
    max-width: 32rem;
    padding: 0.75rem 1rem;
    border-left: 3px solid var(--prototype-accent);
    background: #10243a;
  }
  .choice-acknowledgment {
    border-left-color: #a78bfa;
  }
  .map-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
    gap: 1rem;
  }
  .map-art {
    position: relative;
    align-self: start;
    overflow: hidden;
    border: 1px solid var(--prototype-border);
    border-radius: 0.8rem;
  }
  .map-art img {
    display: block;
    width: 100%;
    height: auto;
  }
  .hotspots {
    position: absolute;
    inset: 0;
  }
  .hotspot {
    position: absolute;
    width: 52px;
    min-height: 52px;
    padding: 0;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 8px #47d7cc33;
  }
  .hotspot.locked {
    background: #334657;
    color: #fff;
    border-color: #b9cad8;
  }
  .completed {
    box-shadow: inset 0 0 0 3px #fff;
  }
  .map-sidebar {
    min-width: 0;
  }
  ul {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li button {
    width: 100%;
    display: grid;
    gap: 0.25rem;
    text-align: left;
    background: #10243a;
    color: var(--prototype-text);
    border-color: var(--prototype-border);
  }
  li button[aria-pressed="true"] {
    border-color: var(--prototype-accent);
    background: #173d51;
  }
  li span {
    color: var(--prototype-muted);
    font-weight: 400;
  }
  .detail {
    margin-block: 1rem;
    padding: 1rem;
    border: 1px solid var(--prototype-border);
    border-radius: 0.6rem;
    background: #0b1b2c;
  }
  .locked-reason {
    color: #ffd2a3;
  }
  @media (max-width: 48rem) {
    .map-layout {
      grid-template-columns: 1fr;
    }
    .map-art {
      max-height: 48svh;
    }
    .map-sidebar {
      display: grid;
      grid-template-columns: 1fr;
    }
  }
</style>
