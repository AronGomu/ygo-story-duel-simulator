<script lang="ts">
  import { afterUpdate } from "svelte";
  import type { StoryBeat } from "../content/prologue.ts";
  import { PROLOGUE } from "../content/prologue.ts";
  import type { ChoiceId } from "../model/prototype-state.ts";

  export let beat: StoryBeat = PROLOGUE.beats[0]!;
  export let narrativeIndex = 0;
  export let choices: readonly {
    readonly id: ChoiceId;
    readonly label: string;
  }[] = [];
  export let selectedChoice: ChoiceId | null = null;
  export let choiceResponse: string | null = null;
  export let missingAssets = false;
  export let onadvance: () => void = () => undefined;
  export let onchoose: (choice: ChoiceId) => void = () => undefined;
  export let onutility: (
    utility: "history" | "save" | "load" | "settings" | "pause",
  ) => void = () => undefined;

  let uiHidden = false;
  let firstChoice: HTMLButtonElement;
  let focusedChoiceSet = "";

  afterUpdate(() => {
    const key = choices.map(({ id }) => id).join(":");
    if (key !== "" && key !== focusedChoiceSet) {
      focusedChoiceSet = key;
      firstChoice?.focus();
    }
  });

  function isControl(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      target.closest("button, input, select, textarea, [role='dialog']") !==
        null
    );
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      uiHidden ||
      choices.length > 0 ||
      event.repeat ||
      isControl(event.target)
    )
      return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onadvance();
    }
  }

  function handleStageClick(event: MouseEvent): void {
    if (
      event.detail <= 1 &&
      !uiHidden &&
      choices.length === 0 &&
      !isControl(event.target)
    )
      onadvance();
  }

  function characterName(character: StoryBeat["characters"][number]): string {
    return character
      .replace("-", " ")
      .replace(/^./, (value) => value.toUpperCase());
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="narrative-stage"
  data-testid="narrative-stage"
  aria-label="Narrative scene"
  onclick={handleStageClick}
>
  <div
    class="background"
    class:fallback={missingAssets}
    data-testid="narrative-background"
    data-background={beat.background}
    data-fallback={missingAssets}
    role="img"
    aria-label={missingAssets
      ? `Missing background art: ${beat.background}`
      : `${beat.background} background`}
  ></div>

  <div class="characters" aria-label="Characters present">
    {#each beat.characters as character, index (`${character}-${index}`)}
      <div
        class:missing={missingAssets}
        class="character"
        role="img"
        aria-label={missingAssets
          ? `Missing character art: ${characterName(character)}`
          : characterName(character)}
        data-expression={character}
      >
        <span aria-hidden="true"
          >{missingAssets ? "?" : character.startsWith("rin") ? "R" : "K"}</span
        >
      </div>
    {/each}
  </div>

  <div class="utility-bar" aria-label="Narrative utilities">
    <button
      type="button"
      class="secondary compact"
      onclick={() => onutility("history")}>History</button
    >
    <button
      type="button"
      class="secondary compact"
      title="Experimental; not functional">Auto · experimental</button
    >
    <button
      type="button"
      class="secondary compact"
      title="Experimental; not functional">Skip · experimental</button
    >
    <button
      type="button"
      class="secondary compact"
      onclick={() => (uiHidden = true)}>Hide UI</button
    >
    <button
      type="button"
      class="secondary compact"
      onclick={() => onutility("save")}>Save</button
    >
    <button
      type="button"
      class="secondary compact"
      onclick={() => onutility("load")}>Load</button
    >
    <button
      type="button"
      class="secondary compact"
      onclick={() => onutility("settings")}>Settings</button
    >
    <button
      type="button"
      class="secondary compact"
      onclick={() => onutility("pause")}>Pause</button
    >
  </div>

  {#if uiHidden}
    <button type="button" class="show-ui" onclick={() => (uiHidden = false)}
      >Show UI</button
    >
  {:else}
    <article
      class="dialogue"
      data-kind={beat.kind}
      aria-label="Current dialogue"
    >
      {#if beat.speaker}<p class="speaker">{beat.speaker}</p>{/if}
      <p class="line" aria-live="off">{beat.text}</p>
      <span class="advance-cue" aria-hidden="true">◆</span>
      <span class="visually-hidden">Press Enter, Space, or tap to advance.</span
      >
      <span data-testid="narrative-cursor" class="cursor"
        >Beat {narrativeIndex + 1}</span
      >
    </article>

    {#if choices.length > 0}
      <div class="choices" role="group" aria-labelledby="choice-heading">
        <h2 id="choice-heading">Choose your response</h2>
        {#each choices as choice, index (choice.id)}
          {#if index === 0}
            <button
              type="button"
              bind:this={firstChoice}
              aria-pressed={selectedChoice === choice.id}
              onclick={() => onchoose(choice.id)}>{choice.label}</button
            >
          {:else}
            <button
              type="button"
              aria-pressed={selectedChoice === choice.id}
              onclick={() => onchoose(choice.id)}>{choice.label}</button
            >
          {/if}
        {/each}
      </div>
    {/if}
    {#if choiceResponse}<p class="choice-response" role="status">
        {choiceResponse}
      </p>{/if}
  {/if}
</section>

<style>
  .narrative-stage {
    position: relative;
    min-height: 100svh;
    overflow: hidden;
    background: #08111c;
  }
  .background {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 65% 25%, #5c7990, transparent 16%),
      linear-gradient(155deg, #1b4059, #08111d 75%);
    transition: opacity 220ms ease;
  }
  .background[data-background="concourse"] {
    background: linear-gradient(115deg, #172436, #355f74 45%, #0c1825);
  }
  .background[data-background="arena"] {
    background:
      radial-gradient(ellipse at 50% 70%, #39708d 0 18%, transparent 19%),
      linear-gradient(#08101c, #142c45);
  }
  .background.fallback {
    background: repeating-linear-gradient(
      135deg,
      #152435 0 16px,
      #1d3146 16px 32px
    );
  }
  .characters {
    position: absolute;
    inset: 8% 4% 11rem;
    display: flex;
    justify-content: center;
    align-items: end;
    gap: min(5vw, 4rem);
    pointer-events: none;
  }
  .character {
    width: min(33vw, 20rem);
    height: min(68vh, 37rem);
    display: grid;
    place-items: center;
    border: 2px solid #8db3c8;
    border-radius: 48% 48% 16% 16%;
    background: linear-gradient(#426d86, #172a3a);
    font:
      800 clamp(3rem, 12vw, 8rem) Georgia,
      serif;
    color: #dcecf4;
    filter: drop-shadow(0 1rem 2rem #000b);
  }
  .character[data-expression="rin-smile"] {
    background: linear-gradient(#4c8290, #29324b);
  }
  .character.missing {
    border-style: dashed;
    background: #19283b;
  }
  .utility-bar {
    position: absolute;
    z-index: 3;
    inset: max(0.5rem, env(safe-area-inset-top))
      max(0.5rem, env(safe-area-inset-right)) auto
      max(0.5rem, env(safe-area-inset-left));
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.35rem;
  }
  .compact {
    min-height: 44px;
    padding: 0.5rem 0.7rem;
    background: #07111dcc;
  }
  .dialogue {
    position: absolute;
    z-index: 2;
    left: max(1rem, env(safe-area-inset-left));
    right: max(1rem, env(safe-area-inset-right));
    bottom: max(1rem, env(safe-area-inset-bottom));
    min-height: 9rem;
    padding: 1.2rem 3rem 1.2rem 1.2rem;
    border: 1px solid #6d93aa;
    border-radius: 0.75rem;
    background: #06111de8;
    box-shadow: 0 1rem 3rem #0009;
  }
  .dialogue[data-kind="thought"] {
    border-left: 0.35rem solid #a78bfa;
    font-style: italic;
  }
  .dialogue[data-kind="narration"] {
    background: #06111dcc;
  }
  .speaker {
    width: fit-content;
    margin: -2.2rem 0 0.7rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid #6d93aa;
    border-radius: 0.35rem;
    background: #102a40;
    color: #8ef1e9;
    font-weight: 800;
  }
  .line {
    max-width: 70ch;
    margin: 0;
    font-size: clamp(1rem, 2.3vw, 1.35rem);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .advance-cue {
    position: absolute;
    right: 1.2rem;
    bottom: 1rem;
    color: var(--prototype-accent);
  }
  .cursor {
    position: absolute;
    right: 1rem;
    top: 0.5rem;
    color: var(--prototype-muted);
    font-size: 0.7rem;
  }
  .choices {
    position: absolute;
    z-index: 4;
    inset: auto max(1rem, env(safe-area-inset-right))
      max(12rem, calc(10rem + env(safe-area-inset-bottom)))
      max(1rem, env(safe-area-inset-left));
    display: grid;
    gap: 0.5rem;
    justify-content: center;
  }
  .choices h2 {
    margin: 0;
    text-align: center;
    text-shadow: 0 2px 5px #000;
  }
  .choices button {
    width: min(36rem, calc(100vw - 2rem));
  }
  .choice-response {
    position: absolute;
    z-index: 5;
    inset: auto 1rem 12rem;
    padding: 1rem;
    background: #0b2033;
  }
  .show-ui {
    position: absolute;
    z-index: 5;
    right: 1rem;
    bottom: 1rem;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @media (max-width: 40rem) {
    .characters {
      bottom: 14rem;
    }
    .character {
      width: 45vw;
      height: 50vh;
    }
    .dialogue {
      bottom: max(0.5rem, env(safe-area-inset-bottom));
    }
    .choices {
      bottom: 13rem;
    }
    .utility-bar {
      justify-content: start;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .background {
      transition: none;
    }
  }
</style>
