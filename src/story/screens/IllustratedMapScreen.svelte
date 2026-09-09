<script lang="ts">
  import { onMount, tick } from "svelte";
  import mapAsset from "../../../assets/story/city-map-placeholder.svg";
  import type { LocationId, StoryLocationState } from "../model/story-state.ts";

  type SelectionOwner = "hover" | "focus" | "tap";
  type PopoverPosition = { readonly left: number; readonly top: number };

  const MAP_SOURCE_WIDTH = 1200;
  const MAP_SOURCE_HEIGHT = 700;
  const POPOVER_INSET = 0;
  const POPOVER_GAP = 8;

  export let locations: readonly StoryLocationState[] = [];
  export let returnLabel = "Dialog";
  export let onselect: (id: LocationId) => void = () => undefined;
  export let onreturn: () => void = () => undefined;

  const details: Record<
    LocationId,
    {
      readonly name: string;
      readonly marker: string;
      readonly summary: string;
      readonly lockedReason?: string;
      readonly sourceX: number;
      readonly sourceY: number;
    }
  > = {
    "old-arena": {
      name: "Old Arena",
      marker: "battle",
      summary: "A dormant transmitter is staging an unanswered duel.",
      sourceX: 340,
      sourceY: 370,
    },
    archive: {
      name: "Archive",
      marker: "story",
      summary: "Signal records from the first city tournament.",
      lockedReason: "Requires decoded arena signal.",
      sourceX: 875,
      sourceY: 255,
    },
    "hidden-gate": {
      name: "Hidden Gate",
      marker: "story",
      summary: "Reviewer-only hidden location.",
      sourceX: 624,
      sourceY: 175,
    },
    "card-shop": {
      name: "Card Shop",
      marker: "shop",
      summary: "Packs, singles, and a keeper who knows every reprint.",
      sourceX: 744,
      sourceY: 504,
    },
  };

  let selectedId: LocationId | null = null;
  let selectionOwner: SelectionOwner | null = null;
  let lastPointerType: string | null = null;
  let mapArtElement: HTMLElement | null = null;
  let popoverElement: HTMLElement | null = null;
  let popoverPosition: PopoverPosition | null = null;
  let layoutObserver: ResizeObserver | null = null;
  let observedPopoverElement: HTMLElement | null = null;
  $: visibleLocations = locations.filter(({ access }) => access !== "hidden");
  $: selectedLocation =
    selectedId === null
      ? null
      : (visibleLocations.find(({ id }) => id === selectedId) ?? null);
  $: if (selectedId !== null && selectedLocation === null) closeSelection();

  onMount(() => {
    const reposition = () => void positionPopover(selectedId);
    layoutObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reposition);
    if (mapArtElement !== null) layoutObserver?.observe(mapArtElement);
    window.addEventListener("resize", reposition);
    return () => {
      layoutObserver?.disconnect();
      layoutObserver = null;
      observedPopoverElement = null;
      window.removeEventListener("resize", reposition);
    };
  });

  function label(location: StoryLocationState): string {
    const detail = details[location.id];
    return `${detail.name}, ${detail.marker} marker, ${location.access}${location.completed ? ", completed" : ", not completed"}`;
  }

  function popoverId(id: LocationId): string {
    return `story-map-popover-content-${id}`;
  }

  function sourcePercent(coordinate: number, sourceSize: number): string {
    return `${(coordinate / sourceSize) * 100}%`;
  }

  function select(location: StoryLocationState, owner: SelectionOwner): void {
    if (selectedId !== location.id) popoverPosition = null;
    selectedId = location.id;
    selectionOwner = owner;
    void positionPopover(location.id);
  }

  function closeSelection(): void {
    selectedId = null;
    selectionOwner = null;
    lastPointerType = null;
    popoverPosition = null;
    if (observedPopoverElement !== null)
      layoutObserver?.unobserve(observedPopoverElement);
    observedPopoverElement = null;
  }

  async function positionPopover(id: LocationId | null): Promise<void> {
    if (id === null) return;
    await tick();
    if (selectedId !== id || mapArtElement === null || popoverElement === null)
      return;

    const target = mapArtElement.querySelector<HTMLElement>(
      `[data-location-id="${id}"]`,
    );
    if (target === null) return;
    if (observedPopoverElement !== popoverElement) {
      if (observedPopoverElement !== null)
        layoutObserver?.unobserve(observedPopoverElement);
      layoutObserver?.observe(popoverElement);
      observedPopoverElement = popoverElement;
    }

    const artRect = mapArtElement.getBoundingClientRect();
    const originX = artRect.left + mapArtElement.clientLeft;
    const originY = artRect.top + mapArtElement.clientTop;
    const popoverWidth = popoverElement.offsetWidth;
    const popoverHeight = popoverElement.offsetHeight;
    const maxLeft = Math.max(
      POPOVER_INSET,
      mapArtElement.clientWidth - popoverWidth - POPOVER_INSET,
    );
    const maxTop = Math.max(
      POPOVER_INSET,
      mapArtElement.clientHeight - popoverHeight - POPOVER_INSET,
    );
    const toLocalRect = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - originX,
        right: rect.right - originX,
        top: rect.top - originY,
        bottom: rect.bottom - originY,
      };
    };
    const targetRect = toLocalRect(target);
    const returnControl = mapArtElement
      .closest(".map-screen")
      ?.querySelector<HTMLElement>('[data-cy="story-map-return"]');
    const obstacles = [
      ...mapArtElement.querySelectorAll<HTMLElement>(".hotspot"),
      ...(returnControl === undefined || returnControl === null
        ? []
        : [returnControl]),
    ].map(toLocalRect);
    const clampLeft = (left: number) =>
      Math.min(maxLeft, Math.max(POPOVER_INSET, left));
    const clampTop = (top: number) =>
      Math.min(maxTop, Math.max(POPOVER_INSET, top));
    const targetCenterX = (targetRect.left + targetRect.right) / 2;
    const targetCenterY = (targetRect.top + targetRect.bottom) / 2;
    const xOptions = [
      targetRect.right + POPOVER_GAP,
      targetRect.left - popoverWidth - POPOVER_GAP,
      targetCenterX - popoverWidth / 2,
      POPOVER_INSET,
      maxLeft,
    ];
    const yOptions = [
      targetCenterY - popoverHeight / 2,
      targetRect.top - popoverHeight - POPOVER_GAP,
      targetRect.bottom + POPOVER_GAP,
      POPOVER_INSET,
      maxTop,
    ];
    for (const obstacle of obstacles) {
      xOptions.push(
        obstacle.left - popoverWidth - POPOVER_GAP,
        obstacle.left - popoverWidth,
        obstacle.right,
        obstacle.right + POPOVER_GAP,
      );
      yOptions.push(
        obstacle.top - popoverHeight - POPOVER_GAP,
        obstacle.bottom + POPOVER_GAP,
      );
    }

    const candidates: PopoverPosition[] = [];
    for (const left of xOptions)
      for (const top of yOptions)
        candidates.push({ left: clampLeft(left), top: clampTop(top) });
    const ranked = candidates.sort((first, second) => {
      const distance = (candidate: PopoverPosition) =>
        Math.hypot(
          candidate.left + popoverWidth / 2 - targetCenterX,
          candidate.top + popoverHeight / 2 - targetCenterY,
        );
      return distance(first) - distance(second);
    });
    const overlaps = (
      candidate: PopoverPosition,
      obstacle: (typeof obstacles)[number],
    ) =>
      candidate.left < obstacle.right &&
      candidate.left + popoverWidth > obstacle.left &&
      candidate.top < obstacle.bottom &&
      candidate.top + popoverHeight > obstacle.top;
    popoverPosition = ranked.find((candidate) =>
      obstacles.every((obstacle) => !overlaps(candidate, obstacle)),
    ) ??
      ranked[0] ?? { left: POPOVER_INSET, top: POPOVER_INSET };
  }

  function handlePointerEnter(
    event: PointerEvent,
    location: StoryLocationState,
  ): void {
    if (event.pointerType !== "touch") select(location, "hover");
  }

  function handlePointerLeave(location: StoryLocationState): void {
    if (selectionOwner === "hover" && selectedId === location.id)
      closeSelection();
  }

  function handlePointerDown(event: PointerEvent): void {
    lastPointerType = event.pointerType;
  }

  function handlePointerCancel(
    event: PointerEvent,
    location: StoryLocationState,
  ): void {
    lastPointerType = null;
    if (document.activeElement === event.currentTarget)
      select(location, "focus");
  }

  function handleFocus(location: StoryLocationState): void {
    if (lastPointerType !== "touch") select(location, "focus");
  }

  function handleBlur(location: StoryLocationState): void {
    if (selectionOwner === "focus" && selectedId === location.id)
      closeSelection();
  }

  function handleClick(event: MouseEvent, location: StoryLocationState): void {
    const pointerType =
      "pointerType" in event && typeof event.pointerType === "string"
        ? event.pointerType
        : lastPointerType;
    if (pointerType === "touch") {
      if (
        selectedId === location.id &&
        selectionOwner === "tap" &&
        location.access === "available"
      )
        onselect(location.id);
      else select(location, "tap");
    } else if (location.access === "available") onselect(location.id);
    else if (selectedId !== location.id)
      select(location, selectionOwner ?? "focus");
    lastPointerType = null;
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (selectionOwner !== "tap" || !(event.target instanceof Element)) return;
    if (event.target.closest(".hotspot, .map-popover") === null)
      closeSelection();
  }

  function handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") closeSelection();
  }
