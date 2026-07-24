# Modules and Contracts

> Status: approved future design; contract sketches guide implementation and may gain fields only through reviewed schema changes

## Contract rules

- Owner domain defines each public contract once.
- Public entry point re-exports contract; consumers never copy it.
- Persisted, content, campaign, map, battle-request, result, and effect values are immutable, serializable, exact-key validated, and bounded.
- Main-thread UI lifecycle ports may contain DOM/AbortSignal values but never cross Worker, persistence, or content boundaries.
- IDs are opaque branded strings in implementation.
- Exhaustive discriminated unions use `assertNever`.
- Commands never carry executable content, raw engine values, seeds, deck order, startup scripts, or protocol indexes.

## Shared revision references

Each reference is owned by its domain and imported type-only through that domain public entry point.

```ts
type DuelSnapshotRef = Readonly<{
  runtimeSnapshotId: RuntimeSnapshotId;
  activationSnapshotId: ActivationSnapshotId;
  activeImageManifestSha256: string;
}>;

type PackRef = Readonly<{ id: PackId; version: string; sha256: string }>;
type PackSetRef = Readonly<{ id: PackSetId; packs: readonly PackRef[] }>;

type DeckRevisionRef =
  | Readonly<{ type: "builtin"; deckId: DeckId; revision: number }>
  | Readonly<{ type: "local"; deckId: DeckId; revision: number }>;

type CampaignCheckpointTarget =
  | Readonly<{ type: "manual"; slotKey: CampaignManualSlotKey }>
  | Readonly<{ type: "autosave"; streamKey: CampaignAutosaveStreamKey }>
  | Readonly<{ type: "pre-battle"; checkpointKey: CampaignCheckpointKey }>;

type CampaignCheckpointRef = Readonly<{
  checkpointKey: CampaignCheckpointKey;
  revision: number;
  kind: "manual" | "autosave" | "pre-battle";
}>;

type RuntimeCapabilities = Readonly<{
  appBuildId: string;
  appVersion: string;
  appSchemaVersion: number;
  contentSchemaVersions: readonly number[];
  app: readonly AppCapabilityId[];
  narrative: readonly NarrativeCapabilityId[];
  conditions: readonly ConditionCapabilityId[];
  deck: readonly DeckCapabilityId[];
  battle: Readonly<{
    drawOutcome: boolean;
    arbitraryDecks: boolean;
    presetIds: readonly DuelPresetId[];
  }>;
}>;
```

`DuelSnapshotRef` intentionally preserves current distinction between runtime snapshot, composite activation snapshot, and image-manifest digest. `CampaignCheckpointRef` is campaign-owned; SaveRepository maps it to physical slot storage without campaign importing save types.

## Campaign

```ts
type CampaignVariableValue = boolean | number | string;

type CampaignState = Readonly<{
  schemaVersion: number;
  sessionId: CampaignSessionId;
  effectGeneration: number;
  nextEffectSequence: number;
  stableRevision: number;
  lastAutosavedRevision: number;
  campaignId: CampaignId;
  campaignVersion: string;
  chapterId: ChapterId;
  objectiveIds: readonly ObjectiveId[];
  variables: Readonly<Record<CampaignVariableId, CampaignVariableValue>>;
  rewards: readonly RewardId[];
  narrative: NarrativeCheckpoint | null;
  currentMapId: MapId | null;
  selectedDeck: DeckRevisionRef;
  sessionPackSet: PackSetRef;
  duelSnapshot: DuelSnapshotRef;
  preBattleCheckpoint: CampaignCheckpointRef | null;
  deckRecovery: DeckRecoveryState | null;
  battleRecovery: BattleRecoveryState | null;
  pendingEffect: PendingCampaignEffect | null;
}>;

type PersistableCampaignState = Readonly<
  Omit<CampaignState, "pendingEffect"> & { pendingEffect: null }
>;

type CreateCampaignRequest = Readonly<{
  sessionId: CampaignSessionId;
  selectedDeck: DeckRevisionRef;
  sessionPackSet: PackSetRef;
  duelSnapshot: DuelSnapshotRef;
}>;

function createCampaign(
  content: ValidatedCampaignIndex,
  request: CreateCampaignRequest,
): CampaignState;

function reduceCampaign(
  content: ValidatedCampaignIndex,
  state: CampaignState,
  command: CampaignCommand,
): CampaignState;
```

Campaign state is sole source of effect truth. Reducer does not return a second effect copy. Every reducer call receives immutable validated content explicitly; no hidden registry or singleton is permitted.

New effect ID derives from persisted `sessionId`, `effectGeneration`, and `nextEffectSequence`, then increments sequence. `createCampaign` request supplies session ID; tests use fixed ID. Every save load/checkpoint restore increments `effectGeneration` before state becomes active, invalidating all pre-load completions. Retry retains effect ID and increments attempt only.

Checkpoint snapshot stores sequence after reserving persist effect ID. Generation bump on restore also prevents original post-checkpoint battle completion from matching replayed flow. Late completion from earlier effect, attempt, or loaded execution cannot collide.

`createCampaign` is sole New Game initializer. `CampaignCommand` applies only after state exists and includes:

- load/replace compatible state during explicit restore/migration flow;
- advance narrative;
- choose narrative option;
- select/cancel map;
- mark effect attempt started;
- complete effect attempt with typed domain result;
- report executor failure for effect attempt;
- retry failed effect;
- select deck revision;
- request manual save at stable state;
- schedule reducer-owned autosave for new stable revision;
- acknowledge reward/objective UI;
- retry battle recovery or return to durable pre-battle checkpoint;
- approve checkpoint migration and consume correlated old/new checkpoint result.

