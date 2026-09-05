<script lang="ts">
  import type { DuelPresentationEvent } from "../../../duel/contracts/duel-presentation-event.ts";
  import type { PromptMessageSegment } from "../../presentation/prompt-context-message.ts";
  import type { PlayerPrompt } from "../../../duel/contracts/player-prompt.ts";
  import type { CardImageLibrary } from "../../images/card-image-cache.ts";
  import type {
    BoardCardView,
    BoardStackView,
    BoardViewModel,
  } from "../../../field/board-view-model.ts";
  import type { PhysicalZoneId } from "../../../field/duel-field-layout.ts";
  import type { ZoneListEntry } from "../../../field/zone-list.ts";
  import type { OffFieldTargetEntry } from "../../../field/off-field-target-list.ts";
  import type {
    InteractionSession,
    InteractionSessionAction,
  } from "../../prompts/interaction-session.ts";
  import type { ActiveInteractionSpec } from "../../prompts/interaction-spec.ts";
  import type { PersistedWindowPosition } from "../../stores/persisted-ui-state.ts";
  import DuelField from "../DuelField.svelte";

  export let board: BoardViewModel;
  export let layoutBoundaryElement: HTMLElement | null = null;
  export let imageLibrary: Pick<CardImageLibrary, "lease"> | null = null;
  export let cardBackUrl: string;
  export let placeholderUrl: string;
  export let prompt: PlayerPrompt | null;
  export let spec: ActiveInteractionSpec | null;
  export let session: InteractionSession;
  export let pending: boolean;
  export let presentationEvents: readonly {
    readonly sequence: number;
    readonly event: DuelPresentationEvent;
  }[] = [];
  export let feedbackGeneration = "component";
  export let injectFailure = false;
  export let oninteraction: (action: InteractionSessionAction) => unknown;
  /* `hitTest` is deliberately not forwarded: the component default
     (`document.elementFromPoint`) is the correct one in the app. */
  export let onplacementintent: (zoneId: PhysicalZoneId) => unknown = () =>
    false;
  export let onpreview: (card: BoardCardView) => void = () => undefined;
  export let onstackpreview: (stack: BoardStackView) => void = () => undefined;
  export let zoneLists: ReadonlyMap<PhysicalZoneId, readonly ZoneListEntry[]> =
    new Map();
  export let offFieldTargets: readonly OffFieldTargetEntry[] = [];
  export let onzonelistpreview: (entry: ZoneListEntry) => void = () =>
    undefined;
  export let zoneListWindowPosition: PersistedWindowPosition | null = null;
  export let confirmWindowPosition: PersistedWindowPosition | null = null;
  export let showZoneOutlines = true;
  export let showZoneCounts = true;
  export let showCardShadows = true;
  export let showZoneLabels = true;
  export let onzoneListWindowPositionChange: (
    position: PersistedWindowPosition,
  ) => void = () => undefined;
  export let onconfirmWindowPositionChange: (
    position: PersistedWindowPosition,
  ) => void = () => undefined;
  export let fullControl = false;
  export let fullControlHeld = false;
  export let onfullcontrolchange: (value: boolean) => void = () => undefined;
  export let endTurnArmed = false;
  export let onendturnstart: () => void = () => undefined;
  export let contextMessage: readonly PromptMessageSegment[] = [];

  let shouldFail: boolean = injectFailure;

  function retry(reset: () => void): void {
    shouldFail = false;
    reset();
  }

  function sanitizedFailureMessage(error: unknown): string {
    void error;
    return "Prompt controls remain available. No private engine detail was shown.";
  }
</script>

{#snippet failed(error: unknown, reset: () => void)}
  <section
    class="field-error"
    role="alert"
    aria-labelledby="field-error-heading"
    data-cy="duel-field-error-boundary-panel"
  >
    <div data-cy="duel-field-error-boundary-body">
      <p class="eyebrow" data-cy="duel-field-error-boundary-eyebrow">
        Duel field unavailable
      </p>
      <h2 id="field-error-heading" data-cy="duel-field-error-boundary-heading">
        Interactive field could not render
      </h2>
      <p data-cy="duel-field-error-boundary-message">
        {sanitizedFailureMessage(error)}
      </p>
    </div>
    <button
      type="button"
      class="secondary"
      onclick={() => retry(reset)}
      data-cy="duel-field-error-boundary-retry-button">Retry duel field</button
    >
  </section>
{/snippet}

<svelte:boundary {failed}>
  <DuelField
    {board}
    {layoutBoundaryElement}
    {imageLibrary}
    {cardBackUrl}
    {placeholderUrl}
    {prompt}
    {spec}
    {session}
    {pending}
    {presentationEvents}
    {feedbackGeneration}
    injectFailure={shouldFail}
    {oninteraction}
    {onplacementintent}
    {onpreview}
    {onstackpreview}
    {zoneLists}
    {offFieldTargets}
    {onzonelistpreview}
    {zoneListWindowPosition}
    {confirmWindowPosition}
    {showZoneOutlines}
    {showZoneCounts}
    {showCardShadows}
    {showZoneLabels}
    {onzoneListWindowPositionChange}
    {onconfirmWindowPositionChange}
    {fullControl}
    {fullControlHeld}
    {onfullcontrolchange}
    {endTurnArmed}
    {onendturnstart}
    {contextMessage}
  />
</svelte:boundary>
