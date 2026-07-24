# Narrative and Map Design

> Status: approved future design; not implemented

## Content principles

- Authored content is data, never executable code.
- Canonical source format is versioned JSON.
- Every document is exact-key, schema, size, reference, and semantic validated before activation.
- Runtime uses only validated immutable content objects.
- IDs are stable across compatible content revisions.
- Content errors fail pack validation with file path, JSON path, error code, and actionable message.

## Content layout

```text
content/
├── campaigns/<campaign-id>/campaign.json
├── scenes/<scene-id>.json
├── maps/<map-id>.json
├── encounters/<encounter-id>.json
├── characters/<character-id>.json
└── packs/<pack-id>/pack.json
```

Build output may shard or index these documents, but source ownership and IDs remain unchanged.

## Validation pipeline

```text
Read bounded JSON bytes
→ parse JSON
→ validate exact schema version + keys
→ validate ID syntax and uniqueness
→ validate declared campaign variables
→ type-check defaults, writes, comparisons, enum/range constraints
→ validate scene labels, jumps, choice IDs, and reachability
→ validate map positions, location IDs, destinations, and conditions
→ validate encounter, character, asset, and pack references
→ collect command/operator/media capabilities actually used
→ reject capabilities unsupported by target app runtime
→ detect dependency cycles
→ emit canonical immutable indexes + hashes
```

No content becomes active after partial validation.

## Campaign manifest

Campaign manifest declares:

- campaign ID and semantic content version;
- entry chapter and scene;
- chapter/objective definitions and map-entry cancellation policy for each flow context;
- typed variable declarations;
- reward IDs and semantics;
- map, encounter, scene, character, and pack roots;
- compatible app/content schema ranges;
- compatible duel snapshot range;
- required runtime capabilities actually used by pack, such as `narrative.audio.music.v1`;
- save/campaign migration chain identifiers that resolve only to reviewed app-owned pure migration functions; packs contain IDs/data, never executable migration code.

App build advertises implemented capability IDs. Pack activation rejects any required capability absent from running app. Recognized schema command is not executable merely because parser knows its shape.

### Variable declaration

```json
{
  "id": "prologue.alex.trust",
  "type": "number",
  "default": 0,
  "minimum": 0,
  "maximum": 10
}
```

Supported scalar types:

- `boolean`;
- finite `number` with optional integer/range constraint;
- bounded `string` with optional enum constraint.

Undeclared variable read/write is invalid. Runtime rejects wrong type, NaN/infinity, out-of-range value, and unknown enum value.

## Condition expressions

Use strict JSON expression AST. No `eval`, string code, arbitrary functions, prototype paths, or implicit coercion.

```json
{
  "op": "and",
  "operands": [
    {
      "op": "eq",
      "left": { "var": "prologue.duel.complete" },
      "right": { "literal": true }
    },
    {
      "op": "gte",
      "left": { "var": "prologue.alex.trust" },
      "right": { "literal": 2 }
    }
  ]
}
```

Allowlisted operators:

- literals and declared-variable lookup;
- `eq`, `neq` with same-type operands;
- numeric `lt`, `lte`, `gt`, `gte`;
- `in` against bounded literal sets of same scalar type;
- `and`, `or`, `not`;
- optional `all`/`any` only when schema can prove bounded input.

Short-circuit behavior is deterministic. Validation rejects incompatible operand types before runtime.

## Narrative runtime

Narrative is a deterministic cursor interpreter, independent of Svelte and browser APIs.

### Cursor

Checkpoint contains:

- scene ID + scene schema version;
- current command index and optional label;
- immutable presentation state;
- pause reason;
- current choice IDs if paused at choice;
- pending narrative intent ID if waiting for campaign result.

### Execution

- Start at entry command or validated checkpoint.
- Process commands until a visible/player/time/external boundary.
- Pause for explicit advance, choice, wait completion, external intent result, or scene completion.
- Never hide async work inside interpreter.
- A wait stores deterministic remaining duration; animations do not alter campaign state.
- Save is allowed while paused for advance or choice, not mid-wait/transition.
- On resume, reject stale choice/intent IDs.

## Target command inventory

First slice implements only used commands. Target schema recognizes all accepted command families from first version, but semantic validation records capabilities actually used. Pack activation rejects commands whose required runtime capability is not implemented by running app. First-slice prologue therefore cannot use reserved audio/effect commands until their capabilities land.

### Presentation

- `set-background`
- `show-character`
- `hide-character`
- `set-expression`
- `say`
- `narrate`
- `wait`
- `fade`
- `shake`
- `play-music`
- `stop-music`
- `play-sound`

### Choice and flow

- `choice`
- `if`
- `goto`
- `end`

### Campaign intents

- `set-variable`
- `adjust-variable`
- `give-reward`

### External intents

- `open-map`
- `start-battle`

Narrative does not save directly. Campaign/shell autosave at stable boundaries created by reduced intents and completed scenes.

## Example scene

```json
{
  "schemaVersion": 1,
  "id": "prologue.academy-arrival",
  "commands": [
    { "type": "set-background", "assetId": "bg.academy.gate" },
    {
      "type": "show-character",
      "characterId": "alex",
      "position": "right",
      "expression": "neutral"
    },
    {
      "type": "say",
      "speakerId": "alex",
      "text": "Welcome to the academy."
    },
    {
      "type": "choice",
      "id": "arrival-response",
      "options": [
        {
          "id": "accept",
          "text": "Let's begin.",
          "commands": [
            {
              "type": "adjust-variable",
              "variableId": "prologue.alex.trust",
              "amount": 1
            }
          ]
        },
        {
          "id": "hesitate",
          "text": "I need a moment.",
          "commands": []
        }
      ]
    },
    { "type": "open-map", "mapId": "prologue.academy" }
  ]
}
```

