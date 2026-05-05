// Unified Effect / Modifier model. Every "thing currently true about a
// character that changes their numbers" — backgrounds, perks, condition
// bands, future gear — is an Effect carrying a list of Modifiers on
// StatSheet stat ids. The StatSheet's modifier arrays are derived from
// `Effects.list`; addEffect/removeEffect rebuild the affected stats'
// arrays in one pass and bump `version` once.
//
// Why one model? Two parallel modifier engines (perkSync direct-write
// + an EffectModifier shape with extra "channels") would drift. Every
// channel reduces to a Modifier on a Stat once the catalog admits
// verb-speed / workPerfMul / floor / cap. Authors learn one DSL.
//
// See Design/characters/effects.md for the full data shape, banded-effect
// reconciler, and migration plan.

import type { Modifier } from './sheet'
import { type StatSheet, addModifier, removeBySource } from './sheet'
import type { StatId } from './schema'

export type EffectFamily = 'background' | 'perk' | 'condition' | 'gear'

export interface Effect {
  // Unique within a character's Effects list. Upstream owners pick the
  // format: 'bg:soldier', 'perk:long_distance', 'cond:c-7f3a:b0'.
  id: string
  // Back-reference the upstream system uses to find / clean up its own
  // Effects without scanning by id-prefix substring. Conditions set
  // this to instanceId; backgrounds set it to the background id.
  originId: string
  family: EffectFamily
  modifiers: { statId: StatId; type: Modifier<StatId>['type']; value: number }[]
  // Display metadata — none of these participate in the fold.
  nameZh?: string
  descZh?: string
  flavorZh?: string
  glyphRef?: string
  // Undiagnosed conditions on the player render anonymized; rendered as
  // 'condition' family with `hidden = true` until the clinic flips it.
  hidden?: boolean
  startedDay?: number
  expiresDay?: number | null
}

// Source string used for every Modifier this Effect produces on the
// StatSheet. Namespaced so removeBySource cleanly unwinds one Effect
// without touching siblings — the format must be unique per Effect id.
export function effectSource(e: Pick<Effect, 'id'>): string {
  return `eff:${e.id}`
}

// Apply every modifier on `effect` against `sheet` under the namespaced
// source. Idempotent: an existing Effect with the same id is removed
// first so re-applying a band is a no-op net change. Returns the new
// sheet (or the same reference if no work was needed).
export function applyEffectToSheet<S extends string>(
  sheet: StatSheet<S>,
  effect: Effect,
): StatSheet<S> {
  const source = effectSource(effect)
  let next = removeBySource(sheet, source)
  for (const m of effect.modifiers) {
    next = addModifier(next, {
      statId: m.statId as unknown as S,
      type: m.type,
      value: m.value,
      source,
    })
  }
  return next
}

export function removeEffectFromSheet<S extends string>(
  sheet: StatSheet<S>,
  effectId: string,
): StatSheet<S> {
  return removeBySource(sheet, effectSource({ id: effectId }))
}

// Rebuild the sheet's modifier arrays from a fresh Effect list, dropping
// any modifier whose source matches the `eff:*` namespace (so legacy
// `bg:*` / `perk:*` / `talent` / `drift` modifiers survive untouched
// during the migration window). After the bg/perk migration this still
// reads cleanly because legacy sources just won't exist on new saves.
export function rebuildSheetFromEffects<S extends string>(
  sheet: StatSheet<S>,
  effects: readonly Effect[],
): StatSheet<S> {
  let next = sheet
  // Strip every `eff:*` source on the sheet first.
  const stale = new Set<string>()
  for (const id of Object.keys(next.stats) as S[]) {
    for (const m of next.stats[id].modifiers) {
      if (m.source.startsWith('eff:')) stale.add(m.source)
    }
  }
  for (const src of stale) next = removeBySource(next, src)
  for (const e of effects) next = applyEffectToSheet(next, e)
  return next
}
