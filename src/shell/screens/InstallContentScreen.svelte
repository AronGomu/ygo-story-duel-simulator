<script lang="ts">
  import { onMount } from "svelte";
  import {
    readInstallerChapterSizes,
    type InstallerChapterSizes,
  } from "../content/installer-chapter-sizes.ts";
  import {
    createContentInstaller,
    type CoreBootstrap,
    type ContentInstaller,
    type ChapterId,
    type DownloadProgress,
  } from "../../content/index.ts";
  import { createRuntimeActivationPort } from "../../battle/content-activation.ts";
  import { contentErrorCopy } from "../content/content-error-copy.ts";
  import { coreGateMessage, type CoreGate } from "../core/core-gate.ts";

  export let gate: CoreGate;
  export let bootstrap: CoreBootstrap | null;
  export let onback: () => void;
  export let createInstaller = createContentInstaller;

  let installer: ContentInstaller | null = null;
  let busy = false;
  let error = "";
  let progress: DownloadProgress | null = null;
  let installed: readonly string[] = [];
  let descriptions: Record<string, InstallerChapterSizes> = {};
  let mounted = false;
  let started = false;
  $: if (mounted && bootstrap !== null && !started) void initialize();
  let unsubscribe: () => void = () => undefined;
  const abort = new AbortController();
  const phaseLabel = (phase: DownloadProgress["phase"]): string =>
    ({
      queued: "checking",
      extracting: "staging",
      complete: "installed",
      downloading: "downloading",
      verifying: "verifying",
      activating: "activating",
      paused: "paused",
      failed: "failed",
      cancelled: "cancelled",
    })[phase];

  async function initialize(): Promise<void> {
    if (!bootstrap) return;
    started = true;
    busy = true;
    error = "";
    const result = await createInstaller({
      bootstrap,
      savedRefs: {
        async read() {
          const { savedContentRefs } =
            await import("../content/saved-content-refs.ts");
          return savedContentRefs.read();
        },
      },
      activation: createRuntimeActivationPort(),
    });
    if (!mounted) {
      if (result.kind === "ok") result.value.close();
      return;
    }
    if (result.kind === "failed") {
      error = contentErrorCopy(result.code);
      busy = false;
      return;
    }
    installer = result.value;
    const refresh = async () => {
      const current = await result.value.current();
      if (!mounted) return;
      if (current.kind === "failed") {
        error = contentErrorCopy(current.code);
        installed = [];
      } else
        installed = current.value.current?.chapters.map((c) => c.packId) ?? [];
    };
    unsubscribe = result.value.subscribeCurrent((state) => {
      if (!mounted) return;
      if (state.kind === "failed") {
        error = contentErrorCopy(state.code);
        installed = [];
      } else
        installed = state.value.current?.chapters.map((c) => c.packId) ?? [];
    });
    await refresh();
    if (bootstrap.delivery) {
      const catalog = await result.value.readCatalog(
        bootstrap.delivery.index.sha256,
      );
      if (catalog.kind === "failed") error = contentErrorCopy(catalog.code);
      else
        for (const chapter of catalog.value.value.chapters) {
          if (chapter.status !== "published") continue;
          const sizes = await readInstallerChapterSizes(
            result.value,
            chapter.manifest,
          );
          if (sizes.kind === "failed") error = contentErrorCopy(sizes.code);
          else descriptions = { ...descriptions, [chapter.id]: sizes.value };
        }
    }
    busy = false;
  }
  async function install(chapterId: ChapterId): Promise<void> {
    if (busy) return;
    if (!installer) {
      await initialize();
      return;
    }
    busy = true;
    error = "";
    const result = await installer.download(
      { kind: "chapter", chapterId },
      (p) => {
        progress = p;
      },
      abort.signal,
    );
    if (result.kind === "failed") error = contentErrorCopy(result.code);
    busy = false;
  }
  onMount(() => {
    mounted = true;
    const teardown = () => abort.abort();
    window.addEventListener("pagehide", teardown);
    return () => {
      mounted = false;
      teardown();
      window.removeEventListener("pagehide", teardown);
      unsubscribe();
      installer?.close();
    };
  });
</script>

<main class="install-content" data-cy="install-content-screen">
  <p class="install-content__eyebrow" data-cy="install-content-eyebrow">
    CORE content
  </p>
  <h1 data-cy="install-content-heading">Install content</h1>
  <p role="status" data-cy="install-content-status">
    {coreGateMessage(gate)}
  </p>

  {#if bootstrap !== null}
    <ul data-cy="install-content-chapters">
      {#each bootstrap.chapters as chapter (chapter.id)}
        <li data-cy={`install-content-chapter-${chapter.id}`}>
          <strong data-cy={`install-content-chapter-title-${chapter.id}`}
            >{chapter.title}</strong
          >
          <span data-cy={`install-content-chapter-description-${chapter.id}`}
            >{chapter.description}</span
          >
          <span data-cy={`install-content-sizes-${chapter.id}`}>
            {#if descriptions[chapter.id]}
              Download: {descriptions[chapter.id]!.download.toLocaleString()} bytes
              · Installed: {descriptions[
                chapter.id
              ]!.installed.toLocaleString()} bytes · Dependencies: {descriptions[
                chapter.id
              ]!.deps || "none"}
            {:else}Unavailable in this release{/if}
          </span>
          <span role="status" data-cy={`install-content-ready-${chapter.id}`}
            >{installed.includes(chapter.id)
              ? "Verified installed — gameplay adapters pending."
              : descriptions[chapter.id]
                ? "Available"
                : "Unavailable"}</span
          >
          <button
            type="button"
            data-cy={`install-content-install-${chapter.id}`}
            disabled={busy ||
              installed.includes(chapter.id) ||
              !descriptions[chapter.id]}
            onclick={() => install(chapter.id)}
            >{error ? "Retry installation" : "Install"}</button
          >
        </li>
      {/each}
    </ul>
  {/if}

  <p class="install-content__hint" data-cy="install-content-availability">
    {bootstrap === null || bootstrap.delivery === null
      ? "No content package is available in this build."
      : "Install verified content. Gameplay remains locked until domain adapters are available."}
  </p>
  {#if progress}
    <p role="status" aria-live="polite" data-cy="install-content-progress">
      {phaseLabel(progress.phase)} · {progress.verifiedDownloadBytes.toLocaleString()}
      / {progress.totalDownloadBytes.toLocaleString()} bytes
    </p>
  {/if}
  {#if error}
    <p role="alert" data-cy="install-content-error">{error}</p>
    {#if !installer}<button
        type="button"
        data-cy="install-content-retry"
        disabled={busy}
        onclick={initialize}>Retry</button
      >{/if}
  {/if}
  <div
    class="install-content__actions"
    data-cy="install-content-actions"
    aria-busy={busy}
  >
    <button type="button" data-cy="install-content-install" disabled
      >Update / remove unavailable</button
    >
    <button
      type="button"
      class="secondary"
      data-cy="install-content-back"
      onclick={onback}>Back to menu</button
    >
  </div>
</main>

<style>
  .install-content {
    display: grid;
    align-content: center;
    gap: var(--space-3);
    width: min(38rem, 100%);
    min-height: 100%;
    margin-inline: auto;
    padding: clamp(var(--space-4), 8vw, var(--space-6));
  }

  .install-content__eyebrow,
  .install-content__hint {
    margin: 0;
    color: var(--muted);
  }

  h1,
  p,
  ul {
    margin-block: 0;
  }

  ul {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line-soft);
    background: var(--glass);
  }

  .install-content__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
