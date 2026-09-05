<script lang="ts">
  import type { PlayerIndex } from "../../../duel/contracts/public-duel-state.ts";
  import type {
    BoardCardView,
    BoardTargetId,
    BoardZoneView,
  } from "../../../field/board-view-model.ts";
  import type { FieldPlacement } from "../../../field/duel-field-geometry.ts";
  import type { CardImageLibrary } from "../../images/card-image-cache.ts";
  import type {
    ActiveInteractionSpec,
    InteractionChoice,
  } from "../../prompts/interaction-spec.ts";
  import type { CardDragOrigin } from "../../presentation/drag-ghost-physics.ts";
  import { OverlayScrollbar } from "../../../../shell/index.ts";
  import CardControl from "./CardControl.svelte";

  export let player: PlayerIndex;
  export let cards: readonly BoardCardView[];
  export let zone: BoardZoneView;
  export let placement: FieldPlacement;
  export let cardHeight: number;
  export let imageLibrary: Pick<CardImageLibrary, "lease"> | null = null;
  export let cardBackUrl: string;
  export let placeholderUrl: string;
  export let spec: ActiveInteractionSpec | null = null;
  export let selectedTargets: ReadonlySet<BoardTargetId> = new Set();
  export let activeTarget: BoardTargetId | null = null;
  export let disabled = false;
  export let pinnedTarget: BoardTargetId | null = null;
  export let zoomServedTarget: BoardTargetId | null = null;
  export let draggedTarget: BoardTargetId | null = null;
  export let oncardactivate: (
    card: BoardCardView,
    element: HTMLButtonElement,
    source: "pointer" | "keyboard",
  ) => void = () => undefined;
  export let oncardchoose: (choice: InteractionChoice) => void = () =>
    undefined;
  export let oncarddismiss: () => void = () => undefined;
  export let oncarddragstart: (
    card: BoardCardView,
    origin: CardDragOrigin,
  ) => void = () => undefined;
  export let oncarddragmove: (x: number, y: number) => void = () => undefined;
  export let oncarddragend: (x: number, y: number) => void = () => undefined;
  export let oncardpreview: (card: BoardCardView) => void = () => undefined;
  export let oncardzoomenter: (
    card: BoardCardView,
    element: HTMLElement,
  ) => void = () => undefined;
  export let oncardzoomleave: (related: EventTarget | null) => void = () =>
    undefined;

  const mirrored = player === 1;
  let viewportElement: HTMLDivElement | null = null;
  const HAND_FAN_DEG = 6;
  /* Droop of the outermost card as a fraction of the card height. A droop
     linear in the offset tracks the tilt and reads as a slanted row; squaring
     the offset bends the hand into an arc with the centre card at its top. */
  const HAND_ARC_FACTOR = 0.12;

  function fanDegFor(index: number, count: number): number {
    const offset = index - (count - 1) / 2;
    return HAND_FAN_DEG * (offset / Math.max(1, (count - 1) / 2));
  }

  function droopPxFor(index: number, count: number): number {
    const half = Math.max(1, (count - 1) / 2);
    const offset = (index - (count - 1) / 2) / half;
    return offset * offset * HAND_ARC_FACTOR * cardHeight;
  }

  /* `sequence` addresses the engine, `displayOrder` addresses the eye: your
     own hand keeps arrival order across an engine shuffle and a searched card
     lands rightmost (ADR-047). The opponent's cards carry no display order,
     so their band stays on the engine's own order. */
  $: sortedCards = [...cards].sort(
    (left, right) =>
      (left.displayOrder ?? left.sequence) -
      (right.displayOrder ?? right.sequence),
  );
  $: contentSizeKey = `${placement.width}:${sortedCards.map((card) => card.id).join(",")}`;

  /* Only the pre-lease fallback: `CardControl` swaps in the leased art as
     soon as the library resolves the code. */
  function cardImageUrl(card: BoardCardView): string {
    return card.image.kind === "back" ? cardBackUrl : placeholderUrl;
  }
</script>

<div
  class="duel-field-hand-band"
  class:is-opponent={mirrored}
  style={`--field-x: ${placement.x}px; --field-y: ${placement.y}px; --field-width: ${placement.width}px; --field-height: ${placement.height}px; --hand-card-height: ${cardHeight}px;`}
  role="group"
  aria-label={zone.accessibleLabel}
  data-feedback-zone-id={zone.id}
  data-cy={`field-hand-band-p${player}`}
  data-player={player}
>
  <div
    class="duel-field-hand-band__viewport"
    tabindex="-1"
    bind:this={viewportElement}
    data-cy={`field-hand-p${player}-viewport`}
  >
    {#each sortedCards as card, index (card.id)}
      <CardControl
        {card}
        layout="hand"
        imageUrl={cardImageUrl(card)}
        {imageLibrary}
        interactionKind={!disabled &&
        spec?.cardChoices.has(card.targetId) === true
          ? spec.kind
          : null}
        actionable={!disabled && spec?.cardChoices.has(card.targetId) === true}
        selected={selectedTargets.has(card.targetId)}
        active={activeTarget === card.targetId}
        {disabled}
        choices={spec?.cardChoices.get(card.targetId) ?? []}
        pinned={pinnedTarget === card.targetId}
        zoomServed={zoomServedTarget === card.targetId}
        dragged={draggedTarget === card.targetId}
        fanDeg={mirrored
          ? -fanDegFor(index, sortedCards.length)
          : fanDegFor(index, sortedCards.length)}
        droopPx={droopPxFor(index, sortedCards.length)}
        draggable={!disabled &&
          spec?.kind === "cardAction" &&
          spec.cardChoices.has(card.targetId) &&
          card.zoneId === zone.id}
        onactivate={(element, source) => oncardactivate(card, element, source)}
        onchoose={oncardchoose}
        ondismiss={oncarddismiss}
        ondragstart={(origin) => oncarddragstart(card, origin)}
        ondragmove={oncarddragmove}
        ondragend={oncarddragend}
        onpreview={() => oncardpreview(card)}
        onzoomenter={(element) => oncardzoomenter(card, element)}
        onzoomleave={oncardzoomleave}
      />
    {/each}
  </div>
  <OverlayScrollbar
    axis="horizontal"
    scrollElement={viewportElement}
    {contentSizeKey}
    dataCyPrefix={`field-hand-p${player}`}
  />
</div>