## Correlated effect lifecycle

```ts
type CampaignEffect =
  | Readonly<{ id: EffectId; type: "open-map"; request: OpenMapRequest }>
  | Readonly<{ id: EffectId; type: "run-battle"; request: BattleRequest }>
  | Readonly<{ id: EffectId; type: "persist-checkpoint"; request: PersistCheckpointRequest }>
  | Readonly<{ id: EffectId; type: "restore-checkpoint"; request: RestoreCheckpointRequest }>
  | Readonly<{ id: EffectId; type: "migrate-checkpoint"; request: MigrateCheckpointRequest }>
  | Readonly<{ id: EffectId; type: "resolve-deck"; request: ResolveDeckRequest }>
  | Readonly<{ id: EffectId; type: "install-packs"; request: InstallPacksIntent }>;

type PendingCampaignEffect = Readonly<{
  effect: CampaignEffect;
  attempt: number;
  status: "ready" | "running" | "failed";
  lastError: FeatureError | null;
}>;

type EffectDomainResult =
  | Readonly<{ effectType: "open-map"; value: MapResult }>
  | Readonly<{ effectType: "run-battle"; value: BattleFacadeResult }>
  | Readonly<{ effectType: "persist-checkpoint"; value: PersistCheckpointResult }>
  | Readonly<{ effectType: "restore-checkpoint"; value: RestoreCheckpointResult }>
  | Readonly<{ effectType: "migrate-checkpoint"; value: MigrateCheckpointResult }>
  | Readonly<{ effectType: "resolve-deck"; value: ResolveDeckResult }>
  | Readonly<{ effectType: "install-packs"; value: InstallPacksResult }>;

type EffectLifecycleCommand =
  | Readonly<{ type: "effect-started"; effectId: EffectId; attempt: number }>
  | Readonly<{
      type: "effect-completed";
      effectId: EffectId;
      attempt: number;
      result: EffectDomainResult;
    }>
  | Readonly<{
      type: "effect-execution-failed";
      effectId: EffectId;
      attempt: number;
      error: FeatureError;
    }>
  | Readonly<{ type: "retry-effect"; effectId: EffectId }>;
```

Lifecycle:

1. Reducer creates pending effect with `attempt: 1`, `status: "ready"`.
2. Shell sees transition to ready, dispatches `effect-started`, then invokes exactly one matching facade.
3. Normal feature outcomes—including map cancellation, battle abortion, and battle failure—return through `effect-completed` as typed domain results.
4. Thrown/transport/mount executor faults return through `effect-execution-failed`.
5. Retry keeps effect ID, increments attempt, clears error, and returns to ready.
6. Completion/failure with wrong effect ID, attempt, or effect-result type is rejected without state mutation.

One pending blocking effect maximum. `attempt` prevents a late result from an older retry being accepted.

Retry policy:

- battle, map, and persistence never auto-repeat;
- explicit user retry uses same effect ID and next attempt;
- idempotent content transfer may auto-retry transient sub-operations with bounded backoff inside one attempt;
- reward/variable mutation is internal reducer work, not an external effect.

```ts
type InstallPacksIntent = Readonly<{
  purpose: "session-dependency";
  requested: readonly PackRef[];
}>;
```

Shell adapts campaign `InstallPacksIntent` into exact content-owned `{ mode: "install-only", expectedDefault: null }` request plus current battle-readiness `DuelSnapshotRef` and composed `RuntimeCapabilities`. Campaign dependency install never changes New Game default. Bootstrap/update shell flows may separately request activate-default with non-null expected default CAS. Campaign never imports shell capability state.

## Autosave scheduling

Autosave is reducer-owned, not shell observation:

1. `stableRevision` is gameplay/progression revision, incremented only by durable narrative/map/battle-resolved/objective/reward/selection changes designated autosave-worthy.
2. If policy requires autosave and `stableRevision > lastAutosavedRevision`, reducer creates one `persist-checkpoint` effect.
3. Autosave `writeId` derives from campaign session + stable revision; rerender/repeated scheduling command cannot create duplicate write.
4. Autosave request snapshot sets its own `lastAutosavedRevision` to captured `stableRevision`, while live state remains unchanged until write succeeds. Committed save therefore does not reschedule same revision after load.
5. Successful checkpoint completion advances live `lastAutosavedRevision` to captured revision without incrementing `stableRevision`.
6. Failed autosave remains same pending effect for explicit retry; it does not mark live revision saved.
7. Effect status, retry, persistence completion, scheduler metadata, loading indicators, overlays, and diagnostics never increment `stableRevision`.
8. Load/restore preserves saved revisions and increments effect generation before any new scheduling.

## Durable pre-battle saga

Battle cannot dispatch until pre-battle checkpoint write succeeds.