Nested choice commands must obey same schema and bounded-depth limit. Implementation may instead compile nested blocks into labels; canonical validation must produce one deterministic cursor model.

## Narrative presentation state

```text
NarrativeScreen
├── BackgroundLayer
├── CharacterLayer
├── EffectsLayer
├── DialogueBox
├── ChoiceList
├── NarrativeControls
└── Optional history/settings overlays
```

Svelte owns DOM semantics, controls, focus, live-region behavior, reduced motion, and image/audio error fallback. Narrative runtime owns no DOM refs or asset URLs.

First slice requires:

- background;
- at least one character/expression;
- dialogue/narration;
- one choice;
- keyboard/touch operation;
- visible focus;
- reduced-motion-safe transition;
- deterministic missing-asset fallback.

Auto-play, skip, backlog/history, voice, and rich text are later UX features. Their absence does not change cursor contract.

## Encounter model

Encounter content resolves campaign context into battle request plus authored outcome routing.

```ts
interface EncounterDefinition {
  readonly schemaVersion: number;
  readonly id: EncounterId;
  readonly battleSource:
    | {
        readonly type: "preset";
        readonly presetId: DuelPresetId;
        readonly expectedBuiltinDeck: Extract<DeckRevisionRef, { type: "builtin" }>;
      }
    | {
        readonly type: "selected-deck";
        readonly opponentConfigId: OpponentConfigId;
        readonly rules: BattleRulesConfig;
      };
  readonly outcomeScenes: {
    readonly playerWin: SceneId;
    readonly playerLoss: SceneId;
    readonly draw: SceneId | null;
  };
  readonly abortPolicy: "return-to-pre-battle" | "retry-or-return";
}
```

Rules:

- First slice uses exact current preset source.
- Selected-deck source is rejected until deck-capable battle runtime advertises support.
- Every outcome scene reference validates before pack activation.
- If selected battle source/runtime can emit draw, draw scene is required. If it cannot emit draw, draw scene must be null.
- `resolved` result starts matching outcome scene.
- `aborted` follows abort policy without win/loss progression.
- `failed` remains operational recovery; content cannot route technical failure as authored loss.
- Player surrender defaults to aborted unless a future reviewed encounter policy explicitly changes semantics.

## Map source model

Map content declares static facts and conditions, not evaluated availability.

```ts
interface SelectionMapDefinition {
  readonly schemaVersion: number;
  readonly id: MapId;
  readonly backgroundAssetId: AssetId;
  readonly objectiveText: string | null;
  readonly locations: readonly MapLocationDefinition[];
}

interface MapLocationDefinition {
  readonly id: LocationId;
  readonly name: string;
  readonly positionPercent: { readonly x: number; readonly y: number };
  readonly visibleWhen: ConditionExpression | null;
  readonly availableWhen: ConditionExpression | null;
  readonly completedWhen: ConditionExpression | null;
  readonly lockedReason: string | null;
  readonly destinationSceneId: SceneId;
  readonly marker: "story" | "battle" | "character" | "shop" | "event" | null;
}
```

Coordinates must be finite percentages from `0` through `100`. Content validator rejects duplicate IDs, out-of-range coordinates, missing destinations, and invalid condition types. Any location with non-null `availableWhen` must provide non-empty bounded `lockedReason`, ensuring every runtime locked location has explanation.

## Map evaluation

Completion and access are independent. Null semantics are explicit:

- `visibleWhen: null` → visible (`true`);
- `availableWhen: null` → available (`true`);
- `completedWhen: null` → not completed (`false`).

```text
completed = completedWhen_or_false

if visibleWhen_or_true is false:
  access = hidden
else if availableWhen_or_true is true:
  access = available
else:
  access = locked
```

Truth table:

| Access | Completed | Visible | Selectable |
|---|---:|---:|---:|
| hidden | either | no | no |
| locked | false/true | yes when design exposes it | no |
| available | false/true | yes | yes |

Campaign copies bounded authored `lockedReason` only for locked visible locations. Map feature cannot reevaluate conditions from raw variables.

## Map UI

```text
MapScreen
├── MapBackground
├── LocationHotspotLayer
├── MarkerLayer
├── ObjectivePanel
├── AccessibleLocationList
└── MapNavigation
```

Requirements:

- Hotspot and list activate same location ID.
- Hidden locations appear in neither interactive surface.
- Locked locations remain discoverable only when design supplies reason; they cannot activate.
- Completed styling is independent from selection; only `access === "available"` activates.
- Keyboard focus order follows authored location order, not absolute position.
- Hotspots have accessible name, state, and marker description.
- Location list is always present, not a mobile-only fallback.
- Mobile layout prevents map overflow and retains 44px targets.
- Background image has descriptive alternative or map heading/context.
- Campaign decides whether Back/Cancel exists.

## Map result

Map returns only tagged selection/cancellation. It never returns destination scene ID. Campaign revalidates current map/location availability, then resolves destination from validated content.

## Localization

First slice is English-only. Stable scene, speaker, choice, objective, and location IDs must permit later localization extraction. Inline English text is accepted for first slice; localization catalog format remains deferred and must be introduced through a versioned content migration, not ad hoc alternate fields.
