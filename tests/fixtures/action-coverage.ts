export const MVP_ACTION_FAMILIES = [
  "draw",
  "shuffle",
  "phase_change",
  "normal_summon",
  "tribute_summon",
  "special_summon",
  "flip_summon",
  "monster_set",
  "spell_trap_set",
  "activate",
  "chain",
  "pass",
  "target",
  "select",
  "position_change",
  "direct_attack",
  "monster_attack",
  "battle_damage",
  "effect_damage",
  "recovery",
  "destruction",
  "send_to_graveyard",
  "banish",
  "surrender",
] as const;

export const MVP_PROMPT_FAMILIES = [
  "idleCommand",
  "battleCommand",
  "yesNo",
  "effectYesNo",
  "option",
  "chain",
  "selectCard",
  "selectTribute",
  "selectSum",
  "selectUnselectCard",
  "selectPlace",
  "selectDisabledField",
  "selectPosition",
  "sortCard",
  "sortChain",
  "selectCounter",
  "announceNumber",
  "announceAttribute",
  "announceRace",
  "announceCard",
  "rockPaperScissors",
] as const;

export type MvpActionFamily = (typeof MVP_ACTION_FAMILIES)[number];
export type MvpPromptFamily = (typeof MVP_PROMPT_FAMILIES)[number];
export type MvpCoverageKey =
  `action:${MvpActionFamily}` | `prompt:${MvpPromptFamily}`;

export const MVP_REQUIRED_COVERAGE = Object.freeze([
  ...MVP_ACTION_FAMILIES.map(actionCoverageKey),
  ...MVP_PROMPT_FAMILIES.map(promptCoverageKey),
]);

export const EXECUTED_PROGRAMMED_COVERAGE: Readonly<
  Record<string, readonly MvpCoverageKey[]>
> = Object.freeze({
  "battle-and-chain": Object.freeze([
    "action:battle_damage",
    "action:direct_attack",
    "action:draw",
    "action:monster_attack",
    "action:normal_summon",
    "action:pass",
    "action:phase_change",
    "action:select",
    "action:send_to_graveyard",
    "prompt:battleCommand",
    "prompt:chain",
    "prompt:idleCommand",
    "prompt:selectCard",
    "prompt:selectPlace",
  ] satisfies readonly MvpCoverageKey[]),
  "surrender-at-opening": Object.freeze([
    "action:draw",
    "action:phase_change",
    "action:surrender",
  ] satisfies readonly MvpCoverageKey[]),
  "tribute-special-and-target": Object.freeze([
    "action:activate",
    "action:banish",
    "action:battle_damage",
    "action:direct_attack",
    "action:draw",
    "action:monster_attack",
    "action:monster_set",
    "action:normal_summon",
    "action:pass",
    "action:phase_change",
    "action:position_change",
    "action:recovery",
    "action:select",
    "action:send_to_graveyard",
    "action:special_summon",
    "action:spell_trap_set",
    "action:target",
    "action:tribute_summon",
    "prompt:battleCommand",
    "prompt:chain",
    "prompt:idleCommand",
    "prompt:selectCard",
    "prompt:selectPlace",
    "prompt:selectPosition",
    "prompt:selectTribute",
  ] satisfies readonly MvpCoverageKey[]),
  "effects-recovery-and-position": Object.freeze([
    "action:activate",
    "action:battle_damage",
    "action:chain",
    "action:destruction",
    "action:direct_attack",
    "action:draw",
    "action:effect_damage",
    "action:flip_summon",
    "action:monster_attack",
    "action:monster_set",
    "action:normal_summon",
    "action:pass",
    "action:phase_change",
    "action:position_change",
    "action:recovery",
    "action:select",
    "action:send_to_graveyard",
    "action:spell_trap_set",
    "prompt:battleCommand",
    "prompt:chain",
    "prompt:idleCommand",
    "prompt:selectCard",
    "prompt:selectPlace",
  ] satisfies readonly MvpCoverageKey[]),
  "shuffle-and-sort-chain": Object.freeze([
    "action:draw",
    "action:phase_change",
    "action:select",
    "action:shuffle",
    "prompt:battleCommand",
    "prompt:idleCommand",
    "prompt:selectPlace",
    "prompt:sortChain",
  ] satisfies readonly MvpCoverageKey[]),
  "real-wasm-prompt-matrix": Object.freeze([
    "action:draw",
    "action:phase_change",
    "action:select",
    "action:shuffle",
    "prompt:announceAttribute",
    "prompt:announceCard",
    "prompt:announceNumber",
    "prompt:announceRace",
    "prompt:effectYesNo",
    "prompt:option",
    "prompt:rockPaperScissors",
    "prompt:selectCounter",
    "prompt:selectDisabledField",
    "prompt:selectPlace",
    "prompt:selectPosition",
    "prompt:selectSum",
    "prompt:selectUnselectCard",
    "prompt:sortCard",
    "prompt:yesNo",
  ] satisfies readonly MvpCoverageKey[]),
} satisfies Readonly<Record<string, readonly MvpCoverageKey[]>>);

export function actionCoverageKey(
  family: MvpActionFamily,
): `action:${MvpActionFamily}` {
  return `action:${family}`;
}

export function promptCoverageKey(
  family: MvpPromptFamily,
): `prompt:${MvpPromptFamily}` {
  return `prompt:${family}`;
}

export function uncoveredProgrammedCoverage(): readonly MvpCoverageKey[] {
  const observed = new Set<MvpCoverageKey>(
    Object.values(EXECUTED_PROGRAMMED_COVERAGE).flat(),
  );
  return Object.freeze(
    MVP_REQUIRED_COVERAGE.filter((family) => !observed.has(family)),
  );
}
