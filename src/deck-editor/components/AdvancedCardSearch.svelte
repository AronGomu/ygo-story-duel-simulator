<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    EMPTY_DECK_CATALOG_QUERY,
    type AdvancedDeckCatalogFilters,
    type AdvancedDeckCatalogOptions,
    type CardTrait,
    type DeckCatalogQuery,
    type LinkMarkerRule,
    type NameMatch,
    type SpellProperty,
    type SummonFrame,
    type TrapProperty,
  } from "../../decks/catalog/deck-catalog.ts";
  import { handleModalKeydown } from "../focus-trap.ts";
  import AdvancedCheckboxGroup from "./AdvancedCheckboxGroup.svelte";
  import AdvancedSelectField from "./AdvancedSelectField.svelte";
  import NumericCriterionField from "./NumericCriterionField.svelte";

  export let filters: DeckCatalogQuery;
  export let options: AdvancedDeckCatalogOptions;
  export let resultCount: number;
  export let onchange: (filters: DeckCatalogQuery) => void;
  export let onreset: () => void;
  export let onclose: () => void;

  export function setResultCount(next: number): void {
    resultCount = next;
  }

  let dialog: HTMLDialogElement | null = null;
  let closeButton: HTMLButtonElement | null = null;
  let observer: ResizeObserver | null = null;
  let bounds = { top: 0, left: 0, width: 0, height: 0 };

  const labels = (values: readonly string[]) =>
    values.map((value) => ({ value, label: value }));
  $: familyOptions = options.families.map((value) => ({
    value,
    label: value[0]!.toUpperCase() + value.slice(1),
  }));
  $: attributeOptions = labels(options.attributes);
  $: raceOptions = labels(options.races);
  $: frameOptions = labels(options.summonFrames);
  $: spellOptions = labels(options.spellProperties);
  $: trapOptions = labels(options.trapProperties);
  const markerRules = [
    { value: "any", label: "Any selected" },
    { value: "all", label: "All selected" },
    { value: "exact", label: "Exact markers" },
  ];
  const restrictions = [
    { value: "3", label: "Unlimited" },
    { value: "2", label: "Semi-Limited" },
    { value: "1", label: "Limited" },
    { value: "0", label: "Forbidden" },
  ];

  function overlayTarget(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('[data-cy="deck-workspace"]') ??
      document.querySelector<HTMLElement>('[data-cy="deck-editor-layout"]')
    );
  }

  function measure(): void {
    const target = overlayTarget();
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    bounds = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  function measureAfterLayout(): void {
    measure();
    void tick().then(measure);
  }

  onMount(async () => {
    measure();
    const target = overlayTarget();
    if (target !== null && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(target);
    }
    window.addEventListener("resize", measureAfterLayout);
    dialog?.showModal();
    await tick();
    closeButton?.focus();
  });

  onDestroy(() => {
    observer?.disconnect();
    window.removeEventListener("resize", measureAfterLayout);
    if (dialog?.open) dialog.close();
    document
      .querySelector<HTMLButtonElement>(
        '[data-cy="deck-catalog-advanced-search"]',
      )
      ?.focus();
  });

  function update(next: Partial<DeckCatalogQuery>): void {
    filters = { ...filters, ...next };
    onchange(filters);
  }

  function updateAdvanced(next: Partial<AdvancedDeckCatalogFilters>): void {
    filters = {
      ...filters,
      advanced: { ...filters.advanced, ...next },
    };
    onchange(filters);
  }

  function reset(): void {
    filters = EMPTY_DECK_CATALOG_QUERY;
    onreset();
  }
</script>

<dialog
  bind:this={dialog}
  class="advanced-dialog"
  style={`top:${bounds.top}px;left:${bounds.left}px;width:${bounds.width}px;height:${bounds.height}px`}
  aria-labelledby="advanced-search-heading"
  data-cy="advanced-search-dialog"
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
  onkeydown={(event) => handleModalKeydown(event, onclose)}
>
  <div
    class="workspace-veil"
    style="opacity:0.34"
    aria-hidden="true"
    data-cy="advanced-search-veil"
  ></div>
  <section class="surface" data-cy="advanced-search-surface">
    <header data-cy="advanced-search-header">
      <div data-cy="advanced-search-titles">
        <h2 id="advanced-search-heading" data-cy="advanced-search-heading">
          Advanced Search
        </h2>
        <p data-cy="advanced-search-subtitle">Changes preview live</p>
      </div>
      <button
        bind:this={closeButton}
        type="button"
        class="secondary close"
        aria-label="Close advanced search"
        data-cy="advanced-search-close"
        onclick={onclose}>×</button
      >
    </header>

    <div class="body" data-cy="advanced-search-body">
      <div class="matrix" data-cy="advanced-search-filter-matrix">
        <section class="group words" data-cy="advanced-search-words">
          <h3 data-cy="advanced-search-words-heading">Words</h3>
          <label data-cy="advanced-search-name-field">
            <span data-cy="advanced-search-name-label">Card name</span>
            <input
              value={filters.name}
              data-cy="advanced-search-name-input"
              oninput={(event) => update({ name: event.currentTarget.value })}
            />
          </label>
          <label data-cy="advanced-search-name-match-field">
            <span data-cy="advanced-search-name-match-label">Name match</span>
            <select
              value={filters.advanced.nameMatch}
              data-cy="advanced-search-name-match"
              onchange={(event) =>
                updateAdvanced({
                  nameMatch: event.currentTarget.value as NameMatch,
                })}
            >
              <option
                value="contains"
                data-cy="advanced-search-name-match-contains">Contains</option
              >
              <option value="exact" data-cy="advanced-search-name-match-exact"
                >Exact</option
              >
              <option
                value="starts-with"
                data-cy="advanced-search-name-match-starts">Starts with</option
              >
              <option
                value="exclude"
                data-cy="advanced-search-name-match-exclude">Exclude</option
              >
            </select>
          </label>
          <label class="wide" data-cy="advanced-search-text-field">
            <span data-cy="advanced-search-text-label">Card text</span>
            <input
              value={filters.advanced.text}
              placeholder="Tokens, &quot;exact phrase&quot;, -excluded"
              data-cy="advanced-search-text-input"
              oninput={(event) =>
                updateAdvanced({ text: event.currentTarget.value })}
            />
          </label>
          <label data-cy="advanced-search-code-field">
            <span data-cy="advanced-search-code-label">Passcode</span>
            <input
              value={filters.advanced.code}
              inputmode="numeric"
              maxlength="8"
              pattern="[0-9]*"
              data-cy="advanced-search-code-input"
              oninput={(event) =>
                updateAdvanced({ code: event.currentTarget.value })}
            />
          </label>
        </section>

        <section class="group identity" data-cy="advanced-search-identity">
          <h3 data-cy="advanced-search-identity-heading">Card identity</h3>
          <AdvancedSelectField
            id="family"
            label="Family"
            value={filters.advanced.family}
            options={familyOptions}
            onchange={(family) =>
              updateAdvanced({
                family: family as AdvancedDeckCatalogFilters["family"],
              })}
          />
          <AdvancedSelectField
            id="attribute"
            label="Attribute"
            value={filters.advanced.attribute}
            options={attributeOptions}
            onchange={(attribute) => updateAdvanced({ attribute })}
          />
          <AdvancedSelectField
            id="race"
            label="Monster type"
            value={filters.advanced.race}
            options={raceOptions}
            onchange={(race) => updateAdvanced({ race })}
          />
          <AdvancedSelectField
            id="frame"
            label="Summon frame"
            value={filters.advanced.summonFrame}
            options={frameOptions}
            onchange={(summonFrame) =>
              updateAdvanced({
                summonFrame: summonFrame as SummonFrame | null,
              })}
          />
          <AdvancedCheckboxGroup
            id="traits"
            label="Traits"
            options={options.traits}
            value={filters.advanced.traits}
            onchange={(traits) =>
              updateAdvanced({ traits: traits as readonly CardTrait[] })}
          />
        </section>

        <section class="group stats" data-cy="advanced-search-stats">
          <h3 data-cy="advanced-search-stats-heading">Stats</h3>
          <NumericCriterionField
            id="attack"
            label="ATK"
            criterion={filters.advanced.attack}
            onchange={(attack) => updateAdvanced({ attack })}
          />
          <NumericCriterionField
            id="defense"
            label="DEF"
            criterion={filters.advanced.defense}
            onchange={(defense) => updateAdvanced({ defense })}
          />
          <NumericCriterionField
            id="level-rank"
            label="Level / Rank"
            criterion={filters.advanced.levelRank}
            allowedMin={0}
            allowedMax={13}
            onchange={(levelRank) => updateAdvanced({ levelRank })}
          />
          <NumericCriterionField
            id="link-rating"
            label="Link Rating"
            criterion={filters.advanced.linkRating}
            allowedMin={1}
            allowedMax={8}
            onchange={(linkRating) => updateAdvanced({ linkRating })}
          />
          <NumericCriterionField
            id="pendulum-scale"
            label="Pendulum Scale"
            criterion={filters.advanced.pendulumScale}
            allowedMin={0}
            allowedMax={13}
            onchange={(pendulumScale) => updateAdvanced({ pendulumScale })}
          />
          <label class="check" data-cy="advanced-search-unknown-stats-field">
            <input
              type="checkbox"
              checked={filters.advanced.includeUnknownAttackDefense}
              data-cy="advanced-search-unknown-stats"
              onchange={(event) =>
                updateAdvanced({
                  includeUnknownAttackDefense: event.currentTarget.checked,
                })}
            />
            <span data-cy="advanced-search-unknown-stats-label"
              >Include ? ATK/DEF</span
            >
          </label>
        </section>

        <section class="group mechanics" data-cy="advanced-search-mechanics">
          <h3 data-cy="advanced-search-mechanics-heading">
            Spell, Trap & links
          </h3>
          <AdvancedSelectField
            id="spell-property"
            label="Spell property"
            value={filters.advanced.spellProperty}
            options={spellOptions}
            onchange={(spellProperty) =>
              updateAdvanced({
                spellProperty: spellProperty as SpellProperty | null,
              })}
          />
          <AdvancedSelectField
            id="trap-property"
            label="Trap property"
            value={filters.advanced.trapProperty}
            options={trapOptions}
            onchange={(trapProperty) =>
              updateAdvanced({
                trapProperty: trapProperty as TrapProperty | null,
              })}
          />
          <AdvancedSelectField
            id="marker-rule"
            label="Link marker rule"
            value={filters.advanced.linkMarkerRule}
            options={markerRules}
            onchange={(linkMarkerRule) =>
              updateAdvanced({
                linkMarkerRule: linkMarkerRule as LinkMarkerRule,
              })}
          />
          <AdvancedCheckboxGroup
            id="markers"
            label="Link markers"
            options={options.linkMarkers}
            value={filters.advanced.linkMarkers}
            onchange={(linkMarkers) => updateAdvanced({ linkMarkers })}
          />
        </section>

        <section class="group legality" data-cy="advanced-search-legality">
          <h3 data-cy="advanced-search-legality-heading">
            Legality & availability
          </h3>
          <AdvancedSelectField
            id="restriction"
            label="Restriction"
            value={filters.advanced.restriction?.toString() ?? null}
            options={restrictions}
            onchange={(restriction) =>
              updateAdvanced({
                restriction:
                  restriction === null
                    ? null
                    : (Number(restriction) as 0 | 1 | 2 | 3),
              })}
          />
          <p data-cy="advanced-search-availability-note">
            Unavailable cards are excluded.
          </p>
        </section>
      </div>
    </div>

    <footer data-cy="advanced-search-footer">
      <p data-cy="advanced-search-result-count">
        <strong data-cy="advanced-search-result-value">{resultCount}</strong> matching
        cards
      </p>
      <button
        type="button"
        class="secondary"
        data-cy="advanced-search-reset"
        onclick={reset}>Reset</button
      >
      <button type="button" data-cy="advanced-search-apply" onclick={onclose}
        >Apply filters</button
      >
    </footer>
  </section>
</dialog>

<style>
  .advanced-dialog {
    position: fixed;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: transparent;
    box-sizing: border-box;
  }
  .advanced-dialog::backdrop {
    background: transparent;
  }
  .workspace-veil {
    position: absolute;
    z-index: 0;
    inset: 0;
    background: var(--shadow);
    opacity: 0.34;
    pointer-events: auto;
  }
  .surface {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    background: color-mix(in srgb, var(--surface-inset) 98%, transparent);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.6rem 0.75rem;
    border-color: var(--border);
    background: var(--surface-chain);
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  footer {
    border-top: 1px solid var(--border);
  }
  header > div {
    min-width: 0;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2,
  h3 {
    color: var(--accent);
    font-family: var(--font-display);
    letter-spacing: var(--ls-display);
    text-transform: uppercase;
  }
  h2 {
    font-size: var(--text-lg);
  }
  h3 {
    grid-column: 1 / -1;
    font-size: var(--text-sm);
  }
  header p,
  footer p,
  .legality p {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .close {
    margin-left: auto;
  }
  .body {
    min-height: 0;
    overflow: auto;
  }
  .matrix {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas: "words words" "identity stats" "mechanics stats" "legality legality";
    gap: 0.55rem;
    padding: 0.65rem;
  }
  .group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.6rem;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 64%, transparent);
  }
  .words {
    grid-area: words;
  }
  .identity {
    grid-area: identity;
  }
  .stats {
    grid-area: stats;
  }
  .mechanics {
    grid-area: mechanics;
  }
  .legality {
    grid-area: legality;
  }
  label {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: 2rem;
    padding: 0.3rem 0.4rem;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-chain);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text);
  }
  .check input {
    width: auto;
    min-height: auto;
  }
  .stats {
    grid-template-columns: minmax(0, 1fr);
  }
  .stats h3,
  .stats .check {
    grid-column: 1;
  }
  footer p {
    margin-right: auto;
  }
  footer strong {
    color: var(--text);
  }
  @media (max-width: 1023.98px) {
    .matrix {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "words" "identity" "stats" "mechanics" "legality";
    }
  }
</style>
