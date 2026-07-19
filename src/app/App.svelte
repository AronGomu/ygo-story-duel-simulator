<script lang="ts">
  import { afterUpdate, onMount, tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { DuelDiagnosticTrace } from "../duel/contracts/duel-diagnostics.ts";
  import {
    snapshotId,
    type ChoiceId,
    type SnapshotId,
  } from "../duel/contracts/ids.ts";
  import type { PromptCard } from "../duel/contracts/player-prompt.ts";
  import type { PublicCard } from "../duel/contracts/public-duel-state.ts";
  import { fieldCardChoices, fieldZoneChoice } from "../field/card-mapping.ts";
  import DuelField from "./components/DuelField.svelte";
  import { downloadDuelDiagnostics } from "./diagnostics/download-diagnostics.ts";
  import { DuelWorkerClient } from "./DuelWorkerClient.ts";
  import {
    CardImageCache,
    createPlaceholderCardImageLibrary,
    type CardImageLibrary,
  } from "./images/card-image-cache.ts";
  import {
    pruneRevisionCaches,
    withSnapshotUpdateLock,
  } from "../storage/revision-cache-cleanup.ts";
  import {
    SnapshotStore,
    type SnapshotArtifactReceipt,
    type SnapshotStorageStatus,
  } from "../storage/snapshot-store.ts";
  import { formatDuelPresentationEvent } from "./presentation/format-duel-presentation-event.ts";
  import PromptControls from "./prompts/PromptControls.svelte";
  import { createDuelStore } from "./stores/duel-store.ts";

  const CURRENT_RUNTIME_SNAPSHOT_ID = snapshotId(__RUNTIME_SNAPSHOT_ID__);
  const CURRENT_ACTIVATION_SNAPSHOT_ID = snapshotId(__ACTIVATION_SNAPSHOT_ID__);
  const EMPTY_CARD_IMAGES = new Map<number, string>();
  const ACTIVE_CARD_TEXTS = new Map(
    __ACTIVE_CARD_TEXTS__.map((record) => [record.code, record] as const),
  );
  const CURRENT_ARTIFACT_RECEIPTS: readonly SnapshotArtifactReceipt[] = [
    { id: "runtime-package", sha256: __RUNTIME_MANIFEST_SHA256__ },
    { id: "active-images", sha256: __ACTIVE_IMAGE_MANIFEST_SHA256__ },
  ];
  const client = new DuelWorkerClient();
  const duel = createDuelStore(client);
  const autoStartedWorkerGenerations = new SvelteSet<number>();
  let confirmingSurrender = false;
  let surrenderContext = "";
  let surrenderTrigger: HTMLButtonElement;
  let surrenderConfirm: HTMLButtonElement;
  let promptPanel: HTMLElement;
  let resultHeading: HTMLHeadingElement;
  let errorHeading: HTMLHeadingElement;
  let cardInspectorHeading: HTMLHeadingElement;
  let cardInspectorTrigger: HTMLButtonElement | null = null;
  let previousErrorKey = "";
  let previousStatus = $duel.status;
  let imageLibrary: CardImageLibrary | null = null;
  let imageLibraryVerified = false;
  let imageLibraryGeneration = 0;
  let imageLoading = true;
  let retryImages: () => void = () => undefined;
  let requestFallbackImages: (
    snapshot: SnapshotId,
    manifestSha256: string,
  ) => void = () => undefined;
  let prepareFallbackImages: () => void = () => undefined;
  let fallbackImageAttempted: SnapshotId | null = null;
  $: imagesMatchRuntime =
    imageLibrary !== null &&
    $duel.runtimeSnapshotId !== null &&
    imageLibrary.snapshotId === $duel.runtimeSnapshotId;
  let imageProgress = 0;
  let imageWarning: string | null = null;
  let fieldChoiceIntent: {
    readonly id: ChoiceId;
    readonly nonce: number;
  } | null = null;
  let fieldIntentNonce = 0;
  let fieldIntentMessage = "";
  let inspectedCard: PublicCard | null = null;
  let diagnosticPending = false;
  let diagnosticMessage: string | null = null;
  let downloadedDiagnostics = $duel.diagnostics;
  let snapshotStore: SnapshotStore | null = null;
  let snapshotStorageStatus: SnapshotStorageStatus = {
    activeSnapshotId: null,
    fallbackSnapshotId: null,
    generation: 0,
  };
  let storageWarning: string | null = null;
  let retryStorage: () => void = () => undefined;
  let snapshotStaged = false;
  let snapshotActivationPending = false;
  let snapshotActivationAttempted = false;
  let appDisposed = false;
  const pendingStorageOperations = new SvelteSet<Promise<unknown>>();
  $: appAnnouncement =
    storageWarning ??
    imageWarning ??
    diagnosticMessage ??
    (snapshotActivationPending
      ? "Activating verified snapshot"
      : $duel.responsePending
        ? confirmingSurrender
          ? "Surrender sent. Waiting for the duel result"
          : "Response sent. Waiting for the engine"
        : imageLoading
          ? "Preparing active card images"
          : $duel.loading
            ? `Loading ${phaseLabel($duel.loading.stage)}`
            : "");

  onMount(() => {
    let disposed = false;
    appDisposed = false;
    let imageLoadGeneration = 0;
    let imageAbortController: AbortController | null = null;

    const initializeStorage = async (): Promise<void> => {
      storageWarning = null;
      const previousStore = snapshotStore;
      snapshotStore = null;
      previousStore?.close();
      const openOperation = SnapshotStore.open();
      let abandoned = false;
      void openOperation.then(
        (store) => {
          if (abandoned) store.close();
        },
        () => undefined,
      );
      try {
        const store = await withDeadline(
          openOperation,
          3_000,
          "Snapshot storage did not open in time",
        );
        if (disposed) {
          store.close();
          return;
        }
        snapshotStore = store;
        snapshotStorageStatus = await withDeadline(
          store.status(),
          3_000,
          "Snapshot status lookup timed out",
        );
        if (disposed) return;
        await store.cleanupAbandonedStaging(
          new Date(Date.now() - 24 * 60 * 60 * 1_000),
        );
        if (disposed) return;
        const stageOperation = store.stageSnapshot({
          snapshotId: CURRENT_ACTIVATION_SNAPSHOT_ID,
          revisions: __RUNTIME_REVISIONS__,
          requiredArtifacts: CURRENT_ARTIFACT_RECEIPTS,
        });
        try {
          await withDeadline(
            stageOperation,
            3_000,
            "Snapshot staging timed out",
          );
          if (disposed) return;
          snapshotStaged = true;
        } catch (error) {
          void stageOperation
            .then(() =>
              store.discardStagedSnapshot(CURRENT_ACTIVATION_SNAPSHOT_ID),
            )
            .catch((cleanupError: unknown) => {
              console.warn({
                event: "duel.app.snapshot_staging.cleanup_failed",
                err: cleanupError,
              });
            });
          throw error;
        }
      } catch (error) {
        abandoned = true;
        if (disposed) return;
        storageWarning =
          error instanceof Error
            ? `Snapshot storage is unavailable: ${error.message}`
            : "Snapshot storage is unavailable.";
      }
    };

    type ImageLoadRequest = {
      readonly snapshotId: SnapshotId;
      readonly manifestSha256: string;
    } | null;
    let lastImageRequest: ImageLoadRequest = null;
    const loadImages = async (
      request: ImageLoadRequest = null,
    ): Promise<void> => {
      lastImageRequest = request;
      const generation = ++imageLoadGeneration;
      imageAbortController?.abort(
        new DOMException("Card image attempt replaced", "AbortError"),
      );
      const controller = new AbortController();
      imageAbortController = controller;
      const imageDeadline = setTimeout(
        () =>
          controller.abort(
            new DOMException("Active image preload timed out", "TimeoutError"),
          ),
        15_000,
      );
      imageLoading = true;
      imageProgress = 0;
      imageWarning = null;
      imageLibraryVerified = false;
      const applicationBaseUrl = new URL(
        import.meta.env.BASE_URL,
        globalThis.location.origin,
      ).href;
      try {
        const cache = new CardImageCache({ applicationBaseUrl });
        const onProgress = (completed: number, total: number): void => {
          if (generation === imageLoadGeneration)
            imageProgress = completed / Math.max(total, 1);
        };
        const library =
          request === null
            ? await cache.preload(
                __ACTIVE_IMAGE_MANIFEST__,
                __ACTIVE_IMAGE_MANIFEST_SHA256__,
                onProgress,
                controller.signal,
              )
            : await cache.preloadCachedSnapshot(
                request.snapshotId,
                request.manifestSha256,
                onProgress,
                controller.signal,
              );
        if (disposed || generation !== imageLoadGeneration) library.dispose();
        else {
          imageLibrary?.dispose();
          imageLibrary = library;
          imageLibraryGeneration += 1;
          imageLibraryVerified = true;
          const unavailable = library.diagnostics.filter(
            ({ status }) => status === "missing" || status === "invalid",
          ).length;
          imageWarning =
            unavailable === 0
              ? request === null
                ? null
                : "Using card images from the last verified cached snapshot."
              : `${unavailable} card image${unavailable === 1 ? " is" : "s are"} using a placeholder.`;
        }
      } catch (error) {
        if (!disposed && generation === imageLoadGeneration) {
          const detail =
            error instanceof Error
              ? `Card image cache is unavailable: ${error.message}`
              : "Card image cache is unavailable.";
          imageLibrary?.dispose();
          const placeholderManifest =
            request === null
              ? __ACTIVE_IMAGE_MANIFEST__
              : {
                  ...__ACTIVE_IMAGE_MANIFEST__,
                  snapshotId: request.snapshotId,
                };
          imageLibrary = createPlaceholderCardImageLibrary(
            placeholderManifest,
            request?.manifestSha256 ?? __ACTIVE_IMAGE_MANIFEST_SHA256__,
            detail,
          );
          imageLibraryGeneration += 1;
          imageWarning = detail;
        }
      } finally {
        clearTimeout(imageDeadline);
        if (!disposed && generation === imageLoadGeneration)
          imageLoading = false;
      }
    };
    retryStorage = () =>
      trackStorageOperation("initialize-retry", initializeStorage());
    retryImages = () => void loadImages(lastImageRequest);
    prepareFallbackImages = () => {
      imageLoadGeneration += 1;
      imageAbortController?.abort(
        new DOMException("Switching to fallback images", "AbortError"),
      );
      imageLibraryVerified = false;
      imageLoading = true;
    };
    requestFallbackImages = (snapshot, manifestSha256) =>
      void loadImages({ snapshotId: snapshot, manifestSha256 });

    duel.initialize();
    trackStorageOperation("initialize", initializeStorage());
    void loadImages();
    return () => {
      disposed = true;
      appDisposed = true;
      imageAbortController?.abort(
        new DOMException("Application disposed", "AbortError"),
      );
      imageLibrary?.dispose();
      const storeToClose = snapshotStore;
      snapshotStore = null;
      void Promise.allSettled([...pendingStorageOperations]).finally(() =>
        storeToClose?.close(),
      );
      void duel.destroy().catch((error: unknown) => {
        console.error({ event: "duel.app.destroy.failed", err: error });
      });
    };
  });

  afterUpdate(() => {
    const context = `${$duel.context.workerGeneration}:${$duel.context.sessionGeneration}`;
    if (context !== surrenderContext) {
      surrenderContext = context;
      confirmingSurrender = false;
      diagnosticPending = false;
      inspectedCard = null;
    }
    if ($duel.error !== null) diagnosticPending = false;
    if (inspectedCard !== null) {
      const currentCard = findPublicCard(inspectedCard.instanceId);
      if (currentCard !== inspectedCard) inspectedCard = currentCard;
    }
    if (
      snapshotStaged &&
      !snapshotActivationPending &&
      !snapshotActivationAttempted &&
      imageLibrary !== null &&
      imageLibraryVerified &&
      $duel.coreVersion !== null &&
      $duel.runtimeSnapshotId === CURRENT_RUNTIME_SNAPSHOT_ID
    ) {
      snapshotActivationAttempted = true;
      trackStorageOperation("activate", finalizeSnapshotActivation());
    }
    if (
      $duel.coreVersion !== null &&
      $duel.runtimeSnapshotId !== null &&
      $duel.runtimeSnapshotId !== CURRENT_RUNTIME_SNAPSHOT_ID
    ) {
      if (storageWarning === null)
        storageWarning =
          "The current snapshot was unavailable. Using the last verified cached runtime.";
      const fallbackSnapshotId = $duel.runtimeSnapshotId;
      if (fallbackImageAttempted !== fallbackSnapshotId) {
        fallbackImageAttempted = fallbackSnapshotId;
        prepareFallbackImages();
        const imageDigest = $duel.activeImageManifestSha256;
        if (imageDigest === null) {
          imageWarning =
            "Verified fallback image metadata is unavailable; using placeholders.";
          imageLoading = false;
        } else requestFallbackImages(fallbackSnapshotId, imageDigest);
      }
    }
    const errorKey = $duel.error
      ? `${context}:${$duel.error.code}:${$duel.error.message}`
      : "";
    if (errorKey !== "" && errorKey !== previousErrorKey) errorHeading?.focus();
    previousErrorKey = errorKey;
    if ($duel.status === "completed" && previousStatus !== "completed")
      resultHeading?.focus();
    previousStatus = $duel.status;
  });

  $: if (
    $duel.diagnostics !== null &&
    $duel.diagnostics !== downloadedDiagnostics
  ) {
    // eslint-disable-next-line no-useless-assignment -- retained across reactive runs
    downloadedDiagnostics = $duel.diagnostics;
    diagnosticPending = false;
    handleDiagnosticsDownload($duel.diagnostics);
  }

  $: if (
    $duel.status === "idle" &&
    $duel.coreVersion !== null &&
    !autoStartedWorkerGenerations.has($duel.context.workerGeneration)
  ) {
    autoStartedWorkerGenerations.add($duel.context.workerGeneration);
    queueMicrotask(() => duel.start());
  }

  async function finalizeSnapshotActivation(): Promise<void> {
    if (appDisposed) return;
    const store = snapshotStore;
    const images = imageLibrary;
    if (store === null || images === null || !imageLibraryVerified) return;
    snapshotActivationPending = true;
    const activationGuard = snapshotStorageStatus;
    try {
      const receipts: readonly SnapshotArtifactReceipt[] = [
        { id: "runtime-package", sha256: __RUNTIME_MANIFEST_SHA256__ },
        { id: "active-images", sha256: images.imageManifestSha256 },
      ];
      await store.verifyStagedSnapshot(
        CURRENT_ACTIVATION_SNAPSHOT_ID,
        receipts,
      );
      if (appDisposed) return;
      await withSnapshotUpdateLock(async () => {
        if (appDisposed) return;
        snapshotStorageStatus = await store.activateSnapshot(
          CURRENT_ACTIVATION_SNAPSHOT_ID,
          activationGuard.activeSnapshotId,
          activationGuard.generation,
        );
        const retained = new Set(await store.retainedRevisionCacheNames());
        await pruneRevisionCaches(retained).catch((error: unknown) => {
          console.warn({
            event: "duel.app.revision_cache.cleanup_failed",
            err: error,
          });
        });
      });
    } catch (error) {
      const latest = await store.status().catch(() => null);
      if (latest?.activeSnapshotId === CURRENT_ACTIVATION_SNAPSHOT_ID)
        snapshotStorageStatus = latest;
      else {
        storageWarning =
          error instanceof Error
            ? `Verified snapshot activation failed: ${error.message}`
            : "Verified snapshot activation failed.";
      }
    } finally {
      snapshotActivationPending = false;
    }
  }

  function trackStorageOperation(
    operationName: string,
    operation: Promise<unknown>,
  ): void {
    pendingStorageOperations.add(operation);
    void operation
      .catch((error: unknown) => {
        console.warn({
          event: "duel.app.storage.operation_failed",
          operation: operationName,
          snapshotId: $duel.runtimeSnapshotId,
          err: error,
        });
      })
      .finally(() => pendingStorageOperations.delete(operation));
  }

  function handleDiagnosticsDownload(trace: DuelDiagnosticTrace): void {
    try {
      downloadDuelDiagnostics(trace, {
        buildId: __APP_BUILD_ID__,
        userAgent: navigator.userAgent,
        language: navigator.language,
        activeSnapshotId: snapshotStorageStatus.activeSnapshotId,
        fallbackSnapshotId: snapshotStorageStatus.fallbackSnapshotId,
        imageCache: {
          provider: imageLibrary?.provider ?? "unavailable",
          snapshotId: imageLibrary?.snapshotId ?? null,
          verified: imageLibraryVerified,
          cacheHits:
            imageLibrary?.diagnostics.filter(
              ({ status }) => status === "cache-hit",
            ).length ?? 0,
          cacheMisses:
            imageLibrary?.diagnostics.filter(
              ({ status }) => status === "cache-miss",
            ).length ?? 0,
          missing:
            imageLibrary?.diagnostics.filter(
              ({ status }) => status === "missing",
            ).length ?? 0,
          invalid:
            imageLibrary?.diagnostics.filter(
              ({ status }) => status === "invalid",
            ).length ?? 0,
        },
      });
      if (snapshotStore !== null) {
        void snapshotStore
          .recordDebugRun({
            id: crypto.randomUUID(),
            snapshotId: trace.snapshotId,
            createdAt: new Date().toISOString(),
            resultType: $duel.result?.type ?? "diagnostic",
            traceEntries: trace.entries.length,
          })
          .catch((error: unknown) => {
            storageWarning =
              error instanceof Error
                ? `Debug-run metadata was not saved: ${error.message}`
                : "Debug-run metadata was not saved.";
          });
      }
      diagnosticMessage =
        "Diagnostics downloaded. The file contains the production seed; share it carefully.";
    } catch (error) {
      diagnosticMessage =
        error instanceof Error
          ? `Unable to download diagnostics: ${error.message}`
          : "Unable to download diagnostics.";
    }
  }

  function requestDiagnostics(): void {
    diagnosticMessage = null;
    diagnosticPending = duel.requestDiagnostics();
    if (!diagnosticPending)
      diagnosticMessage = "Diagnostics are unavailable for this session.";
  }

  function fieldCardIntent(instanceId: string): void {
    const card = findPublicCard(instanceId);
    if (card !== null) {
      cardInspectorTrigger = null;
      inspectedCard = card;
      void tick().then(() => cardInspectorHeading?.focus());
    }
    const choices = fieldCardChoices($duel.prompt, $duel.snapshot, instanceId);
    if (choices.length === 1) {
      queueFieldChoice(choices[0]?.id);
      return;
    }
    if (choices.length > 1) {
      fieldIntentMessage = `${choices.length} actions are available for that card. Choose the intended action in the controls below.`;
      promptPanel.focus();
    }
  }

  function fieldZoneIntent(zoneId: string): void {
    const choice = fieldZoneChoice($duel.prompt, zoneId);
    queueFieldChoice(choice?.id);
  }

  function queueFieldChoice(id: ChoiceId | undefined): void {
    if (id === undefined || $duel.responsePending || imageLoading) return;
    fieldIntentMessage = "";
    fieldIntentNonce += 1;
    fieldChoiceIntent = { id, nonce: fieldIntentNonce };
  }

  function retryCardImageLoading(): void {
    if (
      $duel.runtimeSnapshotId !== null &&
      $duel.runtimeSnapshotId !== CURRENT_RUNTIME_SNAPSHOT_ID
    ) {
      fallbackImageAttempted = null;
      imageWarning = null;
      return;
    }
    retryImages();
  }

  function findPublicCard(instanceId: string): PublicCard | null {
    const snapshot = $duel.snapshot;
    if (snapshot === null) return null;
    for (const player of snapshot.players) {
      const card = [
        ...player.hand,
        ...player.monsters,
        ...player.spellsAndTraps,
        ...player.graveyard,
        ...player.banished,
      ].find((candidate) => candidate.instanceId === instanceId);
      if (card !== undefined) return card;
    }
    return null;
  }

  function resolvePublicCardImage(card: PublicCard): string | undefined {
    if (imageLibrary === null) return undefined;
    return imagesMatchRuntime
      ? imageLibrary.urlFor(card.code, !card.faceUp)
      : imageLibrary.urlFor(undefined, !card.faceUp);
  }

  function resolvePromptCardImage(card: PromptCard): string | undefined {
    if (imageLibrary === null) return undefined;
    return imagesMatchRuntime
      ? imageLibrary.urlFor(card.code, card.code === undefined)
      : imageLibrary.urlFor(undefined, card.code === undefined);
  }

  function withDeadline<T>(
    operation: Promise<T>,
    milliseconds: number,
    message: string,
  ): Promise<T> {
    return Promise.race([
      operation,
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => reject(new Error(message)), milliseconds),
      ),
    ]);
  }

  function cardLabel(card: PublicCard): string {
    if (card.code === undefined) return "Hidden card";
    return ACTIVE_CARD_TEXTS.get(card.code)?.name ?? `Card ${card.code}`;
  }

  function cardDescription(card: PublicCard): string | null {
    if (card.code === undefined) return null;
    return ACTIVE_CARD_TEXTS.get(card.code)?.description ?? null;
  }

  async function inspectCard(
    card: PublicCard,
    event: MouseEvent,
  ): Promise<void> {
    cardInspectorTrigger = event.currentTarget as HTMLButtonElement;
    inspectedCard = card;
    await tick();
    cardInspectorHeading.focus();
  }

  async function closeCardInspector(): Promise<void> {
    inspectedCard = null;
    await tick();
    cardInspectorTrigger?.focus();
    cardInspectorTrigger = null;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && inspectedCard !== null) {
      event.preventDefault();
      void closeCardInspector();
    }
  }

  function inspectorLabel(
    card: PublicCard,
    player: 0 | 1,
    zone: string,
  ): string {
    return `Inspect ${cardLabel(card)}, ${player === 0 ? "your" : "opponent"} ${zone}`;
  }

  function phaseLabel(value: string): string {
    return value.replaceAll(/([a-z])([A-Z])/g, "$1 $2");
  }

  async function openSurrenderConfirmation(): Promise<void> {
    confirmingSurrender = true;
    await tick();
    surrenderConfirm.focus();
  }

  async function cancelSurrenderConfirmation(): Promise<void> {
    confirmingSurrender = false;
    await tick();
    surrenderTrigger.focus();
  }

  async function dismissRecoverableError(): Promise<void> {
    duel.clearError();
    await tick();
    promptPanel.focus();
  }