```ts
type PersistCheckpointRequest =
  | Readonly<{
      writeId: CheckpointWriteId;
      target: Extract<CampaignCheckpointTarget, { type: "manual" | "autosave" }>;
      expectedRevision: number | null;
      snapshot: PersistableCampaignState;
      continuation: Readonly<{ type: "none" }>;
    }>
  | Readonly<{
      writeId: CheckpointWriteId;
      target: Extract<CampaignCheckpointTarget, { type: "pre-battle" }>;
      expectedRevision: number | null;
      snapshot: PersistableCampaignState;
      continuation: Readonly<{ type: "run-battle"; request: BattleRequest }>;
    }>;

type RestoreCheckpointRequest = Readonly<{
  checkpoint: CampaignCheckpointRef;
}>;

type RestoreCheckpointResult =
  | Readonly<{
      type: "ready";
      checkpoint: CampaignCheckpointRef;
      state: PersistableCampaignState;
    }>
  | Readonly<{ type: "missing-packs"; checkpoint: CampaignCheckpointRef; required: readonly PackRef[] }>
  | Readonly<{ type: "migration-required"; checkpoint: CampaignCheckpointRef; from: number; to: number }>
  | Readonly<{ type: "incompatible"; checkpoint: CampaignCheckpointRef; reason: string }>
  | Readonly<{ type: "corrupt"; checkpoint: CampaignCheckpointRef; reason: string }>
  | Readonly<{
      type: "deck-recovery";
      checkpoint: CampaignCheckpointRef;
      state: PersistableCampaignState;
      recovery: DeckRecoveryState;
    }>;

type MigrateCheckpointRequest = Readonly<{
  checkpoint: CampaignCheckpointRef;
  fromSchemaVersion: number;
  toSchemaVersion: number;
}>;

type MigrateCheckpointResult =
  | Readonly<{
      type: "ready";
      oldCheckpoint: CampaignCheckpointRef;
      newCheckpoint: CampaignCheckpointRef;
    }>
  | Readonly<{ type: "conflict"; checkpoint: CampaignCheckpointRef; currentRevision: number | null }>
  | Readonly<{ type: "failed"; checkpoint: CampaignCheckpointRef; reason: string }>;

type ResolveDeckRequest = Readonly<{
  selectedDeck: DeckRevisionRef;
  duelSnapshot: DuelSnapshotRef;
}>;

type ResolveDeckResult =
  | Readonly<{ type: "ready"; request: ResolveDeckRequest; deck: ValidatedDeckSnapshot }>
  | Readonly<{ type: "missing"; request: ResolveDeckRequest }>
  | Readonly<{
      type: "revision-mismatch";
      request: ResolveDeckRequest;
      actual: DeckRevisionRef;
    }>
  | Readonly<{ type: "invalid"; request: ResolveDeckRequest; reason: string }>;

type DeckRecoveryState = Exclude<ResolveDeckResult, { type: "ready" }>;

type PreBattleRecoveryMetadata = Readonly<{
  type: "interrupted-battle";
  request: BattleRequest;
}>;

type BattleRecoveryState =
  | Readonly<{
      type: "interrupted";
      request: BattleRequest;
      checkpoint: CampaignCheckpointRef;
    }>
  | Readonly<{
      type: "aborted";
      encounterId: EncounterId;
      reason: "pre-start-cancel" | "player-surrender" | "shell-exit";
      checkpoint: CampaignCheckpointRef;
    }>
  | Readonly<{
      type: "failed";
      encounterId: EncounterId;
      code: string;
      message: string;
      retryable: boolean;
      diagnosticRef: DiagnosticRef | null;
      checkpoint: CampaignCheckpointRef;
    }>;
```

Flow:

1. Start-battle narrative intent is validated.
2. Campaign reserves persist effect ID, increments sequence, copies stable pre-effect game state with `pendingEffect: null` plus advanced sequence, derives deterministic `writeId`, then creates `persist-checkpoint` effect with pre-battle kind and battle continuation.
3. Shell maps campaign checkpoint target to explicit save-owned manual/autosave/pre-battle target, writes request snapshot atomically using `writeId` as idempotency key and `expectedRevision` as conflict guard, and persists pre-battle recovery metadata from continuation; it never snapshots current running-effect state.
4. On `PersistCheckpointResult.ready`, reducer stores checkpoint ref and creates new `run-battle` effect.
5. Conflict/quota/invalid/storage-unavailable are normal typed domain outcomes; battle remains undispatched and UI offers policy-allowed retry/return. Unexpected thrown transport/implementation faults alone use executor-failed.
6. After resolved outcome and durable post-battle autosave, campaign may retire pre-battle recovery ref.
7. Aborted/failed result clears pending effect and stores serializable `battleRecovery` with checkpoint and retry/return commands.
8. Return command creates `restore-checkpoint` effect; shell preserves checkpoint identity and every save/content compatibility outcome in `RestoreCheckpointResult`. Reducer restores only `ready` with exact ref, increments effect generation, and rejects mismatched ref.
9. `migration-required` remains recovery state. User-approved command creates correlated `migrate-checkpoint` effect. Shell maps to checkpoint-targeted SaveRepository migration. Ready result must carry old + new refs; reducer verifies old ref, replaces stored checkpoint, then creates new restore effect targeting new ref. Conflict/failure never retries old ref silently.
10. Loading envelope with pre-battle recovery metadata restores stable state plus `battleRecovery: interrupted`; UI offers Retry (revalidate request/deck/snapshot then checkpoint/battle flow) or Return without pretending battle result occurred.
11. Lost completion/reload remains safe because same `writeId` is idempotent and checkpoint snapshot contains no pending persistence effect.

Selected-deck encounter adds prerequisite:

1. Campaign emits `resolve-deck` for current `DeckRevisionRef`.
2. Shell loads through built-in provider or local DeckRepository and validates against pinned duel snapshot.
3. Shell returns `ResolveDeckResult`; campaign proceeds only for `ready` when request and deck ref exactly equal pending request. Missing, revision-mismatch, and invalid clear pending effect into serializable `deckRecovery`; retry/reselect commands survive save/load.
4. Campaign builds immutable `DeckBattleRequest`, then begins durable pre-battle saga above.
5. Missing, changed, or invalid deck leaves battle undispatched and enters explicit recovery/reselection UI.

Preset encounter skips resolve-deck only when canonical encounter requires exact built-in ref and battle facade validates it against built-in provider.

## Narrative

