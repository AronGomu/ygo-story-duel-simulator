<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";
  import type { PromptMessageSegment } from "../presentation/prompt-context-message.ts";
  import type { PlayerPrompt } from "../../duel/contracts/player-prompt.ts";
  import type { CardImageLibrary } from "../images/card-image-cache.ts";
  import type {
    BoardCardView,
    BoardStackView,
    BoardTargetId,
    BoardViewModel,
    BoardZoneView,
  } from "../../field/board-view-model.ts";
  import {
    createInactiveInteractionSession,
    interactionSessionChoiceIds,
    type InteractionSession,
    type InteractionSessionAction,
    type UnkeyedInteractionSessionAction,
  } from "../prompts/interaction-session.ts";
  import {
    endPhaseChoice,
    fieldActionBarRequired,
    isImmediateSingleSelection,
    type ActiveInteractionSpec,
    type InteractionChoice,
  } from "../prompts/interaction-spec.ts";
  import type { ZoneListEntry } from "../../field/zone-list.ts";
  import { materialListEntries } from "../../field/material-list.ts";
  import type { OffFieldTargetEntry } from "../../field/off-field-target-list.ts";
  import ZoneListDialog from "./duel-field/ZoneListDialog.svelte";
  import { dropChoicesForZone } from "../prompts/drop-target.ts";
  import { activateChoices } from "../prompts/hand-activation-choices.ts";
  import { validatePromptSelection } from "../prompts/prompt-selection.ts";
  import { placementZoneCandidates } from "../../field/placement-candidates.ts";
  import type { PhysicalZoneId } from "../../field/duel-field-layout.ts";
  import {
    createFieldRenderLayout,
    perspectiveVirtualHeight,
    type FieldRenderLayout,
  } from "../../field/duel-field-geometry.ts";
  import {
    FIELD_CAMERA_PX,
    FIELD_TILT_DEG,
    fieldPlaneTransform,
  } from "../../field/perspective.ts";
  import {
    createDomFeedbackController,
    EMPTY_DOM_FEEDBACK_STATE,
    type DomFeedbackController,
    type DomFeedbackState,
  } from "../presentation/dom-feedback-controller.ts";
  import { formatSelectionStatus } from "../presentation/format-selection-status.ts";
  import { presentationCommandForDomEvent } from "../presentation/presentation-command.ts";
  import type { FieldWindowId } from "../presentation/floating-window-position.ts";
  import type { LocalCardAction } from "../presentation/local-card-action.ts";
  import type { PersistedWindowPosition } from "../stores/persisted-ui-state.ts";
  import {
    dragFrameForPointer,
    dragGhostSettled,
    settleDragGhostFrame,
    DRAG_SETTLE_TIMEOUT_MS,
    type CardDragOrigin,
    type DragGhostFrame,
    type DragPointerSample,
  } from "../presentation/drag-ghost-physics.ts";
  import {
    selectedHandZoomCandidates,
    trackLatestSelectedTarget,
  } from "../presentation/selected-hand-zoom.ts";
  import {
    readFrameWidth,
    readStageFrame,
    toFramePoint,
    toFrameRect,
    UNROTATED_FRAME,
    type StageFrame,
  } from "../presentation/stage-frame.ts";
  import DragGhost from "./duel-field/DragGhost.svelte";
  import DropConfirmDialog from "./duel-field/DropConfirmDialog.svelte";
  import HandZoomOverlay from "./duel-field/HandZoomOverlay.svelte";
  import MaterialSelectDialog from "./duel-field/MaterialSelectDialog.svelte";
  import FieldActionBar from "./duel-field/FieldActionBar.svelte";
  import FloatingFieldWindow from "./duel-field/FloatingFieldWindow.svelte";
  import FieldBoard from "./duel-field/FieldBoard.svelte";
  import FieldLines from "./duel-field/FieldLines.svelte";
  import EndTurnButton from "./duel-field/EndTurnButton.svelte";
  import FullControlToggle from "./duel-field/FullControlToggle.svelte";

  const noop = (): void => undefined;
  const EMPTY_TARGETS: ReadonlySet<BoardTargetId> = new Set();
  const EMPTY_ZONE_IDS: ReadonlySet<PhysicalZoneId> = new Set();
  const EMPTY_TARGET_ENTRIES: readonly OffFieldTargetEntry[] = [];
  const DEFAULT_CARD_BACK =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 104'%3E%3Crect width='72' height='104' rx='5' fill='%2314263c'/%3E%3Cpath d='M8 8h56v88H8z' fill='none' stroke='%2373daca' stroke-width='3'/%3E%3Cpath d='m12 84 48-64M12 60l32-40M28 92l32-40' stroke='%2346637f' stroke-width='4'/%3E%3C/svg%3E";
  const DEFAULT_PLACEHOLDER =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 104'%3E%3Crect width='72' height='104' rx='5' fill='%2318243b'/%3E%3Cpath d='M8 8h56v88H8z' fill='none' stroke='%23697895' stroke-width='2'/%3E%3Ctext x='36' y='57' fill='%23a9b5ca' font-size='28' text-anchor='middle'%3E?%3C/text%3E%3C/svg%3E";

  export let board: BoardViewModel;
  export let layoutBoundaryElement: HTMLElement | null = null;
  export let imageLibrary: Pick<CardImageLibrary, "lease"> | null = null;
  export let cardBackUrl = DEFAULT_CARD_BACK;
  export let placeholderUrl = DEFAULT_PLACEHOLDER;
  export let prompt: PlayerPrompt | null = null;
  export let spec: ActiveInteractionSpec | null = null;
  export let session: InteractionSession = createInactiveInteractionSession();
  export let pending = false;
  export let presentationEvents: readonly {
    readonly sequence: number;
    readonly event: DuelPresentationEvent;
  }[] = [];
  export let feedbackGeneration = "component";
  /* Built by the app from the snapshot, the batch's events and the card texts,
     because none of those three live on the field. The field only places the
     line inside the decision window. */
  export let contextMessage: readonly PromptMessageSegment[] = [];
  export let reducedMotion: boolean | null = null;
  export let injectFailure: boolean = false;
  export let oninteraction: (
    action: InteractionSessionAction,
  ) => unknown = () => false;
  /* Injectable so a component test can drive a drop without a layout engine
     (assumption A5). The default is the only thing the app ever uses. */
  export let hitTest: (x: number, y: number) => Element | null = (x, y) =>
    document.elementFromPoint(x, y);
  export let onplacementintent: (zoneId: PhysicalZoneId) => unknown = () =>
    false;
  export let onpreview: (card: BoardCardView) => void = noop;
  export let onstackpreview: (stack: BoardStackView) => void = noop;
  export let zoneLists: ReadonlyMap<PhysicalZoneId, readonly ZoneListEntry[]> =
    new Map();
  /* T16: the legal off-field targets of the live prompt, already joined against
     the sanitized projection by the App seam. The field never re-derives an
     identity from a prompt choice. */
  export let offFieldTargets: readonly OffFieldTargetEntry[] =
    EMPTY_TARGET_ENTRIES;
  export let onzonelistpreview: (entry: ZoneListEntry) => void = noop;
  export let zoneListWindowPosition: PersistedWindowPosition | null = null;
  export let confirmWindowPosition: PersistedWindowPosition | null = null;
  export let showZoneOutlines = true;
  export let showZoneCounts = true;
  export let showCardShadows = true;
  export let showZoneLabels = true;
  export let onzoneListWindowPositionChange: (
    position: PersistedWindowPosition,
  ) => void = noop;
  export let onconfirmWindowPositionChange: (
    position: PersistedWindowPosition,
  ) => void = noop;
  /* Full Control lives in the field's own corner, so the box travels with the
     board rather than with the slot around it. The stored setting and the Ctrl
     hold stay apart: clicking while Ctrl is down still writes the setting. */
  export let fullControl = false;
  export let fullControlHeld = false;
  export let onfullcontrolchange: (value: boolean) => void = noop;
  export let endTurnArmed = false;
  export let onendturnstart: () => void = noop;

  /* Exactly one list window: one browsed pile, the materials of one Xyz host,
     or the aggregate target list of one prompt. */
  type ZoneListState =
    | { readonly mode: "browse"; readonly stackId: PhysicalZoneId }
    | { readonly mode: "materials"; readonly hostId: BoardTargetId }
    | { readonly mode: "target"; readonly promptKey: string }
    | null;

  let zoneListState: ZoneListState = null;
  let targetListCollapsed = false;
  /* Ephemeral, never persisted (ADR-017): the last window the player touched
     is the one that rises. */
  let activeWindowId: FieldWindowId | null = null;
  /* Single-shot marker: the outside pointerdown that closed a list happened on
     the very pile control whose click is about to toggle it, so that click
     must leave the list closed instead of reopening it. */
  let outsideDismissedTargetId: BoardTargetId | null = null;
  /* The prompt whose target list the player closed by hand, so an unrelated
     rerender never reopens it. */
  let dismissedTargetPromptKey: string | null = null;

  if (injectFailure) throw new Error("Injected duel field component failure");

  let fieldRoot: HTMLElement;
  let renderLayout: FieldRenderLayout;
  let boardWidth = 1280;
  let boardHeight = 720;
  let planeHeight = perspectiveVirtualHeight(
    boardHeight,
    FIELD_TILT_DEG,
    FIELD_CAMERA_PX,
  );
  const planeTransform = fieldPlaneTransform();
  let resizeObserver: ResizeObserver | null = null;
  let observedLayoutBoundary: HTMLElement | null = null;
  let feedbackController: DomFeedbackController | null = null;
  let feedbackState: DomFeedbackState = EMPTY_DOM_FEEDBACK_STATE;
  let mediaReducedMotion = false;
  let effectiveReducedMotion = false;
  let observedBoard: BoardViewModel | null = null;
  let deferredPresentationEvents: typeof presentationEvents = [];
  let activeFeedbackGeneration: string | null = null;
  let lastPresentationSequence = 0;
  let appliedReducedMotion: boolean | null = null;
  let feedbackSyncSequence = 0;
  let dragCard: BoardCardView | null = null;
  let dropCandidates: ReadonlySet<PhysicalZoneId> = EMPTY_ZONE_IDS;
  /* Item 18: which candidate zone is directly under the dragged card right
     now. Computed in `moveCardDrag` (a pointermove handler, not the rAF
     ghost-animation loop) with the existing `zoneIdAtPoint` hit test — never
     a second hit-testing implementation, and never a DOM read inside
     `tickGhostFrame`. */
  let dropHoveredZoneId: PhysicalZoneId | null = null;
  let lastPromptKey: string | null = null;
  let ghostOrigin: CardDragOrigin | null = null;
  let ghostFrame: DragGhostFrame | null = null;
  let ghostPhase: "idle" | "dragging" | "settling" = "idle";
  let ghostLatestSample: DragPointerSample | null = null;
  let ghostPreviousSample: DragPointerSample | null = null;
  let ghostSettleTarget: { readonly x: number; readonly y: number } | null =
    null;
  let ghostSettleElapsedMs = 0;
  let ghostRafHandle: number | null = null;
  let ghostLastTickMs = 0;
  let ghostPromptKey: string | null = null;
  /* T15: the ghost is `position: fixed`, so a portrait phone lays it out
     against the rotated duel region instead of the viewport. Read once per
     gesture — the frame cannot turn mid-drag — so `CardControl` keeps
     reporting plain viewport coordinates and the physics module stays pure. */
  let dragStageFrame: StageFrame = UNROTATED_FRAME;
  let handZoom: {
    card: BoardCardView;
    anchor: { left: number; top: number; width: number; height: number };
    /* Captured with the anchor so the overlay clamps against the same frame
       the anchor was measured in, never against the viewport. */
    frameWidth: number;
  } | null = null;
  let handZoomBoardRef: BoardViewModel | null = null;
  /* Feedback item 1: the hand band clips on its y axis, so a selected card can
     no more grow out of it than a hovered one can — the fixed overlay is the
     only escape either has. These two carry the recency the session does not:
     `selectedChoiceIds` is rebuilt in prompt order on every toggle, so which
     pick came last is only readable by diffing one selection against the
     next. */
  let previousSelectedHandTargets: readonly BoardTargetId[] = [];
  let latestSelectedHandTarget: BoardTargetId | null = null;
  /* Item 4: the hand card whose zoom a click froze. While it is set the zoom
     ignores the pointer entirely — it neither follows another card nor closes
     on a leave — and only a chosen action, a drag, a second click on the card,
     a click outside its union or Escape clears it. */
  let pinnedHandTarget: BoardTargetId | null = null;
  /* Item 2 anchors the chip stack on the card's bottom edge, and the hand zoom
     overlay draws that stack over the lower half of the very card it serves —
     the chips being the overlay's one hit-testable surface besides the bridge.
     So the press that starts a drag lands on a chip, never on the card's own
     `.duel-field-card__target`, and `CardControl` never sees the gesture at
     all. The field runs it here instead, on the one node both the overlay and
     the card bubble to: a motionless press still clicks the chip, a moving one
     still lifts the card. */
  let handZoomDrag: {
    readonly pointerId: number;
    readonly card: BoardCardView;
    readonly article: HTMLElement;
    readonly startX: number;
    readonly startY: number;
    dragging: boolean;
  } | null = null;
  /* A forwarded drag presses inside the overlay and releases over a zone, so
     the browser has no common interactive ancestor left to fire the click on
     and hands it to the field root — dead ground as `dismissOnOutsideClick`
     reads it. Answering with that click would cancel or chain-pass the very
     decision the drop just made. Cleared by the next press on the field, so a
     release that never produced a click cannot eat a later dismissal. */
  let suppressFieldClick = false;
  /* Item 6: the drop that could not be read as one action, held until the
     player answers it. Nothing is dispatched and no placement intent is armed
     while it is set, so cancelling leaves the game exactly as the drag found
     it. */
  let dropConfirm: {
    readonly card: BoardCardView;
    readonly zone: BoardZoneView;
    readonly choices: readonly InteractionChoice[];
    /* "zone": a field-zone drop — confirm arms onplacementintent(zone.id).
       "handActivation": the dashed zone — confirm dispatches only, no intent. */
    readonly source: "zone" | "handActivation";
  } | null = null;

  $: resolvedCardBackUrl = cardBackUrl || DEFAULT_CARD_BACK;
  $: effectiveReducedMotion = reducedMotion ?? mediaReducedMotion;
  $: endTurnChoice = endPhaseChoice(spec);
  $: scheduleFeedbackSync(
    feedbackController,
    feedbackGeneration,
    presentationEvents,
    effectiveReducedMotion,
    board,
  );
  $: resolvedPlaceholderUrl = placeholderUrl || DEFAULT_PLACEHOLDER;
  $: selectedTargets = withPinnedHandTarget(
    spec === null ? EMPTY_TARGETS : targetSelections(spec, session),
    pinnedHandTarget,
  );
  $: selectedHandCard = latestSelectedHandCard(
    board,
    selectedTargets,
    handZoom,
  );
  $: selectedHandZoom = measureSelectedHandZoom(selectedHandCard);
  /* Pointer intent beats a state display: a hover or a pin serves its own card,
     and the selected one returns to the overlay as soon as that ends. */
  $: handZoomView = handZoom ?? selectedHandZoom;
  $: targetLaunchers = targetLauncherIds(spec);
  $: overlayChoices =
    spec?.kind === "cardSelection" ? [...spec.overlayChoices.values()] : [];
  $: synchronizeZoneList(spec, offFieldTargets);
  $: cancelDragGhostOnPromptChange(spec);
  $: clearHandZoomOnBoardChange(board);
  $: openStack = browsedStack(zoneListState, board);
  $: materialsHost = browsedMaterialsHost(zoneListState, board);
  $: materialEntries =
    materialsHost === null ? [] : materialListEntries(materialsHost);
  $: targetListOpen = zoneListState?.mode === "target";
  $: submittedChoiceIds =
    spec === null ? [] : interactionSessionChoiceIds(session, spec);
  $: validation =
    prompt === null || spec === null
      ? { valid: false as const, message: "No active field decision" }
      : validatePromptSelection(prompt, submittedChoiceIds);
  $: selectionStatus =
    prompt === null ? null : formatSelectionStatus(prompt, submittedChoiceIds);
  /* Derived from the projected board itself, so field geometry cannot
     disagree with the zones the mapper actually produced. */
  $: extraMonsterZones = board.zones.some(({ player }) => player === "shared");
  $: renderLayout = measuredRenderLayout(
    layoutBoundaryElement,
    extraMonsterZones,
  );
  $: observeLayoutBoundary(layoutBoundaryElement);
  $: actionBarVisible =
    prompt !== null &&
    spec !== null &&
    overlayChoices.length === 0 &&
    (spec.fieldCapable || spec.promptKind === "chain") &&
    fieldActionBarRequired(spec);
  /* Item 4: what the dashed zone beside the hand is offering. Read from the
     dragged card's own choices and nothing else — never from `dropCandidates`,
     which is occupancy-filtered, and an activation needs no free zone. */
  $: dragActivateChoices =
    dragCard === null || spec === null
      ? []
      : activateChoices(spec.cardChoices.get(dragCard.targetId) ?? []);
  onDestroy(() => {
    removeGhost();
    resizeObserver?.disconnect();
  });

  function measuredRenderLayout(
    boundary: HTMLElement | null,
    profile: boolean,
  ): FieldRenderLayout {
    const width = boundary?.clientWidth ?? 0;
    const height = boundary?.clientHeight ?? 0;
    boardWidth = width > 0 ? width : 1280;
    boardHeight = height > 0 ? height : 720;
    planeHeight = perspectiveVirtualHeight(
      boardHeight,
      FIELD_TILT_DEG,
      FIELD_CAMERA_PX,
    );
    return createFieldRenderLayout(profile, boardWidth, planeHeight);
  }

  /* The hand placement is center-addressed, so the band's left edge is where
     the zone starts. One box tall matches the hand row it sits beside; 1.5
     boxes wide makes it an easy target for a gesture that ends in a question. */
  function handActivationZoneStyle(layout: FieldRenderLayout): string {
    const placement = layout.zones.get("p0:hand");
    if (placement === undefined) return "display: none;";
    const height = placement.height;
    const width = Math.round(height * 1.5);
    const left = placement.x - placement.width / 2;
    return `--field-x: ${left}px; --field-y: ${placement.y}px; --field-width: ${width}px; --field-height: ${height}px;`;
  }

  function observeLayoutBoundary(boundary: HTMLElement | null): void {
    if (boundary === observedLayoutBoundary) return;
    resizeObserver?.disconnect();
    observedLayoutBoundary = boundary;
    if (boundary === null || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(() => {
      renderLayout = measuredRenderLayout(boundary, extraMonsterZones);
    });
    resizeObserver.observe(boundary);
  }

  onMount(() => {
    const motionQuery = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    const updateMotion = (): void => {
      mediaReducedMotion = motionQuery?.matches ?? false;
    };
    updateMotion();
    motionQuery?.addEventListener("change", updateMotion);
    /* On the document, not the field root: a pinned hand zoom outlives the
       pointer leaving the field, so the click or Escape that cancels it can
       land anywhere on the page. */
    document.addEventListener("pointerdown", cancelHandPinOnOutsidePointer);
    document.addEventListener("keydown", cancelHandPinOnEscape);
    feedbackController = createDomFeedbackController(fieldRoot, (state) => {
      feedbackState = state;
    });
    synchronizeFeedback(
      feedbackController,
      feedbackGeneration,
      presentationEvents,
      effectiveReducedMotion,
      board,
    );
    return () => {
      motionQuery?.removeEventListener("change", updateMotion);
      document.removeEventListener(
        "pointerdown",
        cancelHandPinOnOutsidePointer,
      );
      document.removeEventListener("keydown", cancelHandPinOnEscape);
      feedbackSyncSequence += 1;
      feedbackController?.cancel();
      feedbackController = null;
    };
  });

  function scheduleFeedbackSync(
    controller: DomFeedbackController | null,
    generation: string,
    events: typeof presentationEvents,
    motionReduced: boolean,
    currentBoard: BoardViewModel,
  ): void {
    const sequence = ++feedbackSyncSequence;
    void tick().then(() => {
      if (sequence !== feedbackSyncSequence) return;
      synchronizeFeedback(
        controller,
        generation,
        events,
        motionReduced,
        currentBoard,
      );
    });
  }

  function synchronizeFeedback(
    controller: DomFeedbackController | null,
    generation: string,
    events: typeof presentationEvents,
    motionReduced: boolean,
    currentBoard: BoardViewModel,
  ): void {
    if (controller === null) return;
    const boardChanged = currentBoard !== observedBoard;
    const priorBoard = observedBoard;
    observedBoard = currentBoard;
    if (generation !== activeFeedbackGeneration) {
      controller.cancel();
      activeFeedbackGeneration = generation;
      lastPresentationSequence = events.at(-1)?.sequence ?? 0;
      deferredPresentationEvents = [];
      appliedReducedMotion = motionReduced;
      return;
    } else if (motionReduced !== appliedReducedMotion) {
      controller.cancel();
      appliedReducedMotion = motionReduced;
      const latest = events.at(-1);
      if (latest !== undefined) {
        controller.present(
          presentationCommandForDomEvent(
            latest.event,
            {
              currentBoard,
              ...(priorBoard === null ? {} : { previousBoard: priorBoard }),
            },
            motionReduced,
          ),
        );
        lastPresentationSequence = latest.sequence;
      }
      return;
    }
    if (boardChanged && deferredPresentationEvents.length > 0) {
      for (const entry of deferredPresentationEvents)
        presentFeedbackEntry(
          controller,
          entry,
          motionReduced,
          currentBoard,
          priorBoard,
        );
      deferredPresentationEvents = [];
    }
    for (const entry of events) {
      if (entry.sequence <= lastPresentationSequence) continue;
      if (!boardChanged && feedbackNeedsNextBoard(entry.event)) {
        deferredPresentationEvents = [...deferredPresentationEvents, entry];
      } else {
        presentFeedbackEntry(
          controller,
          entry,
          motionReduced,
          currentBoard,
          priorBoard,
        );
      }
      lastPresentationSequence = entry.sequence;
    }
  }

  function presentFeedbackEntry(
    controller: DomFeedbackController,
    entry: (typeof presentationEvents)[number],
    motionReduced: boolean,
    currentBoard: BoardViewModel,
    priorBoard: BoardViewModel | null,
  ): void {
    controller.present(
      presentationCommandForDomEvent(
        entry.event,
        {
          currentBoard,
          ...(priorBoard === null ? {} : { previousBoard: priorBoard }),
        },
        motionReduced,
      ),
    );
  }

  function feedbackNeedsNextBoard(event: DuelPresentationEvent): boolean {
    return (
      event.type === "cardMoved" ||
      event.type === "summon" ||
      event.type === "specialSummon" ||
      event.type === "flipSummon" ||
      event.type === "set" ||
      event.type === "positionChanged"
    );
  }

  function dispatch(action: UnkeyedInteractionSessionAction): void {
    if (spec === null || pending) return;
    oninteraction({ ...action, key: spec.key } as InteractionSessionAction);
  }

  function activateCard(
    card: BoardCardView,
    element: HTMLButtonElement,
    source: "pointer" | "keyboard",
  ): void {
    if (spec === null) return;
    const choices = spec.cardChoices.get(card.targetId) ?? [];
    const choice = choices[0];
    if (choice === undefined) return;
    /* T16: an off-field card (a hand card) answers through the target list, so
       its mounted control only opens that list. */
    if (targetLaunchers.has(card.targetId)) {
      toggleTargetList();
      return;
    }
    /* Item 4: a pointer click on a hand card commits nothing at all — not the
       lone legal action, not the menu. It freezes the zoom and its action list
       where they stand, and a chip in that list (or a drag) is what answers.
       `cardAction` only: a selection prompt's hand target still toggles, since
       its answer is a draft the player confirms, not a card action. The
       keyboard keeps the in-band pin/focus flow (ADR-032 §4). */
    if (
      source === "pointer" &&
      spec.kind === "cardAction" &&
      card.zoneId === "p0:hand"
    ) {
      toggleHandPin(card, element);
      return;
    }
    switch (spec.kind) {
      case "cardAction":
        if (choices.length === 1)
          dispatch({ type: "chooseChoice", choiceId: choice.id });
        else dispatch({ type: "openMenu", target: card.targetId });
        break;
      case "cardSelection":
        if (isImmediateSingleSelection(spec))
          dispatch({ type: "chooseChoice", choiceId: choice.id });
        else dispatch({ type: "toggleChoice", choiceId: choice.id });
        break;
      case "counterAllocation":
        dispatch({ type: "adjustAllocation", choiceId: choice.id, delta: 1 });
        break;
      case "order":
        break;
      case "placeSelection":
      case "nonField":
        break;
    }
  }

  function activateZone(zone: BoardZoneView): void {
    if (spec === null) return;
    const choice = spec.zoneChoices.get(zone.targetId)?.[0];
    if (choice === undefined) return;
    if (spec.kind === "placeSelection" && isImmediateSingleSelection(spec))
      dispatch({ type: "chooseChoice", choiceId: choice.id });
    else dispatch({ type: "toggleChoice", choiceId: choice.id });
  }

  /* The hand band root, not its arrows: every control T8 put inside the band
     — page arrows, the scrolling viewport, the page-status live region —
     drives navigation only, so none of them may ever reach the outside-click
     dismissal that answers the live decision. */
  const INTERACTIVE_SELECTOR =
    "[data-field-target], .card-action-chips, .field-action-bar, .floating-field-window, .duel-field-hand-band, .drop-confirm-backdrop, .material-select-backdrop";

  function chainPassChoice(): InteractionChoice | null {
    if (spec === null || spec.promptKind !== "chain") return null;
    for (const choice of spec.globalChoices.values())
      if (choice.action === "pass") return choice;
    return null;
  }

  function dismissOnOutsideClick(event: MouseEvent): void {
    if (suppressFieldClick) {
      suppressFieldClick = false;
      return;
    }
    if (spec === null || pending) return;
    /* ADR-017: while the confirm window is up, a live decision is on screen.
       An incidental click anywhere on the field must never answer it — not
       with a cancel, not with a chain pass. The window's own Cancel/Pass
       controls stay the only way out. */
    if (actionBarVisible) return;
    /* T16: in target mode the list window owns the live decision the same way
       the confirm window does, so an incidental field click must not cancel
       it. Closing the list only hides it. */
    if (targetLaunchers.size > 0) return;
    const pass = chainPassChoice();
    if (pass !== null) {
      const origin = event.target;
      if (
        origin instanceof Element &&
        origin.closest(INTERACTIVE_SELECTOR) !== null
      )
        return;
      dispatch({ type: "chooseChoice", choiceId: pass.id });
      return;
    }
    if (!spec.constraints.cancelable) return;
    /* A `single`-family prompt rejects an empty response outright
       (`validatePromptSelection` requires exactly one choice for it, even when
       the prompt is cancelable), so cancelling one would only raise
       `invalid_response`. Chain prompts are the live example: they are
       `single` and cancelable at the same time. T11 gives them their own
       outside-click behaviour. */
    if (spec.constraints.controlFamily === "single") return;
    const origin = event.target;
    if (
      origin instanceof Element &&
      origin.closest(INTERACTIVE_SELECTOR) !== null
    )
      return;
    dispatch({ type: "cancel" });
  }

  /* The halo is a local guess at where the engine might accept this card. It
     is presentation only and never gates a response: the follow-up place
     prompt stays authoritative. The ghost is presentation only too — it
     never delays or authorizes the single placement intent + chooseChoice
     dispatch in `endCardDrag`, it only starts springing after that fires. */
  function startCardDrag(card: BoardCardView, origin: CardDragOrigin): void {
    if (spec === null || spec.kind !== "cardAction") return;
    if (card.zoneId !== "p0:hand") return;
    const candidates = new SvelteSet<PhysicalZoneId>();
    for (const choice of spec.cardChoices.get(card.targetId) ?? []) {
      for (const zoneId of placementZoneCandidates(choice.action, board))
        candidates.add(zoneId);
    }
    dragCard = card;
    dropCandidates = candidates;
    dropHoveredZoneId = null;
    clearHandPin();
    /* A new drag always wins over a settle still in flight for the previous
       card ("new drag first cancels prior settle"). */
    cancelGhostFrame();
    dragStageFrame = readStageFrame(fieldRoot);
    const framed = originInStageFrame(origin, dragStageFrame);
    ghostOrigin = framed;
    ghostPreviousSample = framed.pointer;
    ghostLatestSample = null;
    ghostSettleTarget = null;
    ghostSettleElapsedMs = 0;
    ghostPhase = "dragging";
    ghostFrame = Object.freeze({
      x: framed.pointer.x - framed.pointerOffsetX,
      y: framed.pointer.y - framed.pointerOffsetY,
      velocityX: 0,
      velocityY: 0,
      tiltDegrees: 0,
    });
  }

  const HAND_ZOOM_DRAG_THRESHOLD_PX = 8;

  function beginHandZoomDrag(event: PointerEvent): void {
    suppressFieldClick = false;
    if (handZoom === null || handZoomDrag !== null) return;
    const pressed = event.target;
    if (
      !(pressed instanceof Element) ||
      pressed.closest(".hand-zoom-overlay") === null
    )
      return;
    const article =
      fieldRoot?.querySelector<HTMLElement>(
        `[data-cy="field-card-${handZoom.card.id}"]`,
      ) ?? null;
    if (article === null) return;
    handZoomDrag = {
      pointerId: event.pointerId,
      card: handZoom.card,
      article,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    /* Captured on the pressed element rather than on the card: a press that
       never travels has to stay that chip's own click. */
    pressed.setPointerCapture?.(event.pointerId);
  }

  function moveHandZoomDrag(event: PointerEvent): void {
    const drag = handZoomDrag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    if (!drag.dragging) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <=
        HAND_ZOOM_DRAG_THRESHOLD_PX
      )
        return;
      startCardDrag(drag.card, handZoomDragOrigin(drag.article, event));
      /* The prompt may not be offering this card an action to drag at all;
         `startCardDrag` is the only judge of that. */
      if (dragCard === null) {
        handZoomDrag = null;
        return;
      }
      drag.dragging = true;
      /* Starting the drag drops the zoom, and an unmounted element loses its
         capture. The card article outlives the whole gesture, so the moves
         keep arriving once the overlay under the pointer is gone. */
      drag.article.setPointerCapture?.(event.pointerId);
    }
    moveCardDrag(event.clientX, event.clientY);
  }

  function endHandZoomDrag(event: PointerEvent): void {
    const drag = handZoomDrag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    handZoomDrag = null;
    if (!drag.dragging) return;
    suppressFieldClick = true;
    endCardDrag(event.clientX, event.clientY);
  }

  function cancelHandZoomDrag(event: PointerEvent): void {
    const drag = handZoomDrag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    handZoomDrag = null;
    if (!drag.dragging) return;
    endCardDrag(Number.NaN, Number.NaN);
  }

  /* The ghost is the card, never the overlay: home rect and art both come from
     the hand card article, so a forwarded drag springs home to the hand exactly
     as a card-started one does. */
  function handZoomDragOrigin(
    article: HTMLElement,
    event: PointerEvent,
  ): CardDragOrigin {
    const rect = article.getBoundingClientRect();
    const art = article.querySelector<HTMLImageElement>(
      '[data-cy^="card-control-image-"]',
    );
    return {
      pointer: {
        x: event.clientX,
        y: event.clientY,
        timeMs: performance.now(),
      },
      sourceLeft: rect.left,
      sourceTop: rect.top,
      width: rect.width,
      height: rect.height,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      imageUrl: art?.getAttribute("src") ?? resolvedPlaceholderUrl,
    };
  }

  /* Turns the viewport-space snapshot `CardControl` took into the coordinate
     system the ghost is actually positioned in. Unrotated this is the
     identity, which is why desktop drags keep their exact pixel behavior. */
  function originInStageFrame(
    origin: CardDragOrigin,
    frame: StageFrame,
  ): CardDragOrigin {
    if (!frame.rotated) return origin;
    const rect = toFrameRect(frame, {
      left: origin.sourceLeft,
      top: origin.sourceTop,
      width: origin.width,
      height: origin.height,
    });
    const pointer = toFramePoint(frame, origin.pointer.x, origin.pointer.y);
    return {
      ...origin,
      pointer: { x: pointer.x, y: pointer.y, timeMs: origin.pointer.timeMs },
      sourceLeft: rect.left,
      sourceTop: rect.top,
      width: rect.width,
      height: rect.height,
      pointerOffsetX: pointer.x - rect.left,
      pointerOffsetY: pointer.y - rect.top,
    };
  }

  /* Coalescing: stores the latest sample and asks for a frame only when none
     is already pending, so a burst of pointermove events never stacks up
     more than one rAF callback. */
  function moveCardDrag(x: number, y: number): void {
    if (ghostPhase !== "dragging") return;
    /* The ghost follows the pointer in the frame's coordinates; the hit test
       below keeps the raw viewport ones, because `elementFromPoint` resolves
       through the rotation itself. */
    const sample = toFramePoint(dragStageFrame, x, y);
    ghostLatestSample = { x: sample.x, y: sample.y, timeMs: performance.now() };
    scheduleGhostFrame();
    /* Reuses the existing hit test, run here (a pointermove handler) rather
       than inside the rAF ghost loop, so hovering the emphasis never adds a
       second hit-testing implementation or a layout read per animation
       frame. Leaving every candidate (pointer over no zone, or a zone that
       is not a legal candidate) clears the emphasis. */
    const zoneId = zoneIdAtPoint(x, y);
    dropHoveredZoneId =
      zoneId !== null && dropCandidates.has(zoneId) ? zoneId : null;
  }

  function scheduleGhostFrame(): void {
    if (ghostRafHandle !== null) return;
    ghostRafHandle = requestAnimationFrame(tickGhostFrame);
  }

  function cancelGhostFrame(): void {
    if (ghostRafHandle !== null) {
      cancelAnimationFrame(ghostRafHandle);
      ghostRafHandle = null;
    }
  }

  function tickGhostFrame(now: number): void {
    ghostRafHandle = null;
    if (ghostPhase === "dragging") {
      const sample = ghostLatestSample;
      const previous = ghostPreviousSample;
      const origin = ghostOrigin;
      const frame = ghostFrame;
      if (
        sample === null ||
        previous === null ||
        origin === null ||
        frame === null
      )
        return;
      ghostFrame = effectiveReducedMotion
        ? Object.freeze({
            x: sample.x - origin.pointerOffsetX,
            y: sample.y - origin.pointerOffsetY,
            velocityX: 0,
            velocityY: 0,
            tiltDegrees: 0,
          })
        : dragFrameForPointer(frame, previous, sample, origin);
      ghostPreviousSample = sample;
      return;
    }
    if (ghostPhase === "settling") {
      const target = ghostSettleTarget;
      const frame = ghostFrame;
      if (target === null || frame === null) {
        removeGhost();
        return;
      }
      const elapsedMs = ghostLastTickMs === 0 ? 16 : now - ghostLastTickMs;
      ghostLastTickMs = now;
      ghostSettleElapsedMs += elapsedMs;
      ghostFrame = settleDragGhostFrame(frame, target, elapsedMs);
      if (
        dragGhostSettled(ghostFrame, target) ||
        ghostSettleElapsedMs >= DRAG_SETTLE_TIMEOUT_MS
      ) {
        removeGhost();
        return;
      }
      scheduleGhostFrame();
    }
  }

  function removeGhost(): void {
    cancelGhostFrame();
    dragStageFrame = UNROTATED_FRAME;
    ghostOrigin = null;
    ghostFrame = null;
    ghostPhase = "idle";
    ghostSettleTarget = null;
    ghostSettleElapsedMs = 0;
    ghostLastTickMs = 0;
    ghostLatestSample = null;
    ghostPreviousSample = null;
  }

  function cancelDragGhostOnPromptChange(
    value: ActiveInteractionSpec | null,
  ): void {
    const key = value?.key.promptId ?? null;
    if (key === ghostPromptKey) return;
    ghostPromptKey = key;
    if (ghostOrigin !== null) removeGhost();
    clearHandPin();
    /* The held choices belong to the prompt that offered them: answering the
       replacement with one of them would send a dead choice id. */
    dropConfirm = null;
  }

  function clearHandZoomOnBoardChange(value: BoardViewModel): void {
    if (value !== handZoomBoardRef) {
      handZoomBoardRef = value;
      clearHandPin();
    }
  }

  /* Toggling on the target rather than on the card view: a re-projection hands
     out a new `BoardCardView` object for the same card. Anchored on the card
     article, never on the activated button, whose 44px pointer-target floor
     can outgrow the card it covers. */
  function toggleHandPin(card: BoardCardView, element: HTMLElement): void {
    if (pinnedHandTarget === card.targetId) {
      clearHandPin();
      return;
    }
    pinnedHandTarget = card.targetId;
    enterHandZoom(
      card,
      element.closest<HTMLElement>(".duel-field-card") ?? element,
    );
  }

  /* Cancelling drops the zoom with the pin: the card returns to its unzoomed
     state on the spot, without waiting for a pointer that may never leave. */
  function clearHandPin(): void {
    pinnedHandTarget = null;
    handZoom = null;
  }

  function cancelHandPinOnOutsidePointer(event: PointerEvent): void {
    if (pinnedHandTarget === null || insideHandZoomUnion(event.target)) return;
    clearHandPin();
  }

  function cancelHandPinOnEscape(event: KeyboardEvent): void {
    if (pinnedHandTarget === null || event.key !== "Escape") return;
    clearHandPin();
  }

  function withPinnedHandTarget(
    base: ReadonlySet<BoardTargetId>,
    pinned: BoardTargetId | null,
  ): ReadonlySet<BoardTargetId> {
    if (pinned === null) return base;
    const result = new SvelteSet(base);
    result.add(pinned);
    return result;
  }

  /* Null while a hover or pinned zoom is up: that one is serving a card of its
     own. The tracker still runs, so the selection the pointer was covering is
     the one handed back when it leaves. */
  function latestSelectedHandCard(
    value: BoardViewModel,
    targets: ReadonlySet<BoardTargetId>,
    zoom: typeof handZoom,
  ): BoardCardView | null {
    const candidates = selectedHandZoomCandidates(value.cards, targets);
    const candidateTargets = candidates.map(({ targetId }) => targetId);
    latestSelectedHandTarget = trackLatestSelectedTarget(
      previousSelectedHandTargets,
      candidateTargets,
      latestSelectedHandTarget,
    );
    previousSelectedHandTargets = candidateTargets;
    if (zoom !== null) return null;
    return (
      candidates.find(
        ({ targetId }) => targetId === latestSelectedHandTarget,
      ) ?? null
    );
  }

  /* The anchor a hover reads from its own event, measured here from the card
     the selection names instead. Read on the spot rather than remembered: the
     band scrolls and re-fans under a selection that outlives several
     projections, and a stale rect would strand the overlay off its card. */
  function measureSelectedHandZoom(
    card: BoardCardView | null,
  ): typeof handZoom {
    if (card === null) return null;
    const article =
      fieldRoot?.querySelector<HTMLElement>(
        `[data-cy="field-card-${card.id}"]`,
      ) ?? null;
    if (article === null) return null;
    const frame = readStageFrame(fieldRoot);
    return {
      card,
      anchor: toFrameRect(frame, article.getBoundingClientRect()),
      frameWidth: readFrameWidth(fieldRoot),
    };
  }

  function enterHandZoom(card: BoardCardView, element: HTMLElement): void {
    /* A pinned zoom outranks the pointer: hovering a second hand card must
       leave the frozen one exactly where it is. */
    if (pinnedHandTarget !== null && pinnedHandTarget !== card.targetId) return;
    const frame = readStageFrame(fieldRoot);
    const rect = toFrameRect(frame, element.getBoundingClientRect());
    handZoom = {
      card,
      anchor: rect,
      frameWidth: readFrameWidth(fieldRoot),
    };
  }

  /* ADR-032 §5: the overlay dies when the pointer leaves the *union* of the
     hand card and the overlay, never on either boundary on its own. The
     crossing's `relatedTarget` settles that synchronously, inside the very
     event that reports the leave. A flag raised by the other half's
     `pointerenter` cannot: that enter is a later dispatch, and the overlay is
     already unmounted by the microtask checkpoint in between. */
  function leaveHandZoom(related: EventTarget | null): void {
    if (pinnedHandTarget !== null || insideHandZoomUnion(related)) return;
    handZoom = null;
  }

  function insideHandZoomUnion(related: EventTarget | null): boolean {
    if (handZoom === null || !(related instanceof Element)) return false;
    if (related.closest(".hand-zoom-overlay") !== null) return true;
    return (
      related.closest("[data-card-id]")?.getAttribute("data-card-id") ===
      handZoom.card.id
    );
  }

  /* The ghost's home/target rect is read live from the DOM only here, at
     release — never on every animation frame — because the hand viewport can
     scroll under a long drag (T8). */
  function endCardDrag(x: number, y: number): void {
    const card = dragCard;
    const candidates = dropCandidates;
    const origin = ghostOrigin;
    dragCard = null;
    dropCandidates = EMPTY_ZONE_IDS;
    dropHoveredZoneId = null;
    if (card === null || spec === null || origin === null) {
      removeGhost();
      return;
    }
    /* `pointercancel` reports NaN: the gesture was abandoned, not dropped. */
    const cancelled = Number.isNaN(x) || Number.isNaN(y);
    let target: { readonly x: number; readonly y: number } | null = null;
    if (!cancelled) {
      const cardChoices = spec.cardChoices.get(card.targetId) ?? [];
      /* Item 4: the dashed zone overlaps the band area, so the hit element —
         not the zone map — decides, and it is asked first. */
      const hit = hitTest(x, y);
      const activation =
        hit !== null &&
        hit.closest('[data-cy="hand-activation-drop-zone"]') !== null
          ? activateChoices(cardChoices)
          : [];
      if (activation.length > 0) {
        const handZone = board.zones.find((value) => value.id === "p0:hand");
        /* `target` stays null on purpose: the ghost springs the card home
           behind the modal, and no placement intent is armed — an activated
           card need not stay where the gesture aimed it. */
        if (handZone !== undefined)
          dropConfirm = {
            card,
            zone: handZone,
            choices: activation,
            source: "handActivation",
          };
      } else {
        const zoneId = zoneIdAtPoint(x, y);
        if (zoneId !== null && candidates.has(zoneId)) {
          const zone = board.zones.find((value) => value.id === zoneId);
          const choices =
            zone === undefined ? [] : dropChoicesForZone(zone, cardChoices);
          const choice = choices.length === 1 ? choices[0] : undefined;
          /* Item 6: two or more readings of the same gesture is a question, not
             a preference. Item 4 adds the lone activation to that: it commits a
             play that cannot be taken back, so it asks even alone. Summon and
             set stay a statement and commit on release. The card springs home
             behind the modal and only the answer commits anything. */
          const needsConfirm =
            choices.length > 1 ||
            (choice !== undefined && choice.action === "activate");
          if (zone !== undefined && needsConfirm)
            dropConfirm = { card, zone, choices, source: "zone" };
          else if (zone !== undefined && choice !== undefined) {
            /* Exactly one placement intent + one chooseChoice, dispatched
               before any ghost animation starts — the spring never delays or
               authorizes this. */
            onplacementintent(zone.id);
            dispatch({ type: "chooseChoice", choiceId: choice.id });
            const zoneElement = fieldRoot.querySelector<HTMLElement>(
              `[data-zone-id="${zone.id}"]`,
            );
            const rect = zoneElement?.getBoundingClientRect();
            if (rect !== undefined) {
              const framed = toFrameRect(dragStageFrame, rect);
              target = {
                x: framed.left + framed.width / 2 - origin.width / 2,
                y: framed.top + framed.height / 2 - origin.height / 2,
              };
            }
          }
        }
      }
    }
    if (target === null) {
      const sourceElement = fieldRoot.querySelector<HTMLElement>(
        `[data-card-id="${card.id}"]`,
      );
      const rect = sourceElement?.getBoundingClientRect();
      if (rect === undefined)
        target = { x: origin.sourceLeft, y: origin.sourceTop };
      else {
        const framed = toFrameRect(dragStageFrame, rect);
        target = { x: framed.left, y: framed.top };
      }
    }
    if (effectiveReducedMotion) {
      removeGhost();
      return;
    }
    cancelGhostFrame();
    ghostPhase = "settling";
    ghostSettleTarget = target;
    ghostSettleElapsedMs = 0;
    ghostLastTickMs = 0;
    scheduleGhostFrame();
  }

  /* Never trust the topmost element: action chips sit above the zones and can
     be visible mid-drag, and a zone's own label span is a child of the zone.
     Only an enclosing `[data-zone-id]` counts, and anything else is a miss. */
  function zoneIdAtPoint(x: number, y: number): PhysicalZoneId | null {
    const hit = hitTest(x, y);
    if (hit === null) return null;
    const zoneElement = hit.closest("[data-zone-id]");
    if (zoneElement === null) return null;
    return zoneElement.getAttribute("data-zone-id") as PhysicalZoneId | null;
  }

  function browsedStack(
    state: ZoneListState,
    value: BoardViewModel,
  ): BoardStackView | null {
    if (state === null || state.mode !== "browse") return null;
    return value.stacks.find((stack) => stack.id === state.stackId) ?? null;
  }

  function browsedMaterialsHost(
    state: ZoneListState,
    value: BoardViewModel,
  ): BoardCardView | null {
    if (state === null || state.mode !== "materials") return null;
    return value.cards.find((card) => card.targetId === state.hostId) ?? null;
  }

  function promptKeyOf(value: ActiveInteractionSpec | null): string | null {
    return value === null
      ? null
      : `${value.key.workerGeneration}:${value.key.sessionGeneration}:${value.key.promptId}`;
  }

  /* Every mounted control that can reopen the target list: the pile or hand
     card that also carries one of the off-field choices. */
  function targetLauncherIds(
    value: ActiveInteractionSpec | null,
  ): ReadonlySet<BoardTargetId> {
    const launchers = new SvelteSet<BoardTargetId>();
    if (value === null || value.kind !== "cardSelection") return launchers;
    const offField = new SvelteSet(value.offFieldChoices.map(({ id }) => id));
    if (offField.size === 0) return launchers;
    for (const [targetId, choices] of [
      ...value.cardChoices,
      ...value.stackChoices,
    ]) {
      if (choices.some(({ id }) => offField.has(id))) launchers.add(targetId);
    }
    return launchers;
  }

  /* One auto-open per prompt: a replacement prompt closes whatever was open,
     and a prompt that has off-field targets opens its list once. */
  function synchronizeZoneList(
    value: ActiveInteractionSpec | null,
    targets: readonly OffFieldTargetEntry[],
  ): void {
    const key = promptKeyOf(value);
    if (key !== lastPromptKey) {
      lastPromptKey = key;
      zoneListState = null;
      targetListCollapsed = false;
      outsideDismissedTargetId = null;
      dismissedTargetPromptKey = null;
      activeWindowId = null;
    }
    if (key === null || targets.length === 0) return;
    if (zoneListState === null && dismissedTargetPromptKey !== key) {
      zoneListState = { mode: "target", promptKey: key };
      activateWindow("zoneList");
    }
  }

  function toggleTargetList(): void {
    const key = promptKeyOf(spec);
    if (key === null) return;
    if (zoneListState?.mode === "target") {
      targetListCollapsed = !targetListCollapsed;
      return;
    }
    dismissedTargetPromptKey = null;
    zoneListState = { mode: "target", promptKey: key };
    activateWindow("zoneList");
  }

  function activateStack(stack: BoardStackView): void {
    if (outsideDismissedTargetId === stack.targetId) {
      outsideDismissedTargetId = null;
      return;
    }
    outsideDismissedTargetId = null;
    if (targetLaunchers.has(stack.targetId)) {
      toggleTargetList();
      return;
    }
    zoneListState =
      zoneListState?.mode === "browse" && zoneListState.stackId === stack.id
        ? null
        : { mode: "browse", stackId: stack.id };
    if (zoneListState !== null) activateWindow("zoneList");
  }

  /* Materials are a zone the player may read at any time, so this list opens
     with no prompt in play. A host that already left the board is a stale
     chip closure and answers with nothing at all. */
  function openMaterialsDialog(hostId: BoardTargetId): void {
    if (outsideDismissedTargetId === hostId) {
      outsideDismissedTargetId = null;
      return;
    }
    outsideDismissedTargetId = null;
    if (board.cards.find(({ targetId }) => targetId === hostId) === undefined)
      return;
    zoneListState =
      zoneListState?.mode === "materials" && zoneListState.hostId === hostId
        ? null
        : { mode: "materials", hostId };
    if (zoneListState !== null) activateWindow("zoneList");
  }

  function cardLocalActions(card: BoardCardView): readonly LocalCardAction[] {
    if (card.materials.length === 0) return [];
    return [
      {
        id: "materials",
        label: "Materials",
        onSelect: () => openMaterialsDialog(card.targetId),
      },
    ];
  }

  function activateWindow(id: FieldWindowId): void {
    activeWindowId = id;
  }

  function closeZoneList(): void {
    zoneListState = null;
    if (activeWindowId === "zoneList") activeWindowId = null;
  }

  /* Closing hides the list only; the draft selection stays untouched and any
     launcher reopens it. */
  function dismissZoneList(event?: Event): void {
    /* R1/F3: when every off-field choice failed to mount a launcher (opponent
       hand addresses, which the projector emits as placeholders), this window
       is the only surface that can answer the prompt. Hiding it would set
       `dismissedTargetPromptKey`, which `synchronizeZoneList` then honours
       forever, so the decision would have no surface at all. */
    if (zoneListState?.mode === "target" && targetLaunchers.size === 0) return;
    const origin = event?.target;
    const pressed =
      origin instanceof Element
        ? (origin
            .closest("[data-field-target]")
            ?.getAttribute("data-field-target") as BoardTargetId | null)
        : null;
    /* A mounted target of the same prompt is part of this decision, not
       outside it: selecting one must not hide the window that carries the
       shared counter and Confirm. Its launchers still toggle the list. */
    if (
      zoneListState?.mode === "target" &&
      pressed !== null &&
      !targetLaunchers.has(pressed) &&
      isMountedDecisionTarget(pressed)
    ) {
      return;
    }
    outsideDismissedTargetId =
      pressed !== null && isZoneListLauncher(pressed) ? pressed : null;
    if (zoneListState?.mode === "target")
      dismissedTargetPromptKey = zoneListState.promptKey;
    closeZoneList();
  }

  function isMountedDecisionTarget(targetId: BoardTargetId): boolean {
    return (
      spec !== null &&
      (spec.cardChoices.has(targetId) || spec.zoneChoices.has(targetId))
    );
  }

  /* Only the control that renders the open list swallows the click that
     dismissed it; pressing any other pile still opens that pile. */
  function isZoneListLauncher(targetId: BoardTargetId): boolean {
    const state = zoneListState;
    if (state === null) return false;
    if (state.mode === "materials") return state.hostId === targetId;
    return state.mode === "browse"
      ? board.stacks.some(
          (stack) => stack.id === state.stackId && stack.targetId === targetId,
        )
      : targetLaunchers.has(targetId);
  }

  function chooseTargetChoice(choice: InteractionChoice): void {
    if (spec === null) return;
    oninteraction({
      type: "toggleChoice",
      choiceId: choice.id,
      key: spec.key,
    });
  }

  function confirmMaterialSelection(choiceIds: readonly string[]): void {
    if (prompt === null || spec === null || pending) return;
    const requested = new Set(choiceIds);
    const selected = new Set(session.selectedChoiceIds);
    const resolved = overlayChoices
      .filter(({ id }) => requested.has(id))
      .map(({ id }) => id);
    if (
      resolved.length !== choiceIds.length ||
      !validatePromptSelection(prompt, resolved).valid
    ) {
      return;
    }
    const resolvedSet = new Set(resolved);
    for (const choiceId of session.selectedChoiceIds) {
      if (!resolvedSet.has(choiceId))
        dispatch({ type: "toggleChoice", choiceId });
    }
    for (const choiceId of resolved) {
      if (!selected.has(choiceId)) dispatch({ type: "toggleChoice", choiceId });
    }
    dispatch({ type: "confirm" });
  }

  /* Item 9: once the answer is in flight the draft is no longer the player's,
     so it stops being drawn. Suppressed rather than cleared: `submissionRejected`
     returns the session to `editing` with these ids intact, and the halo set has
     to come back exactly as it was. */
  function handZoomHalo(card: BoardCardView): "legal" | "selected" | null {
    if (selectedTargets.has(card.targetId)) return "selected";
    if (!pending && spec?.cardChoices.has(card.targetId) === true)
      return "legal";
    return null;
  }

  function targetSelections(
    value: ActiveInteractionSpec,
    draft: InteractionSession,
  ): ReadonlySet<BoardTargetId> {
    if (draft.status === "submitting") return EMPTY_TARGETS;
    const selected = new SvelteSet(draft.selectedChoiceIds);
    const result = new SvelteSet<BoardTargetId>();
    for (const [target, choices] of [
      ...value.cardChoices,
      ...value.zoneChoices,
    ]) {
      if (choices.some(({ id }) => selected.has(id))) result.add(target);
    }
    return result;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (outside-click cancel is a passive surface handler; interactive controls inside it own all keyboard/pointer semantics) -->
<!-- svelte-ignore a11y_click_events_have_key_events (outside-click cancel has no keyboard equivalent to mirror; every actionable control keeps its own key handling) -->
<section
  class="duel-field"
  aria-label="Duel field"
  bind:this={fieldRoot}
  data-cy="duel-field"
  data-dragging={dragCard === null ? undefined : "true"}
  data-targeting={spec !== null && spec.kind === "cardSelection"
    ? "true"
    : undefined}
  data-prompt-kind={prompt === null ? undefined : prompt.kind}
  style={`width: ${boardWidth}px; height: ${boardHeight}px;`}
  onclick={dismissOnOutsideClick}
  onpointerdown={beginHandZoomDrag}
  onpointermove={moveHandZoomDrag}
  onpointerup={endHandZoomDrag}
  onpointercancel={cancelHandZoomDrag}
>
  <!-- Inner field is exact geometry-sized position/clamp boundary.
       Wrapper remains non-scrolling; floating windows stay field-local. -->
  <div class="duel-field-scroll-region" data-cy="duel-field-scroll-region">
    <div class="duel-field-stage" data-cy="duel-field-stage">
      <FieldBoard
        {board}
        {renderLayout}
        {imageLibrary}
        cardBackUrl={resolvedCardBackUrl}
        placeholderUrl={resolvedPlaceholderUrl}
        {spec}
        {selectedTargets}
        disabled={pending}
        pinnedTarget={session.menuTarget}
        zoomServedTarget={handZoom === null ? null : handZoom.card.targetId}
        draggedTarget={dragCard === null ? null : dragCard.targetId}
        {dropCandidates}
        {dropHoveredZoneId}
        {showZoneOutlines}
        {showZoneCounts}
        {showCardShadows}
        {showZoneLabels}
        {planeHeight}
        {planeTransform}
        oncardactivate={activateCard}
        onzoneactivate={activateZone}
        oncardchoose={(choice) => {
          dispatch({ type: "chooseChoice", choiceId: choice.id });
        }}
        oncarddismiss={() => dispatch({ type: "closeMenu" })}
        oncarddragstart={startCardDrag}
        oncarddragmove={moveCardDrag}
        oncarddragend={endCardDrag}
        oncardpreview={onpreview}
        localActionsFor={cardLocalActions}
        {onstackpreview}
        onstackactivate={activateStack}
        oncardzoomenter={enterHandZoom}
        oncardzoomleave={leaveHandZoom}
      >
        <!-- Item 4: the drag-to-activate target shares the projected flat-space
             coordinates used by the player hand placement. -->
        {#if dragCard !== null && dragActivateChoices.length > 0}
          <div
            class="duel-hand-activation-zone"
            data-cy="hand-activation-drop-zone"
            style={handActivationZoneStyle(renderLayout)}
          >
            <span
              class="duel-hand-activation-zone__label"
              data-cy="hand-activation-drop-zone-label">Activate</span
            >
          </div>
        {/if}
      </FieldBoard>
    </div>
  </div>
  <EndTurnButton
    choice={endTurnChoice}
    armed={endTurnArmed}
    disabled={pending}
    onstart={onendturnstart}
  />
  <FullControlToggle
    value={fullControl}
    held={fullControlHeld}
    onchange={onfullcontrolchange}
  />
  {#if ghostOrigin !== null && ghostFrame !== null}
    <DragGhost
      frame={ghostFrame}
      origin={ghostOrigin}
      settling={ghostPhase === "settling"}
      reducedMotion={effectiveReducedMotion}
    />
  {/if}
  {#if handZoomView !== null}
    <!-- Item 5: a selection is answered by the card's own cover toggle and the
         target list, never by a chip. The overlay is that same card served
         larger, so it repeats `CardControl`'s gate rather than its own rule. -->
    <HandZoomOverlay
      card={handZoomView.card}
      anchor={handZoomView.anchor}
      frameWidth={handZoomView.frameWidth}
      {imageLibrary}
      cardBackUrl={resolvedCardBackUrl}
      placeholderUrl={resolvedPlaceholderUrl}
      choices={spec === null || spec.kind === "cardSelection"
        ? []
        : (spec.cardChoices.get(handZoomView.card.targetId) ?? [])}
      halo={handZoomHalo(handZoomView.card)}
      selectionCandidate={spec?.kind === "cardSelection"}
      disabled={pending}
      onchoose={(choice) => {
        dispatch({ type: "chooseChoice", choiceId: choice.id });
        clearHandPin();
      }}
      ondismiss={clearHandPin}
      onzoomleave={leaveHandZoom}
    />
  {/if}
  {#if overlayChoices.length > 0 && spec !== null}
    <MaterialSelectDialog
      choices={overlayChoices}
      minSelections={spec.constraints.minimum}
      maxSelections={spec.constraints.maximum}
      {imageLibrary}
      cardBackUrl={resolvedCardBackUrl}
      disabled={pending}
      onconfirm={confirmMaterialSelection}
      oncancel={spec.constraints.cancelable
        ? () => dispatch({ type: "cancel" })
        : null}
    />
  {/if}
  {#if dropConfirm !== null}
    <DropConfirmDialog
      card={dropConfirm.card}
      zone={dropConfirm.zone}
      choices={dropConfirm.choices}
      disabled={pending}
      onconfirm={(choice) => {
        const confirmed = dropConfirm;
        dropConfirm = null;
        if (confirmed === null) return;
        /* The same pair `endCardDrag` sends for an unambiguous drop, only now
           the zone was held across the question instead of the gesture. Item
           4's activation zone is not a place, so it arms nothing: the engine's
           own follow-up place prompt is answered on the field. */
        if (confirmed.source === "zone") onplacementintent(confirmed.zone.id);
        dispatch({ type: "chooseChoice", choiceId: choice.id });
      }}
      oncancel={() => (dropConfirm = null)}
    />
  {/if}
  {#if targetListOpen && spec !== null}
    <ZoneListDialog
      mode="target"
      title={spec.title}
      targetEntries={offFieldTargets}
      choices={spec.kind === "cardSelection"
        ? [...spec.cardChoices.values(), ...spec.zoneChoices.values()].flat()
        : []}
      selectedChoiceIds={session.selectedChoiceIds}
      minimum={spec.constraints.minimum}
      maximum={spec.constraints.maximum}
      {selectionStatus}
      confirmValid={validation.valid}
      cancelable={spec.constraints.cancelable}
      {imageLibrary}
      cardBackUrl={resolvedCardBackUrl}
      placeholderUrl={resolvedPlaceholderUrl}
      disabled={pending}
      boundaryElement={fieldRoot}
      windowPosition={zoneListWindowPosition}
      active={activeWindowId === "zoneList"}
      collapsed={targetListCollapsed}
      oncollapsedchange={(value) => (targetListCollapsed = value)}
      onactivate={activateWindow}
      onwindowpositionchange={onzoneListWindowPositionChange}
      ontargetchoice={chooseTargetChoice}
      onconfirm={() => dispatch({ type: "confirm" })}
      oncancel={() => dispatch({ type: "cancel" })}
      onpreview={(entry) => onzonelistpreview(entry)}
      onclose={dismissZoneList}
    />
  {:else if materialsHost !== null}
    <ZoneListDialog
      entries={materialEntries}
      choices={[]}
      title={`${materialsHost.label} Materials`}
      {imageLibrary}
      cardBackUrl={resolvedCardBackUrl}
      placeholderUrl={resolvedPlaceholderUrl}
      disabled={pending}
      boundaryElement={fieldRoot}
      windowPosition={zoneListWindowPosition}
      active={activeWindowId === "zoneList"}
      onactivate={activateWindow}
      onwindowpositionchange={onzoneListWindowPositionChange}
      onpreview={(entry) => onzonelistpreview(entry)}
      onclose={dismissZoneList}
    />
  {:else if openStack !== null}
    <ZoneListDialog
      stack={openStack}
      entries={zoneLists.get(openStack.id) ?? []}
      choices={spec?.stackChoices.get(openStack.targetId) ?? []}
      {imageLibrary}
      cardBackUrl={resolvedCardBackUrl}
      placeholderUrl={resolvedPlaceholderUrl}
      disabled={pending}
      boundaryElement={fieldRoot}
      windowPosition={zoneListWindowPosition}
      active={activeWindowId === "zoneList"}
      onactivate={activateWindow}
      onwindowpositionchange={onzoneListWindowPositionChange}
      onchoose={(choice) => {
        dispatch({ type: "chooseChoice", choiceId: choice.id });
        closeZoneList();
      }}
      onpreview={(entry) => onzonelistpreview(entry)}
      onclose={dismissZoneList}
    />
  {/if}
  {#if actionBarVisible && prompt && spec}
    <FloatingFieldWindow
      windowId="confirm"
      ariaLabel="Field decision window"
      boundaryElement={fieldRoot}
      position={confirmWindowPosition}
      active={activeWindowId === "confirm"}
      disabled={pending}
      onactivate={activateWindow}
      onpositionchange={onconfirmWindowPositionChange}
    >
      <span slot="handle" data-cy="field-confirm-window-title">Decision</span>
      <FieldActionBar
        {spec}
        {session}
        {contextMessage}
        {selectionStatus}
        disabled={pending}
        confirmValid={validation.valid}
        validationMessage={validation.valid ? "" : validation.message}
        {oninteraction}
      />
    </FloatingFieldWindow>
  {/if}
  {#if feedbackState.line}
    <FieldLines line={feedbackState.line} />
  {/if}
</section>
