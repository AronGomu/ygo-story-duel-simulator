<script lang="ts">
  import type { CoreBootstrap } from "../../content/index.ts";
  import { coreGateMessage, type CoreGate } from "../core/core-gate.ts";

  export let gate: CoreGate;
  export let bootstrap: CoreBootstrap | null;
  export let onback: () => void;
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
        </li>
      {/each}
    </ul>
  {/if}

  <p class="install-content__hint" data-cy="install-content-availability">
    {bootstrap === null || bootstrap.delivery === null
      ? "No content package is available in this build."
      : "Installer activation is not available in this CORE slice."}
  </p>
  <div class="install-content__actions" data-cy="install-content-actions">
    <button type="button" data-cy="install-content-install" disabled>
      Install unavailable
    </button>
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