</script>

<svelte:document
  onclick={handleDocumentClick}
  onkeydown={handleDocumentKeydown}
/>

<section
  class="map-screen"
  aria-label="City signal map"
  data-cy="story-map-screen"
>
  <div class="map-art" data-cy="story-map-art" bind:this={mapArtElement}>
    <img
      class="map-backdrop"
      src={mapAsset}
      alt=""
      aria-hidden="true"
      data-cy="story-map-backdrop"
    />
    <div class="map-canvas" data-cy="story-map-canvas">
      <img
        src={mapAsset}
        alt="Illustrated city map of the river district"
        data-cy="story-map-image"
      />
      <div
        class="hotspots"
        aria-label="Map hotspots"
        data-cy="story-map-hotspots"
      >
        {#each visibleLocations as location (location.id)}
          <button
            type="button"
            class:locked={location.access === "locked"}
            class:completed={location.completed}
            class:selected={selectedId === location.id}
            class="hotspot"
            style:left={sourcePercent(
              details[location.id].sourceX,
              MAP_SOURCE_WIDTH,
            )}
            style:top={sourcePercent(
              details[location.id].sourceY,
              MAP_SOURCE_HEIGHT,
            )}
            data-location-id={location.id}
            data-cy={`story-map-hotspot-${location.id}`}
            aria-label={label(location)}
            aria-disabled={location.access !== "available"}
            aria-pressed={selectedId === location.id}
            aria-describedby={selectedId === location.id
              ? popoverId(location.id)
              : undefined}
            onpointerenter={(event) => handlePointerEnter(event, location)}
            onpointerleave={() => handlePointerLeave(location)}
            onpointerdown={handlePointerDown}
            onpointercancel={(event) => handlePointerCancel(event, location)}
            onfocus={() => handleFocus(location)}
            onblur={() => handleBlur(location)}
            onclick={(event) => handleClick(event, location)}
          >
            <span
              class="hotspot-marker"
              aria-hidden="true"
              data-cy={`story-map-hotspot-marker-${location.id}`}
            ></span>
          </button>
        {/each}
      </div>
    </div>
    {#if selectedLocation}
      <section
        id={popoverId(selectedLocation.id)}
        class="map-popover"
        role="tooltip"
        style:left={`${popoverPosition?.left ?? POPOVER_INSET}px`}
        style:top={`${popoverPosition?.top ?? POPOVER_INSET}px`}
        data-cy={`story-map-popover-${selectedLocation.id}`}
        bind:this={popoverElement}
      >
        <h2 data-cy={`story-map-popover-name-${selectedLocation.id}`}>
          {details[selectedLocation.id].name}
        </h2>
        <p
          class="popover-meta"
          data-cy={`story-map-popover-meta-${selectedLocation.id}`}
        >
          {details[selectedLocation.id].marker} · {selectedLocation.access}{selectedLocation.completed
            ? " · completed"
            : ""}
        </p>
        <p data-cy={`story-map-popover-summary-${selectedLocation.id}`}>
          {details[selectedLocation.id].summary}
        </p>
        {#if selectedLocation.access === "locked"}
          <p
            class="locked-reason"
            data-cy={`story-map-popover-locked-reason-${selectedLocation.id}`}
          >
            Locked: {details[selectedLocation.id].lockedReason ??
              "Unavailable in this story state."}
          </p>
        {/if}
      </section>
    {/if}
  </div>
  <button
    type="button"
    class="story-danger map-return"
    data-cy="story-map-return"
    onclick={onreturn}>Return to {returnLabel}</button
  >
</section>

<style>
  .map-screen {
    display: flex;
    flex-direction: column;
    gap: clamp(0.45rem, 1.25cqh, 0.8rem);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: clamp(0.5rem, 1.6cqw, 1rem);
    background: var(--bg);
  }

  .map-art {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--gold-line);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 0.5rem 1.5rem
      color-mix(in srgb, var(--shadow) 45%, transparent);
    container-name: story-map;
    container-type: size;
  }

  .map-backdrop {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.62;
    filter: saturate(0.65) brightness(0.7);
  }

  .map-canvas {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 1;
    width: max(100%, calc(100cqh * 12 / 7));
    aspect-ratio: 12 / 7;
    transform: translate(-50%, -50%);
  }

  .map-canvas > img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hotspots {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .hotspot {
    position: absolute;
    display: grid;
    place-items: center;
    width: clamp(44px, 5cqw, 56px);
    min-height: clamp(44px, 5cqw, 56px);
    padding: 0;
    border: 1px solid var(--accent);
    border-radius: 50%;
    background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
    color: var(--accent);
    transform: translate(-50%, -50%);
    box-shadow:
      0 0.45rem 1rem color-mix(in srgb, var(--shadow) 55%, transparent),
      0 0 0 0.35rem color-mix(in srgb, var(--accent) 18%, transparent);
    backdrop-filter: blur(8px);
  }

  .hotspot:hover,
  .hotspot.selected {
    background: var(--accent);
    color: var(--ink-on-accent);
  }

  .hotspot.locked {
    border-color: var(--muted);
    background: color-mix(in srgb, var(--surface-raised) 90%, transparent);
    color: var(--muted);
    box-shadow: 0 0.45rem 1rem
      color-mix(in srgb, var(--shadow) 55%, transparent);
  }

  .hotspot.locked.selected {
    border-color: var(--selected);
    color: var(--selected);
  }

  .hotspot.completed {
    box-shadow:
      inset 0 0 0 3px var(--legal),
      0 0.45rem 1rem color-mix(in srgb, var(--shadow) 55%, transparent);
  }

  .hotspot-marker {
    width: 0.72rem;
    height: 0.72rem;
    border: 2px solid currentColor;
    transform: rotate(45deg);
  }

  .map-popover {
    position: absolute;
    z-index: 3;
    width: min(14rem, calc(100% - 1rem));
    padding: clamp(0.6rem, 1.4cqw, 0.85rem);
    border: 1px solid var(--gold-line);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
    color: var(--text);
    box-shadow: 0 0.65rem 1.8rem
      color-mix(in srgb, var(--shadow) 62%, transparent);
    pointer-events: none;
    backdrop-filter: blur(12px);
    animation: map-popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes map-popover-in {
    from {
      opacity: 0.2;
      filter: blur(3px);
    }
  }

  .map-popover h2 {
    margin: 0 0 0.2rem;
    color: var(--accent);
    font: 400 clamp(1rem, 2.2cqw, 1.3rem)/1.1 var(--font-display);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .map-popover p {
    margin: 0.45rem 0 0;
    font-size: clamp(0.78rem, 1.7cqw, 0.95rem);
    line-height: 1.3;
  }

  .map-popover .popover-meta {
    margin-top: 0;
    color: var(--muted);
    font-size: clamp(0.72rem, 1.5cqw, 0.84rem);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .map-popover .locked-reason {
    color: var(--selected);
    font-weight: 650;
  }

  .map-return {
    flex: 0 0 auto;
    align-self: flex-start;
    min-height: 44px;
  }

  @container story-map (max-aspect-ratio: 1 / 1) {
    .map-canvas {
      width: min(100%, calc(100cqh * 12 / 7));
      outline: 1px solid var(--line-soft);
      box-shadow: 0 0.5rem 1.4rem
        color-mix(in srgb, var(--shadow) 48%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .map-popover {
      animation: none;
    }
  }
</style>