```ts
type NarrativeCheckpoint = Readonly<{
  sceneId: SceneId;
  sceneVersion: number;
  commandIndex: number;
  label: string | null;
  state: NarrativeState;
  pause:
    | Readonly<{ type: "advance" }>
    | Readonly<{ type: "choice"; choiceIds: readonly ChoiceId[] }>
    | Readonly<{ type: "wait"; remainingMs: number }>
    | Readonly<{ type: "intent"; intentId: NarrativeIntentId }>
    | Readonly<{ type: "complete" }>;
}>;

type NarrativeStepResult = Readonly<{
  checkpoint: NarrativeCheckpoint;
  intent: NarrativeIntent | null;
}>;

type NarrativeIntentResult =
  | Readonly<{ intentId: NarrativeIntentId; type: "accepted" }>
  | Readonly<{ intentId: NarrativeIntentId; type: "cancelled" }>
  | Readonly<{ intentId: NarrativeIntentId; type: "rejected"; reason: string }>;
```

```ts
interface NarrativeRuntime {
  start(scene: ValidatedScene, initial?: NarrativeCheckpoint): NarrativeStepResult;
  advance(scene: ValidatedScene, checkpoint: NarrativeCheckpoint): NarrativeStepResult;
  choose(scene: ValidatedScene, checkpoint: NarrativeCheckpoint, choiceId: ChoiceId): NarrativeStepResult;
  completeWait(scene: ValidatedScene, checkpoint: NarrativeCheckpoint): NarrativeStepResult;
  resume(scene: ValidatedScene, checkpoint: NarrativeCheckpoint, result: NarrativeIntentResult): NarrativeStepResult;
}
```

Narrative intents are typed requests to campaign, not gateway calls:

```ts
type NarrativeIntent =
  | { id: NarrativeIntentId; type: "set-variable"; variableId: CampaignVariableId; value: CampaignVariableValue }
  | { id: NarrativeIntentId; type: "adjust-variable"; variableId: CampaignVariableId; amount: number }
  | { id: NarrativeIntentId; type: "give-reward"; rewardId: RewardId }
  | { id: NarrativeIntentId; type: "open-map"; mapId: MapId }
  | { id: NarrativeIntentId; type: "start-battle"; encounterId: EncounterId };
```

- Internal variable/reward intents resume with `accepted` after campaign validation/reduction.
- Selected map location starts its validated destination scene; cancelled map resumes original scene after `open-map`.
- Resolved battle starts encounter outcome scene.
- Aborted battle uses encounter abort policy; default returns to pre-battle checkpoint without progression.
- Failed battle remains operational recovery state and never resumes a success/loss branch.

## Map

```ts
type EvaluatedMapLocationBase = Readonly<{
  id: LocationId;
  name: string;
  positionPercent: Readonly<{ x: number; y: number }>;
  completed: boolean;
  marker: "story" | "battle" | "character" | "shop" | "event" | null;
}>;

type EvaluatedMapLocation = EvaluatedMapLocationBase &
  (
    | Readonly<{ access: "hidden"; lockedReason: null }>
    | Readonly<{ access: "locked"; lockedReason: string }>
    | Readonly<{ access: "available"; lockedReason: null }>
  );

type EvaluatedMapView = Readonly<{
  id: MapId;
  backgroundAssetId: AssetId;
  objectiveText: string | null;
  locations: readonly EvaluatedMapLocation[];
}>;

type OpenMapRequest = Readonly<{
  map: EvaluatedMapView;
  cancellable: boolean;
}>;

type MapResult =
  | Readonly<{ type: "selected"; mapId: MapId; locationId: LocationId }>
  | Readonly<{ type: "cancelled"; mapId: MapId }>;
```

Map rejects interaction unless `access === "available"`. `completed` is independent, so completed location may be available or locked. Campaign derives `cancellable`, revalidates selected map/location, and resolves destination.

## Encounters

`EncounterDefinition` has one canonical owner: validated content schema in [`04-narrative-and-map-design.md`](04-narrative-and-map-design.md). Campaign imports that public validated type; battle does not define or parse authored encounter documents.

Technical failure has no authored outcome scene. Validation checks every configured scene. If selected battle source can emit draw, `outcomeScenes.draw` is required. If runtime cannot emit draw, draw route must be null and any pack requiring draw capability is rejected.

## Battle facade

```ts
type PresetBattleRequest = Readonly<{
  type: "preset";
  encounterId: EncounterId;
  presetId: DuelPresetId;
  expectedPlayerDeck: Extract<DeckRevisionRef, { type: "builtin" }>;
  duelSnapshot: DuelSnapshotRef;
}>;

type DeckBattleRequest = Readonly<{
  type: "deck";
  encounterId: EncounterId;
  opponentConfigId: OpponentConfigId;
  playerDeck: ValidatedDeckSnapshot;
  rules: BattleRulesConfig;
  duelSnapshot: DuelSnapshotRef;
}>;

type BattleRequest = PresetBattleRequest | DeckBattleRequest;
type BattleResolvedOutcome = "player-win" | "player-loss" | "draw";

type BattleFacadeResult =
  | Readonly<{
      type: "resolved";
      encounterId: EncounterId;
      outcome: BattleResolvedOutcome;
      finishReason: BattleFinishReason;
      diagnosticRef: DiagnosticRef | null;
    }>
  | Readonly<{
      type: "aborted";
      encounterId: EncounterId;
      reason: "pre-start-cancel" | "player-surrender" | "shell-exit";
      diagnosticRef: DiagnosticRef | null;
    }>
  | Readonly<{
      type: "failed";
      encounterId: EncounterId;
      error: BattleFacadeError;
      retryable: boolean;
      diagnosticRef: DiagnosticRef | null;
    }>;

interface BattleSessionHandle {
  readonly completion: Promise<BattleFacadeResult>;
  dispose(): Promise<void>;
}

type BattleCapabilities = Readonly<{
  drawOutcome: boolean;
  arbitraryDecks: boolean;
  presetIds: readonly DuelPresetId[];
}>;

type BattleReadinessRequest = Readonly<{
  requiredSnapshot: DuelSnapshotRef | null;
}>;

type BattleReadiness =
  | Readonly<{
      type: "ready";
      selectedSnapshot: DuelSnapshotRef;
      defaultActiveSnapshot: DuelSnapshotRef;
      fallbackSnapshot: DuelSnapshotRef | null;
      capabilities: BattleCapabilities;
    }>
  | Readonly<{
      type: "unavailable";
      requiredSnapshot: DuelSnapshotRef | null;
      reason: string;
      recoverable: boolean;
    }>;

interface BattleFacade {
  readiness(request: BattleReadinessRequest, signal?: AbortSignal): Promise<BattleReadiness>;
  mount(
    host: HTMLElement,
    request: BattleRequest,
    signal: AbortSignal,
  ): BattleSessionHandle;
}
```

