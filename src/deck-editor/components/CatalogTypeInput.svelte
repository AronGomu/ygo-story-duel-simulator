<script lang="ts">
  import type { CatalogTypeTag } from "../../decks/catalog/deck-catalog.ts";

  export let options: readonly CatalogTypeTag[];
  export let value: readonly CatalogTypeTag[];
  export let onchange: (value: readonly CatalogTypeTag[]) => void;

  const listboxId = "deck-catalog-types-listbox";
  let query = "";
  let open = false;
  let activeIndex = -1;

  $: selectedIds = new Set(value.map(({ id }) => id));
  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: suggestions = options.filter(
    (option) =>
      !selectedIds.has(option.id) &&
      (normalizedQuery.length === 0 ||
        option.label.toLocaleLowerCase().includes(normalizedQuery)),
  );
  $: listOpen = open && suggestions.length > 0;
  $: activeOption = listOpen ? (suggestions[activeIndex] ?? null) : null;

  function categoryLabel(category: CatalogTypeTag["category"]): string {
    return category[0]!.toUpperCase() + category.slice(1);
  }

  function cySuffix(tag: CatalogTypeTag): string {
    return tag.id.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function emit(next: readonly CatalogTypeTag[]): void {
    onchange(Object.freeze([...next]));
  }

  function commit(option: CatalogTypeTag): void {
    if (selectedIds.has(option.id)) return;
    emit([...value, option]);
    query = "";
    open = false;
    activeIndex = -1;
  }

  function remove(id: CatalogTypeTag["id"]): void {
    emit(value.filter((tag) => tag.id !== id));
  }

  function handleInput(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value;
    open = true;
    activeIndex = 0;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open = true;
      activeIndex =
        suggestions.length === 0 ? -1 : (activeIndex + 1) % suggestions.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      open = true;
      activeIndex =
        suggestions.length === 0
          ? -1
          : activeIndex <= 0
            ? suggestions.length - 1
            : activeIndex - 1;
      return;
    }
    if (event.key === "Enter") {
      if (activeOption === null) return;
      event.preventDefault();
      commit(activeOption);
      return;
    }
    if (event.key === "Escape") {
      open = false;
      activeIndex = -1;
      return;
    }
    if (event.key === "Backspace" && query.length === 0 && value.length > 0) {
      remove(value[value.length - 1]!.id);
    }
  }
</script>

<div class="type-input" data-cy="deck-catalog-types-field">
  {#if value.length > 0}
    <div class="tags" data-cy="deck-catalog-type-tags">
      {#each value as tag (tag.id)}
        <button
          type="button"
          class="tag"
          aria-label={`Remove ${tag.label} type`}
          data-cy={`deck-catalog-type-tag-${cySuffix(tag)}`}
          onclick={() => remove(tag.id)}>{tag.label} ×</button
        >
      {/each}
    </div>
  {/if}
  <input
    type="text"
    role="combobox"
    aria-label="Types"
    placeholder="Types"
    aria-autocomplete="list"
    aria-controls={listboxId}
    aria-expanded={listOpen}
    aria-activedescendant={activeOption === null
      ? undefined
      : `deck-catalog-type-option-${cySuffix(activeOption)}`}
    autocomplete="off"
    value={query}
    data-cy="deck-catalog-types-input"
    onfocus={() => {
      open = true;
      activeIndex = -1;
    }}
    onblur={() => {
      open = false;
      activeIndex = -1;
    }}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  {#if listOpen}
    <ul
      class="suggestions"
      id={listboxId}
      role="listbox"
      aria-label="Type suggestions"
      data-cy="deck-catalog-type-suggestions"
    >
      {#each suggestions as option, index (option.id)}
        <li data-cy={`deck-catalog-type-option-row-${cySuffix(option)}`}>
          <button
            type="button"
            id={`deck-catalog-type-option-${cySuffix(option)}`}
            role="option"
            tabindex="-1"
            aria-selected={index === activeIndex}
            class:active={index === activeIndex}
            data-cy={`deck-catalog-type-option-${cySuffix(option)}`}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => commit(option)}
            >{categoryLabel(option.category)}: {option.label}</button
          >
        </li>
      {/each}
    </ul>
  {:else if open && normalizedQuery.length > 0}
    <p class="empty" role="status" data-cy="deck-catalog-types-empty">
      No matching types
    </p>
  {/if}
</div>

<style>
  .type-input {
    position: relative;
    min-width: 0;
  }

  .type-input > input {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.65rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-chain);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.3rem;
  }

  .tag {
    min-height: 1.75rem;
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--text);
    font-size: 0.72rem;
  }

  .suggestions {
    position: absolute;
    z-index: 20;
    inset: calc(100% + 0.2rem) 0 auto;
    max-height: 12rem;
    margin: 0;
    padding: 0.25rem;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border-strong);
    background: var(--surface-raised);
    box-shadow: 0 0.5rem 1rem var(--shadow);
  }

  .suggestions button {
    width: 100%;
    padding: 0.45rem 0.55rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--text);
    text-align: left;
  }

  .suggestions button:hover,
  .suggestions button.active {
    background: var(--surface-highlight);
  }

  .empty {
    position: absolute;
    z-index: 20;
    inset: calc(100% + 0.2rem) 0 auto;
    margin: 0;
    padding: 0.55rem;
    border: 1px solid var(--border-strong);
    background: var(--surface-raised);
    color: var(--muted);
  }
</style>
