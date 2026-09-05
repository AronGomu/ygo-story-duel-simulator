<script lang="ts">
  import { onDestroy } from "svelte";
  import OverlayScrollbar from "./OverlayScrollbar.svelte";
  import type {
    CardPreviewImageSource,
    CardPreviewView,
  } from "./card-preview-view.ts";

  type CardImageLease = ReturnType<CardPreviewImageSource["lease"]>;

  export let preview: CardPreviewView | null = null;
  export let imageLibrary: CardPreviewImageSource | null = null;
  export let placeholderUrl = "";
  /** Art the caller already resolved to a URL, for a domain that has no image
      library to lease from. The lease wins when both are present. */
  export let staticImageUrl: string | null = null;

  let activeImageLibrary: CardPreviewImageSource | null = null;
  let activeImageCode: number | undefined;
  let imageLease: CardImageLease | null = null;
  let leasedImageUrl: string | null = null;
  let failedImageUrl: string | null = null;
  let textScroller: HTMLElement | null = null;

  $: synchronizeImageLease(imageLibrary, preview?.code);
  $: resolvedImageUrl =
    leasedImageUrl !== null && leasedImageUrl !== placeholderUrl
      ? leasedImageUrl
      : staticImageUrl !== placeholderUrl
        ? staticImageUrl
        : null;
  $: if (failedImageUrl !== null && failedImageUrl !== resolvedImageUrl)
    failedImageUrl = null;

  onDestroy(() => imageLease?.release());

  /* Copied from the retired card inspector: one lease at a time, released the
     moment the previewed code or the library changes and again on destroy, so
     the object URL never outlives the image that is actually mounted. */
  function synchronizeImageLease(
    library: CardPreviewImageSource | null,
    code: number | undefined,
  ): void {
    if (library === activeImageLibrary && code === activeImageCode) return;
    imageLease?.release();
    activeImageLibrary = library;
    activeImageCode = code;
    imageLease =
      library !== null && code !== undefined && code > 0
        ? library.lease(code)
        : null;
    leasedImageUrl = imageLease?.url ?? null;
  }

  function markImageFailed(event: Event): void {
    const failedUrl = (event.currentTarget as HTMLImageElement).dataset
      .previewImageUrl;
    if (failedUrl === resolvedImageUrl) failedImageUrl = failedUrl;
  }

  function scrollTextByKeyboard(event: KeyboardEvent): void {
    const scroller = event.currentTarget as HTMLElement;
    if (event.key === "Home") scroller.scrollTop = 0;
    else if (event.key === "End") scroller.scrollTop = scroller.scrollHeight;
    else if (event.key === "PageUp")
      scroller.scrollTop -= scroller.clientHeight;
    else if (event.key === "PageDown")
      scroller.scrollTop += scroller.clientHeight;
    else return;
    event.preventDefault();
  }
</script>

<aside
  class="card-preview-panel"
  aria-label="Card preview"
  data-cy="card-preview-panel"
>
  {#if preview === null}
    <p data-cy="card-preview-empty">Hover a card to see its details.</p>
  {:else}
    <div class="card-preview-panel__art" data-cy="card-preview-art">
      {#if resolvedImageUrl !== null && resolvedImageUrl !== failedImageUrl}
        {#key resolvedImageUrl}
          <img
            src={resolvedImageUrl}
            alt={preview.name}
            decoding="async"
            onerror={markImageFailed}
            data-preview-image-url={resolvedImageUrl}
            data-cy="card-preview-image"
          />
        {/key}
      {:else}
        <div
          class="card-preview-image-placeholder"
          role="img"
          aria-label={`Card image unavailable for ${preview.name}`}
          data-cy="card-preview-image-placeholder"
        >
          {#if placeholderUrl}
            <img
              class="card-preview-placeholder-image"
              src={placeholderUrl}
              alt=""
              aria-hidden="true"
              data-cy="card-preview-placeholder-image"
            />
          {:else}
            <span
              class="card-preview-placeholder-mark"
              aria-hidden="true"
              data-cy="card-preview-placeholder-mark">✦</span
            >
            <span
              class="card-preview-placeholder-label"
              aria-hidden="true"
              data-cy="card-preview-placeholder-label">Image unavailable</span
            >
          {/if}
        </div>
      {/if}
    </div>
    <div class="card-preview-panel__body" data-cy="card-preview-body">
      <h2 data-cy="card-preview-name">{preview.name}</h2>
      {#if preview.statsLine}<p
          class="card-preview-panel__stats"
          data-cy="card-preview-stats"
        >
          {preview.statsLine}
        </p>{/if}
      <div
        class="card-preview-panel__text-region"
        data-cy="card-preview-text-region"
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions (native effect-text scroller is intentionally keyboard reachable) -->
        <div
          class="card-preview-panel__text"
          tabindex="0"
          role="region"
          aria-label="Card effect text"
          onkeydown={scrollTextByKeyboard}
          bind:this={textScroller}
          data-cy="card-preview-text"
        >
          {preview.description}
        </div>
        <OverlayScrollbar
          axis="vertical"
          scrollElement={textScroller}
          contentSizeKey={`${preview.code}:${preview.description.length}`}
          dataCyPrefix="card-preview-text"
        />
      </div>
    </div>
  {/if}
</aside>

<style>
  .card-preview-image-placeholder {
    position: relative;
    display: grid;
    width: 100%;
    max-height: min(22rem, calc(var(--stage-h, 100svh) * 0.48));
    aspect-ratio: 59 / 86;
    overflow: hidden;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--border));
    border-radius: 0.5rem;
    background:
      linear-gradient(
        145deg,
        color-mix(in srgb, var(--accent) 18%, transparent),
        transparent 48%
      ),
      var(--surface-panel);
    color: var(--muted);
    isolation: isolate;
  }

  .card-preview-image-placeholder::before,
  .card-preview-image-placeholder::after {
    position: absolute;
    z-index: 0;
    width: 72%;
    aspect-ratio: 1;
    transform: rotate(45deg);
    border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
    content: "";
  }

  .card-preview-image-placeholder::after {
    width: 48%;
  }

  .card-preview-placeholder-image {
    position: relative;
    z-index: 1;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .card-preview-placeholder-mark,
  .card-preview-placeholder-label {
    z-index: 1;
    grid-area: 1 / 1;
  }

  .card-preview-placeholder-mark {
    color: var(--accent);
    font-size: clamp(2rem, 8vw, 4rem);
    transform: translateY(-0.75rem);
  }

  .card-preview-placeholder-label {
    align-self: end;
    padding: 0 0.75rem 1rem;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
</style>