Interactive ownership:

- Facade mounts and owns complete current battle screen.
- Battle screen internally owns prompt loop, surrender confirmation, result screen, restart, diagnostics download, image retry, and field retry.
- Restart replaces current Worker/session inside same facade invocation; it does not settle campaign completion.
- Result screen gains explicit Continue/Return action that settles normalized result.
- Facade unmounts and disposes Worker/session/UI/image refs before `completion` resolves.
- AbortSignal or idempotent `dispose()` always settles completion exactly once after cleanup: `aborted/shell-exit` when cleanup succeeds, `failed` with cleanup error when certainty is lost.
- Completion never rejects or remains pending after teardown.
- Shell uses `dispose()` only for explicit teardown; it never drives prompts/restart/diagnostics.

Request rules:

- Battle readiness is only public source for snapshot refs and capabilities. New Game passes `requiredSnapshot: null` and receives selected default/fallback. Save/load passes exact saved ref; readiness returns ready only when exact runtime + activation + image digest is available, otherwise typed unavailable. Shell never deep-imports snapshot storage.
- Phase 1/first slice accepts only exact built-in `preset` request matching current preset, built-in deck revision provider, and readiness snapshot; mismatches fail before mount.
- `deck` request is unavailable until arbitrary validated deck support lands in deck-editor phase.
- Worker never loads campaign/deck repositories.
- No request exposes deterministic/test seams.

Result rules:

- Keep raw `DuelResult` and Worker events private.
- Exhaustively map numeric/core finish reasons into stable `BattleFinishReason`.
- Engine/Worker/content failure maps to `failed`, never `player-loss`.
- Default player surrender maps to `aborted/player-surrender`.
- `draw` remains target contract. Before any encounter uses it, Worker/result projection must advertise and test draw support; otherwise content validator rejects draw routing.

## Decks

```ts
type DeckRecord = Readonly<{
  schemaVersion: number;
  id: DeckId;
  revision: number;
  name: string;
  main: readonly CardCode[];
  extra: readonly CardCode[];
  side: readonly CardCode[];
  createdAt: string;
  updatedAt: string;
  validation: DeckValidationSummary;
}>;

type ValidatedDeckSnapshot = Readonly<{
  ref: DeckRevisionRef;
  name: string;
  main: readonly CardCode[];
  extra: readonly CardCode[];
  side: readonly CardCode[];
  validationDigest: string;
}>;

interface BuiltinDeckProvider {
  load(ref: Extract<DeckRevisionRef, { type: "builtin" }>): ValidatedDeckSnapshot | null;
}

interface DeckRepository {
  list(): Promise<readonly DeckRecord[]>;
  load(ref: Extract<DeckRevisionRef, { type: "local" }>): Promise<DeckRecord | null>;
  save(expectedRevision: number | null, deck: DeckRecord): Promise<DeckRecord>;
  delete(ref: Extract<DeckRevisionRef, { type: "local" }>): Promise<void>;
}

interface YdkAdapter {
  import(text: string): DeckRecordDraft;
  export(deck: DeckRecord): string;
}
```

First slice uses versioned built-in provider, so save compatibility can validate selected deck before local repository exists. Later local writes use optimistic revision checks and atomic IndexedDB transactions. Validation never mutates deck silently.

## Saves