</script>

<svelte:head>
  <title>Preset Duel · YGO Story Duel Simulator</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<header class="app-header">
  <div>
    <p class="eyebrow">Offline preset duel</p>
    <h1>YGO Story Duel Simulator</h1>
  </div>
  <p class="engine-state" aria-live="polite">
    {#if $duel.coreVersion}
      ocgcore {$duel.coreVersion[0]}.{$duel.coreVersion[1]}
    {:else}
      Engine not ready
    {/if}
  </p>
</header>

<main>
  <p class="visually-hidden" aria-live="polite" aria-atomic="true">
    {appAnnouncement}
  </p>
  <section class="status-panel" aria-labelledby="duel-status-heading">
    <div>
      <p class="eyebrow">Session status</p>
      <h2 id="duel-status-heading">{phaseLabel($duel.status)}</h2>
      {#if snapshotStorageStatus.activeSnapshotId}
        <p
          class="snapshot-state"
          title={snapshotStorageStatus.activeSnapshotId}
        >
          Active assets {snapshotStorageStatus.activeSnapshotId.slice(0, 12)}
          {#if snapshotStorageStatus.fallbackSnapshotId}
            · fallback {snapshotStorageStatus.fallbackSnapshotId.slice(0, 12)}
          {/if}
        </p>
      {/if}
    </div>
    {#if imageLoading}
      <div class="loading-state" aria-live="polite">
        <p>Preparing active card images…</p>
        <progress
          aria-label="Preparing active card images"
          value={imageProgress}
          max="1"
        ></progress>
      </div>
    {:else if $duel.loading}
      <div class="loading-state" aria-live="polite">
        <p>Loading {phaseLabel($duel.loading.stage)}…</p>
        {#if $duel.loading.progress === undefined}
          <progress aria-label={`Loading ${$duel.loading.stage}`}></progress>
        {:else}
          <progress
            aria-label={`Loading ${$duel.loading.stage}`}
            value={$duel.loading.progress}
            max="1"
          ></progress>
        {/if}
      </div>
    {/if}
  </section>

  {#if storageWarning || snapshotActivationPending}
    <section
      class="message-panel storage-warning"
      aria-busy={snapshotActivationPending}
    >
      <div>
        <p class="eyebrow">Local snapshot storage</p>
        <p>
          {snapshotActivationPending
            ? "Activating verified snapshot…"
            : storageWarning}
        </p>
      </div>
      {#if storageWarning && snapshotStaged && $duel.runtimeSnapshotId === CURRENT_RUNTIME_SNAPSHOT_ID}
        <button
          type="button"
          class="secondary"
          disabled={snapshotActivationPending}
          onclick={() => {
            storageWarning = null;
            snapshotActivationAttempted = false;
          }}
          >{snapshotActivationPending
            ? "Activating snapshot…"
            : "Retry snapshot activation"}</button
        >
      {:else if storageWarning && !snapshotStaged}
        <button type="button" class="secondary" onclick={retryStorage}
          >Retry local storage</button
        >
      {/if}
    </section>
  {/if}

  {#if imageWarning}
    <section class="message-panel image-warning">
      <div>
        <p class="eyebrow">Card image fallback</p>
        <p>{imageWarning}</p>
      </div>
      <button
        type="button"
        class="secondary"
        disabled={imageLoading}
        onclick={retryCardImageLoading}>Retry card images</button
      >
    </section>
  {/if}

  {#if $duel.error}
    <section
      class:recoverable={$duel.error.recoverable}
      class="message-panel error-panel"
      role="alert"
      aria-labelledby="duel-error-heading"
    >
      <div>
        <p class="eyebrow">
          {$duel.status === "failed"
            ? "Duel stopped"
            : "Choice needs attention"}
        </p>
        <h2 id="duel-error-heading" tabindex="-1" bind:this={errorHeading}>
          {$duel.error.message}
        </h2>
        <p>Error code: {$duel.error.code}</p>
      </div>
      <div class="button-row">
        {#if $duel.error.recoverable && $duel.status !== "failed"}
          <button
            type="button"
            class="secondary"
            onclick={() => void dismissRecoverableError()}>Dismiss</button
          >
        {:else}
          <button type="button" onclick={() => void duel.retry()}
            >Try again</button
          >
        {/if}
        {#if $duel.context.sessionGeneration > 0 && $duel.status === "failed"}
          <span class="sensitive-note">Contains the production seed.</span>
          <button
            type="button"
            class="secondary"
            disabled={diagnosticPending}
            onclick={requestDiagnostics}
            >{diagnosticPending
              ? "Preparing diagnostics…"
              : "Download diagnostics"}</button
          >
        {/if}
      </div>
    </section>
  {/if}

  {#if $duel.result}
    <section
      class="message-panel result-panel"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={$duel.status !== "completed"}
      aria-labelledby="duel-result-heading"
    >
      <div>
        <p class="eyebrow">Duel complete</p>
        <h2 id="duel-result-heading" tabindex="-1" bind:this={resultHeading}>
          {#if $duel.result.type === "completed"}
            {$duel.result.winner === 0 ? "You won" : "Opponent won"}
          {:else if $duel.result.type === "surrendered"}
            Duel surrendered
          {:else if $duel.result.type === "unsupported"}
            Unsupported duel message
          {:else}
            Engine error
          {/if}
        </h2>
        {#if $duel.result.type === "completed"}
          <p>Finish reason {$duel.result.reason}</p>
        {:else if $duel.result.type === "unsupported"}
          <p>{$duel.result.detail}</p>
        {:else if $duel.result.type === "engineError"}
          <p>{$duel.result.detail}</p>
        {/if}
      </div>
      <div class="button-row">
        <button
          type="button"
          disabled={$duel.status !== "completed"}
          onclick={() => void duel.restart()}
          >{$duel.status === "completed"
            ? "Start another duel"
            : "Starting another duel…"}</button
        >
        <span class="sensitive-note">Contains the production seed.</span>
        <button
          type="button"
          class="secondary"
          disabled={diagnosticPending}
          onclick={requestDiagnostics}
          >{diagnosticPending
            ? "Preparing diagnostics…"
            : "Download diagnostics"}</button
        >
      </div>
    </section>
  {/if}

  {#if diagnosticMessage}
    <p class="diagnostic-message">
      {diagnosticMessage}
    </p>
  {/if}

  {#if ($duel.status === "active" || $duel.status === "awaiting-input") && !$duel.result}
    <section
      class="lifecycle-panel"
      aria-label="Duel actions"
      aria-busy={$duel.responsePending}
    >
      {#if confirmingSurrender}
        <div role="alert">
          <strong>Surrender this duel?</strong>
          <p>This immediately awards the duel to your opponent.</p>
          {#if $duel.responsePending}
            <p>Surrender sent. Waiting for the duel result…</p>
          {/if}
        </div>
        <div class="button-row">
          <button
            type="button"
            class="danger"
            bind:this={surrenderConfirm}
            disabled={$duel.responsePending}
            onclick={() => {
              duel.surrender();
            }}>Confirm surrender</button
          >
          <button
            type="button"
            class="secondary"
            disabled={$duel.responsePending}
            onclick={() => void cancelSurrenderConfirmation()}
            >Keep playing</button
          >
        </div>
      {:else}
        <button
          type="button"
          class="secondary"
          bind:this={surrenderTrigger}
          disabled={$duel.responsePending}
          onclick={() => void openSurrenderConfirmation()}
          >Surrender duel</button
        >
      {/if}
    </section>
  {/if}

  {#if imageLibrary && $duel.snapshot}
    {#key `${$duel.context.workerGeneration}:${$duel.context.sessionGeneration}:${imageLibraryGeneration}`}
      <DuelField
        snapshot={$duel.snapshot}
        prompt={$duel.prompt}
        events={$duel.presentationEvents}
        imageUrls={imagesMatchRuntime ? imageLibrary.urls : EMPTY_CARD_IMAGES}
        cardBackUrl={imageLibrary.cardBackUrl}
        placeholderUrl={imageLibrary.placeholderUrl}
        oncardintent={fieldCardIntent}
        onzoneintent={fieldZoneIntent}
      />
    {/key}
  {/if}

  {#if inspectedCard}
    <aside
      id="card-inspector"
      class="card-inspector"
      aria-labelledby="card-inspector-heading"
      aria-describedby={cardDescription(inspectedCard) === null
        ? "card-inspector-location"
        : "card-inspector-location card-inspector-description"}
    >
      <div>
        <p class="eyebrow">Public card details</p>
        <h2
          id="card-inspector-heading"
          tabindex="-1"
          bind:this={cardInspectorHeading}
        >
          {cardLabel(inspectedCard)}
        </h2>
        <p id="card-inspector-location">
          {phaseLabel(inspectedCard.location)} · {phaseLabel(
            inspectedCard.position,
          )}
        </p>
        {#if cardDescription(inspectedCard)}
          <p id="card-inspector-description">
            {cardDescription(inspectedCard)}
          </p>
        {/if}
      </div>
      {#if resolvePublicCardImage(inspectedCard)}
        <img
          src={resolvePublicCardImage(inspectedCard)}
          alt={cardLabel(inspectedCard)}
        />
      {/if}
      <button
        type="button"
        class="secondary"
        onclick={() => void closeCardInspector()}>Close card details</button
      >
    </aside>
  {/if}

  {#if $duel.snapshot}
    <section class="duel-summary" aria-labelledby="duel-summary-heading">
      <div class="turn-summary">
        <div>
          <p class="eyebrow">Turn {$duel.snapshot.turn}</p>
          <h2 id="duel-summary-heading">
            {$duel.snapshot.turnPlayer === 0 ? "Your turn" : "Opponent's turn"}
          </h2>
        </div>
        <p class="phase-pill">{phaseLabel($duel.snapshot.phase)}</p>
      </div>

      <div class="player-grid">
        {#each $duel.snapshot.players as player (player.player)}
          <article
            class="player-card"
            aria-label={player.player === 0 ? "Your state" : "Opponent state"}
          >
            <div class="player-heading">
              <h3>{player.player === 0 ? "You" : "Opponent"}</h3>
              <strong>{player.lifePoints.toLocaleString()} LP</strong>
            </div>
            <dl class="counts">
              <div>
                <dt>Deck</dt>
                <dd>{player.deckCount}</dd>
              </div>
              <div>
                <dt>Extra</dt>
                <dd>{player.extraDeckCount}</dd>
              </div>
              <div>
                <dt>Hand</dt>
                <dd>{player.handCount}</dd>
              </div>
              <div>
                <dt>Graveyard</dt>
                <dd>{player.graveyard.length}</dd>
              </div>
              <div>
                <dt>Banished</dt>
                <dd>{player.banished.length}</dd>
              </div>
            </dl>
            <div class="zones">
              <div>
                <h4>Monsters</h4>
                {#if player.monsters.length === 0}
                  <p class="empty-copy">Empty</p>
                {:else}
                  <ul>
                    {#each player.monsters as card (card.instanceId)}
                      <li>
                        {#if card.code === undefined}
                          {cardLabel(card)}
                        {:else}
                          <button
                            type="button"
                            class="card-detail-trigger"
                            aria-controls="card-inspector"
                            aria-expanded={inspectedCard?.instanceId ===
                              card.instanceId}
                            aria-label={inspectorLabel(
                              card,
                              player.player,
                              "monsters",
                            )}
                            onclick={(event) => void inspectCard(card, event)}
                            >{cardLabel(card)}</button
                          >
                        {/if}
                        · {phaseLabel(card.position)}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div>
                <h4>Spells &amp; traps</h4>
                {#if player.spellsAndTraps.length === 0}
                  <p class="empty-copy">Empty</p>
                {:else}
                  <ul>
                    {#each player.spellsAndTraps as card (card.instanceId)}
                      <li>
                        {#if card.code === undefined}
                          {cardLabel(card)}
                        {:else}
                          <button
                            type="button"
                            class="card-detail-trigger"
                            aria-controls="card-inspector"
                            aria-expanded={inspectedCard?.instanceId ===
                              card.instanceId}
                            aria-label={inspectorLabel(
                              card,
                              player.player,
                              "spells and traps",
                            )}
                            onclick={(event) => void inspectCard(card, event)}
                            >{cardLabel(card)}</button
                          >
                        {/if}
                        · {phaseLabel(card.position)}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div>
                <h4>Graveyard</h4>
                {#if player.graveyard.length === 0}
                  <p class="empty-copy">Empty</p>
                {:else}
                  <ul>
                    {#each player.graveyard as card (card.instanceId)}
                      <li>
                        <button
                          type="button"
                          class="card-detail-trigger"
                          aria-controls="card-inspector"
                          aria-expanded={inspectedCard?.instanceId ===
                            card.instanceId}
                          aria-label={inspectorLabel(
                            card,
                            player.player,
                            "graveyard",
                          )}
                          onclick={(event) => void inspectCard(card, event)}
                          >{cardLabel(card)}</button
                        >
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div>
                <h4>Banished</h4>
                {#if player.banished.length === 0}
                  <p class="empty-copy">Empty</p>
                {:else}
                  <ul>
                    {#each player.banished as card (card.instanceId)}
                      <li>
                        {#if card.code === undefined}
                          {cardLabel(card)}
                        {:else}
                          <button
                            type="button"
                            class="card-detail-trigger"
                            aria-controls="card-inspector"
                            aria-expanded={inspectedCard?.instanceId ===
                              card.instanceId}
                            aria-label={inspectorLabel(
                              card,
                              player.player,
                              "banished cards",
                            )}
                            onclick={(event) => void inspectCard(card, event)}
                            >{cardLabel(card)}</button
                          >
                        {/if}
                        · {phaseLabel(card.position)}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              {#if player.player === 0}
                <div>
                  <h4>Your hand</h4>
                  {#if player.hand.length === 0}
                    <p class="empty-copy">Empty</p>
                  {:else}
                    <ul>
                      {#each player.hand as card (card.instanceId)}
                        <li>
                          <button
                            type="button"
                            class="card-detail-trigger"
                            aria-controls="card-inspector"
                            aria-expanded={inspectedCard?.instanceId ===
                              card.instanceId}
                            aria-label={inspectorLabel(
                              card,
                              player.player,
                              "hand",
                            )}
                            onclick={(event) => void inspectCard(card, event)}
                            >{cardLabel(card)}</button
                          >
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
          </article>
        {/each}
      </div>

      <section class="chain-panel" aria-labelledby="chain-heading">
        <h3 id="chain-heading">Active chain</h3>
        {#if $duel.snapshot.chain.length === 0}
          <p class="empty-copy">No chain is resolving.</p>
        {:else}
          <ol>
            {#each $duel.snapshot.chain as link (link.index)}
              <li>{link.label}</li>
            {/each}
          </ol>
        {/if}
      </section>
    </section>
  {:else if $duel.status === "active"}
    <section class="message-panel" aria-live="polite">
      <div>
        <p class="eyebrow">Preparing duel</p>
        <h2>Waiting for the first public state…</h2>
      </div>
    </section>
  {/if}

  <div class="workspace-grid">
    <section
      class="prompt-panel"
      aria-label="Current decision"
      tabindex="-1"
      bind:this={promptPanel}
    >
      <p class="visually-hidden" aria-live="polite">{fieldIntentMessage}</p>
      {#if $duel.prompt}
        {#if imageLoading}
          <p class="empty-copy" aria-busy="true">
            Card images are still loading. Decisions unlock after every image is
            verified or assigned a placeholder.
          </p>
        {/if}
        {#key $duel.prompt.id}
          <PromptControls
            prompt={$duel.prompt}
            disabled={$duel.responsePending || imageLoading}
            onsubmit={duel.respond}
            choiceIntent={fieldChoiceIntent}
            resolveCardImage={resolvePromptCardImage}
          />
        {/key}
      {:else}
        <p class="eyebrow">Current decision</p>
        <h2>No decision pending</h2>
        <p class="empty-copy">
          {$duel.responsePending
            ? confirmingSurrender
              ? "Surrender sent. Waiting for the duel result…"
              : "Your response was sent. Waiting for the engine…"
            : "The engine will pause here when your input is required."}
        </p>
      {/if}
    </section>

    <section class="event-log" aria-labelledby="event-log-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Latest activity</p>
          <h2 id="event-log-heading">Duel log</h2>
        </div>
        <span>{$duel.presentationEvents.length}/100</span>
      </div>
      <p class="visually-hidden" aria-live="polite">
        {$duel.presentationEvents.length > 0
          ? formatDuelPresentationEvent($duel.presentationEvents.at(-1)!.event)
          : ""}
      </p>
      {#if $duel.presentationEvents.length === 0}
        <p class="empty-copy">Duel events will appear here.</p>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (focus enables keyboard scrolling) -->
        <div
          class="log-scroll"
          role="region"
          tabindex="0"
          aria-labelledby="event-log-heading"
        >
          <ol>
            {#each $duel.presentationEvents as entry (entry.sequence)}
              <li>{formatDuelPresentationEvent(entry.event)}</li>
            {/each}
          </ol>
        </div>
      {/if}
    </section>
  </div>
</main>
