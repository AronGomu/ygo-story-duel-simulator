<script lang="ts">
  import type {
    DuelPhase,
    PlayerIndex,
  } from "../../duel/contracts/public-duel-state.ts";
  import type { InteractionSessionAction } from "../prompts/interaction-session.ts";
  import type { ActiveInteractionSpec } from "../prompts/interaction-spec.ts";
  import {
    PHASE_SLOT_LABELS,
    phaseSlotChoices,
    phaseSlotForDuelPhase,
    type PhaseSlot,
  } from "../prompts/phase-transitions.ts";

  /* End Turn lives in the field corner. PhaseBar keeps the remaining player
     timeline plus the opponent's complete inert phase display. */
  const OPPONENT_SLOTS: readonly PhaseSlot[] = [
    "draw",
    "standby",
    "main1",
    "battle",
    "main2",
    "end",
  ];
  const PLAYER_SLOTS: readonly PhaseSlot[] = [
    "draw",
    "standby",
    "main1",
    "battle",
    "main2",
  ];

  export let phase: DuelPhase = "unknown";
  export let turnPlayer: PlayerIndex = 0;
  export let spec: ActiveInteractionSpec | null = null;
  export let disabled = false;
  export let oninteraction: (
    action: InteractionSessionAction,
  ) => unknown = () => false;

  $: currentSlot = phaseSlotForDuelPhase(phase);
  $: choices = phaseSlotChoices(spec);

  function statefulAriaLabel(
    visibleLabel: string,
    current: boolean,
    available: boolean,
  ): string {
    let label = visibleLabel;
    if (current) label += ", current";
    if (available) label += ", available";
    return label;
  }

  function ariaLabel(
    slot: PhaseSlot,
    current: boolean,
    available: boolean,
  ): string {
    return statefulAriaLabel(
      `${PHASE_SLOT_LABELS[slot]} phase`,
      current,
      available,
    );
  }

  function activate(slot: PhaseSlot): void {
    if (disabled || spec === null) return;
    const choice = choices.get(slot);
    if (choice === undefined) return;
    oninteraction({ type: "chooseChoice", choiceId: choice.id, key: spec.key });
  }
</script>

<aside
  class="phase-bar"
  data-cy="phase-bar"
  role="group"
  aria-label="Duel phases"
>
  <div
    class="phase-bar__half phase-bar__half--player"
    data-cy="phase-bar-player"
    role="group"
    aria-label="Your phases"
    data-current-phase={turnPlayer === 0
      ? (currentSlot ?? undefined)
      : undefined}
  >
    {#each PLAYER_SLOTS as slot (slot)}
      {@const available = !disabled && choices.has(slot)}
      {@const current = turnPlayer === 0 && slot === currentSlot}
      <svelte:element
        this={available ? "button" : "span"}
        type={available ? "button" : undefined}
        class="phase-chip"
        class:is-current={current}
        class:is-available={available}
        role={available ? undefined : "presentation"}
        aria-label={ariaLabel(slot, current, available)}
        data-cy={`phase-bar-you-${slot}`}
        onclick={available ? () => activate(slot) : undefined}
      >
        {PHASE_SLOT_LABELS[slot]}
      </svelte:element>
    {/each}
  </div>
  <div
    class="phase-bar__half phase-bar__half--opponent"
    data-cy="phase-bar-opponent"
    role="group"
    aria-label="Opponent phases"
    data-current-phase={turnPlayer === 1
      ? (currentSlot ?? undefined)
      : undefined}
  >
    {#each OPPONENT_SLOTS as slot (slot)}
      {@const current = turnPlayer === 1 && slot === currentSlot}
      <span
        class="phase-chip"
        class:is-current={current}
        role="presentation"
        aria-label={ariaLabel(slot, current, false)}
        data-cy={`phase-bar-opp-${slot}`}
      >
        {PHASE_SLOT_LABELS[slot]}
      </span>
    {/each}
  </div>
</aside>