```ts
type SaveWriteTarget =
  | Readonly<{ type: "manual"; slotId: SaveSlotId }>
  | Readonly<{ type: "autosave"; streamId: AutosaveStreamId }>
  | Readonly<{ type: "pre-battle"; checkpointKey: CampaignCheckpointKey }>;

interface SaveTargetAdapter {
  toSaveTarget(target: CampaignCheckpointTarget): SaveWriteTarget;
}

type SaveSummary = Readonly<{
  slotId: SaveSlotId;
  revision: number;
  kind: "manual" | "autosave" | "pre-battle";
  updatedAt: string;
  campaignId: CampaignId;
  chapterId: ChapterId;
}>;

type GameSaveEnvelopeBase = Readonly<{
  schemaVersion: number;
  slotId: SaveSlotId;
  revision: number;
  createdAt: string;
  updatedAt: string;
  checkpointKey: CampaignCheckpointKey;
  state: PersistableCampaignState;
  checksum: string;
}>;

type GameSaveEnvelope = GameSaveEnvelopeBase &
  (
    | Readonly<{ kind: "manual" | "autosave"; recovery: null }>
    | Readonly<{ kind: "pre-battle"; recovery: PreBattleRecoveryMetadata }>
  );

type SaveReadResult =
  | { type: "ready"; save: GameSaveEnvelope }
  | {
      type: "migration-required";
      slotId: SaveSlotId;
      revision: number;
      from: number;
      to: number;
    }
  | { type: "incompatible-save-schema"; reason: string }
  | { type: "corrupt"; reason: string };

type SaveMigrationTarget =
  | Readonly<{ type: "slot"; slotId: SaveSlotId; expectedRevision: number }>
  | Readonly<{ type: "checkpoint"; checkpoint: CampaignCheckpointRef }>;

type SaveMigrationRequest = Readonly<{
  target: SaveMigrationTarget;
  fromSchemaVersion: number;
  toSchemaVersion: number;
}>;

type SaveMigrationResult =
  | Readonly<{
      type: "ready-slot";
      target: Extract<SaveMigrationTarget, { type: "slot" }>;
      read: SaveReadResult;
      updatedCheckpoint: null;
    }>
  | Readonly<{
      type: "ready-checkpoint";
      target: Extract<SaveMigrationTarget, { type: "checkpoint" }>;
      read: SaveReadResult;
      updatedCheckpoint: CampaignCheckpointRef;
    }>
  | Readonly<{ type: "conflict"; currentRevision: number | null }>;

type SaveWriteRequest =
  | Readonly<{
      writeId: CheckpointWriteId;
      target: Extract<SaveWriteTarget, { type: "manual" | "autosave" }>;
      expectedRevision: number | null;
      state: PersistableCampaignState;
      recovery: null;
    }>
  | Readonly<{
      writeId: CheckpointWriteId;
      target: Extract<SaveWriteTarget, { type: "pre-battle" }>;
      expectedRevision: number | null;
      state: PersistableCampaignState;
      recovery: PreBattleRecoveryMetadata;
    }>;

type SaveWriteResult = Readonly<{
  save: GameSaveEnvelope;
  checkpoint: CampaignCheckpointRef;
}>;

type PersistCheckpointResult =
  | Readonly<{ type: "ready"; value: SaveWriteResult }>
  | Readonly<{ type: "conflict"; currentRevision: number | null }>
  | Readonly<{ type: "quota"; requiredBytes: number; availableBytes: number | null }>
  | Readonly<{ type: "invalid"; reason: string }>
  | Readonly<{ type: "storage-unavailable"; reason: string }>;

interface SaveRepository extends PackRetentionSource {
  list(): Promise<readonly SaveSummary[]>;
  load(slotId: SaveSlotId): Promise<SaveReadResult>;
  loadCheckpoint(ref: CampaignCheckpointRef): Promise<SaveReadResult>;
  migrate(request: SaveMigrationRequest): Promise<SaveMigrationResult>;
  write(request: SaveWriteRequest): Promise<PersistCheckpointResult>;
  delete(slotId: SaveSlotId): Promise<void>;
  deleteCheckpoint(ref: CampaignCheckpointRef): Promise<void>;
}

type GameLoadResult =
  | Readonly<{ type: "ready"; state: PersistableCampaignState }>
  | Readonly<{
      type: "interrupted-battle";
      state: PersistableCampaignState;
      recovery: PreBattleRecoveryMetadata;
      checkpoint: CampaignCheckpointRef;
    }>
  | Readonly<{ type: "missing-packs"; required: readonly PackRef[] }>
  | Readonly<{
      type: "deck-recovery";
      state: PersistableCampaignState;
      recovery: DeckRecoveryState;
    }>
  | Readonly<{
      type: "migration-required";
      save: Extract<SaveReadResult, { type: "migration-required" }>;
    }>
  | Readonly<{ type: "incompatible"; reason: string }>
  | Readonly<{ type: "corrupt"; reason: string }>;
```

Shell adapts campaign target explicitly:

- manual `slotKey` maps one-to-one through save UI adapter to chosen `SaveSlotId`;
- autosave `streamKey` maps to repository-owned bounded rotating `AutosaveStreamId`;
- pre-battle key maps to dedicated checkpoint target.

Adapter copies write identity, expected revision, exact stable snapshot, and pre-battle recovery metadata from battle continuation. Repository never guesses manual slot. Every envelope persists `checkpointKey`; key + envelope revision + kind reconstruct exact `CampaignCheckpointRef` for interrupted load. Repository deduplicates repeated `writeId` and returns same committed checkpoint after lost completion. `loadCheckpoint` verifies key + revision + kind before returning; no latest-slot substitution.

Campaign ID/version, session pack set, duel snapshot, and selected deck have one authority: `state`. Save summaries derive indexes from state at write time. Any persisted index/state mismatch is corruption.

- Atomic writes only.
- Pure explicit migration registry. `migrate` checks exact target revision/from/to; stale revision returns typed conflict. Ready writes migrated envelope atomically as next revision, then returns revalidated read result. Checkpoint-targeted migration returns new `updatedCheckpoint`; restore flow must replace old ref before continuing.
- No silent field dropping, default substitution, deck revision substitution, or content coercion.
- SaveRepository owns envelope/checksum/schema/migration validation only; it does not inspect installed content or battle storage.
- Shell sequences successful save read through battle readiness, ContentManager pack-set check, deck revision validation, then campaign load/restore.
- Missing compatible packs produce ContentManager install path.
- Unsupported migration blocks load with actionable reason.

## Campaign/content migration

Save-envelope schema migration above cannot change campaign semantics or pack set. Campaign owns separate trusted pure migration planner:

