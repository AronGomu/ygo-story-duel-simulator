<script lang="ts">
  import { afterUpdate, onMount } from "svelte";
  import { CHOICE_RESPONSES, PROLOGUE } from "./content/prologue.ts";
  import {
    createInitialPrototypeState,
    type BattleResult,
    type ChoiceId,
    type LocationId,
    type PrototypeScreen,
    type PrototypeState,
  } from "./model/prototype-state.ts";
  import { reducePrototype } from "./model/prototype-reducer.ts";
  import HistoryOverlay from "./overlays/HistoryOverlay.svelte";
  import LoadOverlay from "./overlays/LoadOverlay.svelte";
  import PauseOverlay from "./overlays/PauseOverlay.svelte";
  import SaveLoadOverlay from "./overlays/SaveLoadOverlay.svelte";
  import SettingsOverlay from "./overlays/SettingsOverlay.svelte";
  import ReviewDrawer from "./review/ReviewDrawer.svelte";
  import ReviewLauncher from "./review/ReviewLauncher.svelte";
  import type { ReviewPreset } from "./review/review-presets.ts";
  import {
    parseReviewLink,
    type ReviewMapState,
  } from "./review/review-link.ts";
  import BattleHandoffScreen from "./screens/BattleHandoffScreen.svelte";
  import IllustratedMapScreen from "./screens/IllustratedMapScreen.svelte";
  import LoadScreen from "./screens/LoadScreen.svelte";
  import NarrativeScreen from "./screens/NarrativeScreen.svelte";
  import OutcomeScreen from "./screens/OutcomeScreen.svelte";
  import PreBattleScreen from "./screens/PreBattleScreen.svelte";
  import RewardScreen from "./screens/RewardScreen.svelte";
  import TitleScreen from "./screens/TitleScreen.svelte";
  import {
    loadPrototypeSlots,
    resetPrototypeStorage,
    savePrototypeState,
  } from "./storage/prototype-storage.ts";

  type Overlay = "history" | "settings" | "pause" | "save" | "load" | null;
  let state = createInitialPrototypeState();
  let manualState: PrototypeState | null = null;
  let autosaveState: PrototypeState | null = null;
  let latestSaveSlot: "manual" | "autosave" | null = null;
  let storageOperationError: string | null = null;
  let overlay: Overlay = null;
  let overlayTrigger: HTMLElement | null = null;
  let saveMode: "idle" | "saving" | "success" | "overwrite" | "failure" =
    "idle";
  let autosaveStatus: "idle" | "success" | "failure" = "idle";
  let dirty = false;
  let forceEmptyHistory = false;
  let settingsReviewState: "default" | "changed" | "reset" | "audio" =
    "default";
  let reviewMapState: ReviewMapState = "default";
  let reviewEpoch = 0;
  let inputId = 0;
  let missingAssets = false;
  let storageFailure = false;
  let reducedMotion = false;
  let previousScreen: PrototypeScreen = state.screen;

  onMount(() => {
    const review = parseReviewLink(globalThis.location.search);
    const loaded = loadPrototypeSlots();
    if (loaded.ok) {
      manualState = loaded.slots.manual;
      autosaveState = loaded.slots.autosave;
      latestSaveSlot = loaded.slots.latest;
      if (manualState !== null || autosaveState !== null)
        state = { ...state, progressExists: true };
    } else storageOperationError = loaded.message;
    if (review.screen !== "launcher" || globalThis.location.search !== "") {
      reviewMapState = review.map;
      state = applyReviewMap(
        {
          ...state,
          screen: review.screen,
          choice: review.choice,
          choiceResponse:
            review.choice === null ? null : CHOICE_RESPONSES[review.choice],
          outcome: review.outcome,
        },
        review.map,
      );
      missingAssets = review.missingAssets;
      storageFailure = review.storageFailure;
      reducedMotion = review.reducedMotion;
    }
  });

  afterUpdate(() => {
    if (state.screen === previousScreen) return;
    previousScreen = state.screen;
    queueMicrotask(() => {
      const heading = document.querySelector<HTMLElement>("#prototype-app h1");
      if (heading !== null) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  });

  $: beat =
    PROLOGUE.beats[Math.min(state.narrativeIndex, PROLOGUE.beats.length - 1)]!;
  $: activeChoices =
    state.narrativeIndex === 13 && state.choice === null
      ? PROLOGUE.choices
      : [];
  $: historyEntries = forceEmptyHistory
    ? []
    : PROLOGUE.beats
        .slice(0, state.narrativeIndex + 1)
        .map(({ speaker, text }) => ({ speaker, text }));

  function go(screen: PrototypeScreen): void {
    state = { ...state, screen };
    overlay = null;
  }
  function dispatch(command: Parameters<typeof reducePrototype>[1]): void {
    const next = reducePrototype(state, command);
    if (next !== state && !["continue", "load", "reset"].includes(command.type))
      dirty = true;
    state = next;
  }
  function startFlow(): void {
    go("title");
  }
  function newGame(): void {
    dispatch({ type: "new-game" });
  }
  function resumeSnapshot(snapshot: PrototypeState): void {
    state = { ...snapshot, screen: snapshot.savedScreen };
    inputId = snapshot.lastInputId ?? 0;
    dirty = false;
  }
  function continueGame(): void {
    const snapshot =
      latestSaveSlot === "manual"
        ? manualState
        : latestSaveSlot === "autosave"
          ? autosaveState
          : (autosaveState ?? manualState);
    if (snapshot !== null) resumeSnapshot(snapshot);
    else dispatch({ type: "continue" });
  }
  function loadSlot(slot: "manual" | "autosave"): void {
    const snapshot = slot === "manual" ? manualState : autosaveState;
    if (snapshot !== null) resumeSnapshot(snapshot);
    else {
      state = reducePrototype(state, { type: "load", slot });
      dirty = false;
    }
  }
  function deleteManualSave(): boolean {
    const result = resetPrototypeStorage(undefined, "manual");
    if (!result.ok) {
      storageOperationError = `Delete failed: ${result.message}`;
      return false;
    }
    manualState = null;
    if (latestSaveSlot === "manual")
      latestSaveSlot = autosaveState === null ? null : "autosave";
    state = {
      ...state,
      progressExists: autosaveState !== null,
    };
    return true;
  }
  function advance(): void {
    if (state.narrativeIndex >= PROLOGUE.beats.length - 1) {
      dispatch({ type: "go-to-map" });
      return;
    }
    inputId += 1;
    dispatch({ type: "advance", inputId });
  }
  function choose(choice: ChoiceId): void {
    dispatch({ type: "choose", choice });
  }
  function openOverlay(
    value: Overlay,
    event?: Event,
    preserveTrigger = false,
  ): void {
    if (!preserveTrigger)
      overlayTrigger =
        event?.currentTarget instanceof HTMLElement
          ? event.currentTarget
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    saveMode =
      value === "save"
        ? state.progressExists
          ? "overwrite"
          : "idle"
        : saveMode;
    overlay = value;
  }
  function closeOverlay(): void {
    overlay = null;
  }
  function retryStorageAccess(): boolean {
    const loaded = loadPrototypeSlots();
    if (!loaded.ok) {
      storageOperationError = loaded.message;
      return false;
    }
    manualState = loaded.slots.manual;
    autosaveState = loaded.slots.autosave;
    latestSaveSlot = loaded.slots.latest;
    storageOperationError = null;
    state = {
      ...state,
      progressExists:
        manualState !== null || autosaveState !== null || state.progressExists,
    };
    return true;
  }
  function manualSave(): void {
    if (storageFailure || storageOperationError !== null) {
      saveMode = "failure";
      return;
    }
    const snapshot = { ...state, savedScreen: state.screen };
    const result = savePrototypeState(snapshot, undefined, "manual");
    saveMode = result.ok ? "success" : "failure";
    if (result.ok) {
      manualState = snapshot;
      latestSaveSlot = "manual";
      dirty = false;
    } else storageOperationError = result.message;
  }
  function retryManualSave(): void {
    if (storageOperationError !== null && !retryStorageAccess()) return;
    manualSave();
  }
  function autosaveReward(): void {
    if (storageFailure || storageOperationError !== null) {
      autosaveStatus = "failure";
      return;
    }
    const snapshot = { ...state, savedScreen: "reward" as const };
    const result = savePrototypeState(snapshot, undefined, "autosave");
    autosaveStatus = result.ok ? "success" : "failure";
    if (result.ok) {
      autosaveState = snapshot;
      latestSaveSlot = "autosave";
      dirty = false;
    } else storageOperationError = result.message;
  }
  function retryAutosave(): void {
    if (storageOperationError !== null && !retryStorageAccess()) return;
    autosaveReward();
  }
  function continueOutcome(): void {
    dispatch({ type: "continue-outcome" });
    if (state.screen === "reward") autosaveReward();
  }
  function acknowledgeReward(): void {
    dispatch({ type: "acknowledge-reward" });
  }
  function reset(): void {
    const result = resetPrototypeStorage();
    if (!result.ok) {
      storageOperationError = `Reset failed: ${result.message}`;
      return;
    }
    state = createInitialPrototypeState();
    manualState = null;
    autosaveState = null;
    latestSaveSlot = null;
    storageOperationError = null;
    dirty = false;
    forceEmptyHistory = false;
    settingsReviewState = "default";
    autosaveStatus = "idle";
    reviewMapState = "default";
    missingAssets = false;
    storageFailure = false;
    reducedMotion = false;
    overlay = null;
    history.replaceState(null, "", globalThis.location.pathname);
  }
  function recoverOutcome(action: "retry" | "return"): void {
    state = {
      ...state,
      screen: action === "retry" ? "battle-mock" : "map",
      outcome: null,
      outcomeScene: null,
    };
  }
  function reviewChange(field: string, value: string | boolean | null): void {
    if (field === "preset") applyReviewPreset(value as ReviewPreset);
    else if (field === "screen") go(value as PrototypeScreen);
    else if (field === "choice")
      state = {
        ...state,
        choice: value as ChoiceId | null,
        choiceResponse:
          value === null ? null : CHOICE_RESPONSES[value as ChoiceId],
      };
    else if (field === "map") {
      reviewMapState = value as ReviewMapState;
      state = applyReviewMap(state, reviewMapState);
    } else if (field === "outcome") {
      reviewEpoch += 1;
      state = {
        ...state,
        outcome: value as BattleResult | null,
        screen: "battle-mock",
      };
    } else if (field === "missingAssets") missingAssets = Boolean(value);
    else if (field === "storageFailure") storageFailure = Boolean(value);
    else if (field === "reducedMotion") reducedMotion = Boolean(value);
  }
  function applyReviewPreset(preset: ReviewPreset): void {
    const fresh = createInitialPrototypeState();
    reviewEpoch += 1;
    overlay = null;
    dirty = false;
    forceEmptyHistory = false;
    missingAssets = false;
    storageFailure = false;
    reducedMotion = false;
    settingsReviewState = "default";
    reviewMapState = "default";
    saveMode = "idle";
    autosaveStatus = "idle";

    if (preset === "launcher-fresh") state = fresh;
    else if (preset === "launcher-progress")
      state = { ...fresh, progressExists: true };
    else if (preset === "title-new") state = { ...fresh, screen: "title" };
    else if (preset === "title-continue")
      state = { ...fresh, screen: "title", progressExists: true };
    else if (preset.startsWith("load-")) {
      state = { ...fresh, screen: "load" };
      storageFailure = preset === "load-corrupt";
    } else if (
      preset.startsWith("narrative-") ||
      preset.startsWith("choice-")
    ) {
      const beatByPreset: Partial<Record<ReviewPreset, number>> = {
        "narrative-narration": 0,
        "narrative-dialogue": 2,
        "narrative-thought": 1,
        "narrative-two-characters": 9,
        "narrative-long": 21,
        "narrative-missing": 2,
        "choice-default": 13,
        "choice-resolved": 13,
      };
      state = {
        ...fresh,
        screen: "narrative",
        progressExists: true,
        narrativeIndex: beatByPreset[preset] ?? 0,
        choice: preset === "choice-resolved" ? "trust-rin" : null,
        choiceResponse:
          preset === "choice-resolved" ? CHOICE_RESPONSES["trust-rin"] : null,
      };
      missingAssets = preset === "narrative-missing";
    } else if (preset.startsWith("history-")) {
      state = {
        ...fresh,
        screen: "narrative",
        narrativeIndex: preset === "history-empty" ? 0 : 5,
      };
      forceEmptyHistory = preset === "history-empty";
      openOverlay("history");
    } else if (preset.startsWith("settings-")) {
      settingsReviewState = preset.slice(
        "settings-".length,
      ) as typeof settingsReviewState;
      openOverlay("settings");
    } else if (preset.startsWith("map-")) {
      reviewMapState = preset.slice("map-".length) as ReviewMapState;
      state = applyReviewMap({ ...fresh, screen: "map" }, reviewMapState);
    } else if (preset === "prebattle-ready")
      state = { ...fresh, screen: "pre-battle" };
    else if (preset.startsWith("battle-"))
      state = {
        ...fresh,
        screen: "battle-mock",
        outcome:
          preset === "battle-ready"
            ? null
            : (preset.slice("battle-".length) as BattleResult),
      };
    else if (preset.startsWith("outcome-"))
      state = {
        ...fresh,
        screen: "outcome",
        outcome:
          preset === "outcome-win"
            ? "win"
            : preset === "outcome-loss"
              ? "loss"
              : "failure",
      };
    else if (preset === "reward-new") {
      state = { ...fresh, screen: "reward", rewardGranted: true };
      autosaveStatus = "success";
    } else if (preset === "reward-acknowledged") {
      state = reducePrototype(
        { ...fresh, screen: "reward", rewardGranted: true },
        { type: "acknowledge-reward" },
      );
    } else if (preset.startsWith("save-")) {
      state = { ...fresh, screen: "narrative" };
      saveMode = preset.slice("save-".length) as typeof saveMode;
      overlay = "save";
    } else if (preset === "motion-default") {
      state = { ...fresh, screen: "narrative" };
      reducedMotion = false;
    } else if (preset === "motion-reduced") {
      state = { ...fresh, screen: "narrative" };
      reducedMotion = true;
    }
  }

  function applyReviewMap(
    current: PrototypeState,
    map: ReviewMapState,
  ): PrototypeState {
    const pristine = createInitialPrototypeState().locations;
    return {
      ...current,
      locations: pristine.map((location) => {
        if (location.id !== "old-arena") return location;
        if (map === "available-completed")
          return { ...location, access: "available", completed: true };
        if (map === "completed")
          return { ...location, access: "locked", completed: true };
        if (map === "default") return location;
        return {
          ...location,
          access: map as "available" | "locked" | "hidden",
          completed: false,
        };
      }),
    };
  }
</script>

<svelte:head><title>Visual novel prototype · Private review</title></svelte:head
>
<div class:force-reduced-motion={reducedMotion} class="prototype-app">
  {#if storageOperationError}
    <section
      class="storage-error"
      role="alert"
      aria-labelledby="storage-error-heading"
    >
      <div>
        <h2 id="storage-error-heading">Prototype storage needs attention</h2>
        <p>{storageOperationError}</p>
      </div>
      <button
        type="button"
        class="secondary"
        onclick={() => void retryStorageAccess()}>Retry storage</button
      >
      <button type="button" class="secondary" onclick={reset}
        >Reset prototype storage</button
      >
    </section>
  {/if}
  {#key reviewEpoch}
    {#if state.screen === "launcher"}
      <ReviewLauncher
        hasProgress={state.progressExists}
        onstart={startFlow}
        onjump={go}
        onreset={reset}
      />
    {:else if state.screen === "title"}
      <TitleScreen
        hasProgress={state.progressExists}
        onnewgame={newGame}
        oncontinue={continueGame}
        onload={() => go("load")}
        onsettings={() => openOverlay("settings")}
      />
    {:else if state.screen === "load"}
      <LoadScreen
        showCorrupt={storageFailure}
        onload={loadSlot}
        ondelete={deleteManualSave}
        onback={() => go("title")}
      />
    {:else if state.screen === "narrative"}
      <NarrativeScreen
        {beat}
        narrativeIndex={state.narrativeIndex}
        choices={activeChoices}
        selectedChoice={state.choice}
        choiceResponse={state.narrativeIndex === 13
          ? state.choiceResponse
          : null}
        {missingAssets}
        onadvance={advance}
        onchoose={choose}
        onutility={(utility) =>
          openOverlay(utility === "pause" ? "pause" : utility)}
      />
    {:else if state.screen === "map"}
      <IllustratedMapScreen
        locations={state.locations}
        objective={state.objective}
        choiceAcknowledgment={state.laterAcknowledgment}
        allowBack={!state.rewardAcknowledged}
        onselect={(locationId: LocationId) =>
          dispatch({ type: "select-location", locationId })}
        onback={() => go("narrative")}
      />
      {#if state.rewardAcknowledged}<section
          class="completion-panel"
          aria-label="Progression complete"
        >
          <p>
            <strong>Updated map:</strong> Old Arena completed. Archive available.
          </p>
          <button type="button" onclick={() => openOverlay("save")}
            >Save progress</button
          ><button type="button" class="secondary" onclick={() => go("end")}
            >End prototype</button
          >
        </section>{/if}
    {:else if state.screen === "pre-battle"}
      <PreBattleScreen
        allowReturn={true}
        onstart={() => dispatch({ type: "start-battle" })}
        onreturn={() => go("map")}
      />
    {:else if state.screen === "battle-mock"}
      <BattleHandoffScreen
        reviewResult={state.outcome}
        onresult={(result) => dispatch({ type: "battle-result", result })}
        onretry={() => recoverOutcome("retry")}
        onreturn={() => recoverOutcome("return")}
      />
    {:else if state.screen === "outcome"}
      <OutcomeScreen
        outcome={state.outcome ?? "win"}
        oncontinue={continueOutcome}
        onretry={() => recoverOutcome("retry")}
        onreturn={() => recoverOutcome("return")}
      />
    {:else if state.screen === "reward"}
      <RewardScreen
        {autosaveStatus}
        onretry={retryAutosave}
        oncontinue={acknowledgeReward}
      />
    {:else}
      <main class="end-screen">
        <p class="eyebrow">Review boundary reached</p>
        <h1>Prototype complete</h1>
        <p>
          Record accepted, rejected, and unresolved decisions before production
          architecture work.
        </p>
        <div>
          <button type="button" onclick={reset}>Replay from launcher</button
          ><button type="button" class="secondary" onclick={() => go("map")}
            >Review updated map</button
          >
        </div>
      </main>
    {/if}
  {/key}

  {#if state.screen !== "launcher" && state.screen !== "title" && state.screen !== "load" && state.screen !== "end"}
    <button
      type="button"
      class="global-pause secondary"
      onclick={(event) => openOverlay("pause", event)}>Open pause menu</button
    >
  {/if}

  {#if overlay === "history"}<HistoryOverlay
      entries={historyEntries}
      onclose={closeOverlay}
      restoreFocusTo={overlayTrigger}
    />
  {:else if overlay === "settings"}<SettingsOverlay
      reviewState={settingsReviewState}
      onclose={closeOverlay}
      restoreFocusTo={overlayTrigger}
    />
  {:else if overlay === "pause"}<PauseOverlay
      unsaved={dirty}
      onclose={closeOverlay}
      restoreFocusTo={overlayTrigger}
      onaction={(action) => {
        if (action === "resume") closeOverlay();
        else if (action === "title") go("title");
        else if (action === "settings")
          openOverlay("settings", undefined, true);
        else openOverlay(action, undefined, true);
      }}
    />
  {:else if overlay === "save"}<SaveLoadOverlay
      mode={saveMode}
      onclose={closeOverlay}
      onsave={manualSave}
      onretry={retryManualSave}
      oncontinue={closeOverlay}
      restoreFocusTo={overlayTrigger}
    />
  {:else if overlay === "load"}<LoadOverlay
      showCorrupt={storageFailure}
      onload={(slot) => {
        loadSlot(slot);
        closeOverlay();
      }}
      ondelete={deleteManualSave}
      onclose={closeOverlay}
      restoreFocusTo={overlayTrigger}
    />{/if}

  <ReviewDrawer
    {state}
    {missingAssets}
    {storageFailure}
    {reducedMotion}
    mapState={reviewMapState}
    onchange={reviewChange}
    onreset={reset}
  />
</div>

<style>
  .prototype-app {
    min-height: 100svh;
  }
  .storage-error {
    position: fixed;
    z-index: 45;
    top: max(0.5rem, env(safe-area-inset-top));
    left: 50%;
    width: min(48rem, calc(100% - 1rem));
    transform: translateX(-50%);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem;
    border: 2px solid #ff9ba5;
    border-radius: 0.5rem;
    background: #35151df2;
  }
  .storage-error div {
    flex: 1 1 16rem;
  }
  .storage-error h2,
  .storage-error p {
    margin: 0.2rem;
  }
  .global-pause {
    position: fixed;
    z-index: 25;
    left: max(0.5rem, env(safe-area-inset-left));
    top: max(0.5rem, env(safe-area-inset-top));
    background: #07111ddd;
  }
  .completion-panel {
    position: fixed;
    z-index: 10;
    left: 50%;
    bottom: max(1rem, env(safe-area-inset-bottom));
    width: min(40rem, calc(100% - 2rem));
    transform: translateX(-50%);
    padding: 1rem;
    border: 1px solid var(--prototype-accent);
    border-radius: 0.6rem;
    background: #07111ff2;
    box-shadow: 0 1rem 3rem #000b;
  }
  .completion-panel button {
    margin-right: 0.5rem;
  }
  .end-screen {
    min-height: 100svh;
    display: grid;
    place-content: center;
    justify-items: start;
    gap: 1rem;
    padding: clamp(1rem, 8vw, 7rem);
    background:
      radial-gradient(circle at 60% 30%, #28586a, transparent 30%), #07111f;
  }
  .end-screen p {
    max-width: 50ch;
    line-height: 1.6;
  }
  .end-screen div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  :global(.force-reduced-motion *),
  :global(.force-reduced-motion *::before),
  :global(.force-reduced-motion *::after) {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
</style>
