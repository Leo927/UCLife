// Entity-facing Effect API. Each helper round-trips the Effects trait
// list AND the Attributes sheet's modifier arrays so the two stay in
// sync without any caller having to remember the dual write. The
// StatSheet is the fold of every active Effect; addEffect / removeEffect
// are the only sanctioned write paths once a character is set up.

import type { Entity } from 'koota'
import { Attributes, Effects } from '../ecs/traits'
import {
  applyEffectToSheet, removeEffectFromSheet, type Effect,
} from '../stats/effects'

// Idempotent: an existing Effect with the same id is replaced. Returns
// true on success, false if the entity lacks the required traits.
export function addEffect(entity: Entity, effect: Effect): boolean {
  if (!entity.has(Attributes)) return false
  if (!entity.has(Effects)) entity.add(Effects)
  const current = entity.get(Effects)!
  const filtered = current.list.filter((e) => e.id !== effect.id)
  entity.set(Effects, { list: [...filtered, effect] })
  const a = entity.get(Attributes)!
  entity.set(Attributes, { ...a, sheet: applyEffectToSheet(a.sheet, effect) })
  return true
}

// Removes the Effect with the matching id; no-op if not present.
export function removeEffect(entity: Entity, effectId: string): boolean {
  if (!entity.has(Effects)) return false
  const current = entity.get(Effects)!
  const next = current.list.filter((e) => e.id !== effectId)
  if (next.length === current.list.length) return false
  entity.set(Effects, { list: next })
  const a = entity.get(Attributes)
  if (a) {
    entity.set(Attributes, { ...a, sheet: removeEffectFromSheet(a.sheet, effectId) })
  }
  return true
}

// Removes every Effect whose originId matches. Useful for tearing down
// every band of a single condition instance, or every modifier from a
// background being un-applied during character re-roll.
export function removeEffectsByOrigin(entity: Entity, originId: string): number {
  if (!entity.has(Effects)) return 0
  const current = entity.get(Effects)!
  const toRemove = current.list.filter((e) => e.originId === originId)
  if (toRemove.length === 0) return 0
  const keep = current.list.filter((e) => e.originId !== originId)
  entity.set(Effects, { list: keep })
  const a = entity.get(Attributes)
  if (a) {
    let sheet = a.sheet
    for (const e of toRemove) sheet = removeEffectFromSheet(sheet, e.id)
    entity.set(Attributes, { ...a, sheet })
  }
  return toRemove.length
}

export function getEffects(entity: Entity): readonly Effect[] {
  if (!entity.has(Effects)) return []
  return entity.get(Effects)!.list
}