```ts
type CampaignContentMigrationRequest = Readonly<{
  sourceState: PersistableCampaignState;
  targetCampaign: ValidatedCampaignIndex;
  targetPackSet: PackSetRef;
  duelSnapshot: DuelSnapshotRef;
  runtimeCapabilities: RuntimeCapabilities;
}>;

type CampaignContentMigrationResult =
  | Readonly<{
      type: "ready";
      state: PersistableCampaignState;
      targetPackSet: PackSetRef;
      appliedMigrationIds: readonly CampaignMigrationId[];
    }>
  | Readonly<{ type: "missing-packs"; required: readonly PackRef[] }>
  | Readonly<{ type: "unsupported"; reason: string }>
  | Readonly<{ type: "invalid-result"; reason: string }>;

interface CampaignMigrationPlanner {
  migrate(request: CampaignContentMigrationRequest): CampaignContentMigrationResult;
}
```

Migration functions are reviewed TypeScript in campaign domain, keyed by manifest migration-chain IDs; story packs never supply executable migrations. Shell checks/installs target packs, runs pure planner, validates complete migrated state against target campaign, then SaveRepository atomically writes new envelope revision containing state + target pack ref together. Original save remains until success. Unsupported path blocks load without coercion.

## Content and assets

```ts
type ContentStatus = Readonly<{
  defaultActive: PackSetRef | null;
  fallback: PackSetRef | null;
  generation: number;
}>;

type PackInstallMode = "install-only" | "activate-default";

type InstallPacksRequestBase = Readonly<{
  requested: readonly PackRef[];
  duelSnapshot: DuelSnapshotRef;
  runtimeCapabilities: RuntimeCapabilities;
}>;

type InstallPacksRequest = InstallPacksRequestBase &
  (
    | Readonly<{ mode: "install-only"; expectedDefault: null }>
    | Readonly<{
        mode: "activate-default";
        expectedDefault: Readonly<{ id: PackSetId | null; generation: number }>;
      }>
  );

type InstallPacksResult =
  | Readonly<{
      type: "ready";
      mode: PackInstallMode;
      packSet: PackSetRef;
      status: ContentStatus;
    }>
  | Readonly<{ type: "cancelled" }>
  | Readonly<{ type: "network-failed"; message: string; retryable: boolean }>
  | Readonly<{ type: "quota"; requiredBytes: number; availableBytes: number | null }>
  | Readonly<{ type: "verification-failed"; path: string; reason: string }>
  | Readonly<{ type: "incompatible"; reason: string }>
  | Readonly<{ type: "activation-conflict"; current: ContentStatus }>;

type CheckPackSetRequest = Readonly<{
  packSet: PackSetRef;
  duelSnapshot: DuelSnapshotRef;
  runtimeCapabilities: RuntimeCapabilities;
}>;

type PackSetCheckResult =
  | Readonly<{ type: "ready"; packSet: PackSetRef }>
  | Readonly<{ type: "missing"; required: readonly PackRef[] }>
  | Readonly<{ type: "incompatible"; reason: string }>;

interface StagedContentReader {
  readonly packSet: PackSetRef;
  listPaths(): Promise<readonly string[]>;
  read(path: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>;
}

type ValidatedContentSet = Readonly<{
  packSet: PackSetRef;
  manifestDigest: string;
  campaigns: ReadonlyMap<CampaignId, ValidatedCampaignIndex>;
  scenes: ReadonlyMap<SceneId, ValidatedScene>;
  maps: ReadonlyMap<MapId, ValidatedMapDefinition>;
  encounters: ReadonlyMap<EncounterId, EncounterDefinition>;
}>;

type ContentValidationResult =
  | Readonly<{ type: "valid"; content: ValidatedContentSet }>
  | Readonly<{ type: "invalid"; path: string; jsonPath: string; reason: string }>;

interface ContentValidationPort {
  validate(
    reader: StagedContentReader,
    runtimeCapabilities: RuntimeCapabilities,
    duelSnapshot: DuelSnapshotRef,
    signal: AbortSignal,
  ): Promise<ContentValidationResult>;
}

type RuntimePackLease = Readonly<{
  leaseId: RuntimePackLeaseId;
  clientLeaseId: ContentClientLeaseId;
  ownerId: ContentLeaseOwnerId;
  packSet: PackSetRef;
  revision: number;
  expiresAt: string;
}>;

interface RuntimePackLeaseRegistry {
  acquire(
    clientLeaseId: ContentClientLeaseId,
    ownerId: ContentLeaseOwnerId,
    packSet: PackSetRef,
  ): Promise<RuntimePackLease>;
  heartbeat(lease: RuntimePackLease): Promise<RuntimePackLease>;
  release(lease: RuntimePackLease): Promise<void>;
  listLive(now: string): Promise<readonly RuntimePackLease[]>;
}

type PackRetentionSnapshot = Readonly<{
  generation: number;
  packSets: readonly PackSetRef[];
}>;

interface PackRetentionSource {
  inspectRetention(): Promise<PackRetentionSnapshot>;
}

type RemovePackResult =
  | Readonly<{ type: "ready"; status: ContentStatus }>
  | Readonly<{ type: "protected"; owners: readonly string[] }>
  | Readonly<{ type: "conflict"; current: ContentStatus }>
  | Readonly<{ type: "not-found" }>;

type RollbackPacksResult =
  | Readonly<{ type: "ready"; status: ContentStatus }>
  | Readonly<{ type: "conflict"; current: ContentStatus }>
  | Readonly<{ type: "unavailable"; reason: string }>;

interface ContentManagerFactory {
  create(validation: ContentValidationPort): ContentManager;
}

interface ContentManager {
  inspect(): Promise<ContentStatus>;
  checkInstalled(request: CheckPackSetRequest): Promise<PackSetCheckResult>;
  loadValidated(packSet: PackSetRef): Promise<ValidatedContentSet | null>;
  install(request: InstallPacksRequest, signal: AbortSignal): Promise<InstallPacksResult>;
  rollback(expectedActiveId: PackSetId, expectedGeneration: number): Promise<RollbackPacksResult>;
  remove(
    pack: PackRef,
    expectedGeneration: number,
    saveSources: readonly PackRetentionSource[],
  ): Promise<RemovePackResult>;
  readonly runtimeLeases: RuntimePackLeaseRegistry;
  collectGarbage(saveSources: readonly PackRetentionSource[]): Promise<void>;
  subscribe(listener: (progress: ContentProgress) => void): () => void;
}

interface AssetHandle {
  readonly assetId: AssetId;
  readonly pack: PackRef;
  readonly url: string;
  dispose(): void;
}

interface AssetResolver {
  resolve(assetId: AssetId, packSet: PackSetRef, signal?: AbortSignal): Promise<AssetHandle>;
}
```

`install` always stages immutable bytes, verifies, and validates before commit. Discriminated request forbids CAS expectation on install-only and requires it on activate-default. `install-only` records installed set without changing global default/fallback pointers. `activate-default` atomically updates default/fallback; stale conflict returns typed result without pointer mutation. Missing save dependency always uses install-only, then `checkInstalled`; it cannot silently change New Game default. Rollback compares expected active ID + generation and returns typed ready/conflict/unavailable result.

`checkInstalled` is content-owned path for arbitrary save/session pinned set and returns exact missing/incompatible status. During staging, ContentManager supplies bounded reader over exact staged bytes to injected content-owned validation port composed from campaign/narrative/map/encounter pure public validators. Only returned immutable `ValidatedContentSet` may commit; `loadValidated(exact PackSetRef)` exposes same validated indexes for `createCampaign`/runtime without hidden storage coupling or refetch. ContentManager imports no feature implementation. `install` validates app semantic version/schema range plus pack-required capabilities against immutable `RuntimeCapabilities` composed by shell from app, narrative, condition, battle, and deck domain capability exports.

ContentManager's `defaultActive` is installation-global default for New Game/load selection. Each campaign session copies and pins `sessionPackSet`; global update never mutates running session. Saves pin session set.

Each running tab acquires unique content-owned client/owner lease IDs, not campaign/PWA domain types or persisted campaign session alone. Shell maps its client/session IDs into opaque content IDs at boundary. Heartbeat extends expiry; normal close releases; expired leases are cleaned after bounded grace. Two tabs loading same save therefore hold independent protection without content importing campaign/PWA contracts.

Save envelopes are themselves atomic retention source: SaveRepository implements `PackRetentionSource` by reading committed envelopes. No duplicate save-retention mutation exists.

All SaveRepository write/delete/migrate commits, runtime-lease acquire/heartbeat/release/expiry cleanup, default/fallback install activation/rollback, manual pack removal, and ContentManager garbage collection acquire same cross-tab exclusive retention Web Lock. Removal and GC hold lock while rescanning default/fallback + leases + save sources through deletion; protected pack returns typed result and no new protected reference/pointer can commit in that interval. Relevant generations increment on mutation and are logged/tested.

Asset handles are revision-bound and disposable. Resolver cannot download, activate, remove, or mutate packs.

## PWA update coordinator

```ts
type AppUpdateState =
  | { type: "current" }
  | { type: "downloaded"; version: string }
  | { type: "blocked-by-client"; version: string; clientCount: number }
  | { type: "activating"; version: string }
  | { type: "failed"; message: string };

type ClientSafetyState = Readonly<{
  clientId: PwaClientId;
  buildId: string;
  stateVersion: number;
  safe: boolean;
  reason:
    | "stable"
    | "battle"
    | "save"
    | "content-staging"
    | "content-activation"
    | "snapshot-activation"
    | "pending-effect"
    | "transient-ui";
}>;

type UpdateActivationLease = Readonly<{
  updateVersion: string;
  nonce: string;
  expiresAt: string;
  clientIds: readonly PwaClientId[];
}>;

type UnsafeOperationKind =
  | "battle"
  | "save"
  | "content-staging"
  | "content-activation"
  | "snapshot-activation"
  | "campaign-effect"
  | "transient-ui";

type UnsafeOperationPermit = Readonly<{
  id: UnsafeOperationPermitId;
  kind: UnsafeOperationKind;
}>;

interface UnsafeOperationGate {
  tryBegin(kind: UnsafeOperationKind): UnsafeOperationPermit | null;
  end(permit: UnsafeOperationPermit): void;
  readonly frozenForUpdate: boolean;
}

interface PwaUpdateCoordinator {
  readonly operations: UnsafeOperationGate;
  subscribe(listener: (state: AppUpdateState) => void): () => void;
  publishSafety(state: ClientSafetyState): void;
  requestActivationAtSafeBoundary(): Promise<"activated" | "blocked">;
}
```

Activation protocol:

1. Coordinator broadcasts prepare request with update version + nonce.
2. Every controlled client can grant lease only when operation gate has no active permits; granting atomically freezes gate so synchronous `tryBegin` rejects every `UnsafeOperationKind`: battle, save, content staging, content activation, duel snapshot activation, campaign effect, and transient UI.
3. Missing, stale, unsafe, or changed client response blocks activation.
4. Service Worker performs final nonce/version/client-set CAS immediately before `skipWaiting`.
5. Any lease expiry or client-set change aborts request and releases leases.
6. Lease failure/expiry unfreezes every gate; successful activation keeps gates frozen through reload and old caches remain while old-build client exists.

A second tab in battle therefore blocks activation without a race between safe report and new unsafe work.
