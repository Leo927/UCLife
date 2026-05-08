// Faction-side Effect / Unlock helpers. Mirrors src/character/effects.ts
// for FactionEffectsList + FactionSheet, and provides a Set-on-array
// helper for FactionUnlocks. The Effect engine itself is shared with
// characters (src/stats/effects.ts) — only the StatSheet schema differs.

import type { Entity } from 'koota'
import { FactionSheet, FactionEffectsList, FactionUnlocks, type FactionStatId } from './traits'
import {
  applyEffectToSheet, removeEffectFromSheet, type Effect,
} from '../stats/effects'

export type FactionEffect = Effect<FactionStatId>

// Idempotent: an existing FactionEffect with the same id is replaced.
// Returns true on success, false if the entity lacks the required traits
// (defensive — the bootstrapper attaches them on every Faction at spawn).
export function addFactionEffect(faction: Entity, effect: FactionEffect): boolean {
  if (!faction.has(FactionSheet)) return false
  if (!faction.has(FactionEffectsList)) faction.add(FactionEffectsList)
  const cur = faction.get(FactionEffectsList)!
  const filtered = cur.list.filter((e) => e.id !== effect.id)
  faction.set(FactionEffectsList, { list: [...filtered, effect] })
  const fs = faction.get(FactionSheet)!
  faction.set(FactionSheet, { sheet: applyEffectToSheet(fs.sheet, effect) })
  return true
}

export function removeFactionEffect(faction: Entity, effectId: string): boolean {
  if (!faction.has(FactionEffectsList)) return false
  const cur = faction.get(FactionEffectsList)!
  const next = cur.list.filter((e) => e.id !== effectId)
  if (next.length === cur.list.length) return false
  faction.set(FactionEffectsList, { list: next })
  const fs = faction.get(FactionSheet)
  if (fs) faction.set(FactionSheet, { sheet: removeEffectFromSheet(fs.sheet, effectId) })
  return true
}

export function getFactionEffects(faction: Entity): readonly FactionEffect[] {
  if (!faction.has(FactionEffectsList)) return []
  return faction.get(FactionEffectsList)!.list
}

// Set-semantics on an array. `addUnlock` is idempotent — repeating the
// same id leaves the array unchanged.
export function addFactionUnlock(faction: Entity, unlockId: string): boolean {
  if (!faction.has(FactionUnlocks)) faction.add(FactionUnlocks)
  const cur = faction.get(FactionUnlocks)!
  if (cur.ids.includes(unlockId)) return false
  faction.set(FactionUnlocks, { ids: [...cur.ids, unlockId] })
  return true
}

export function hasFactionUnlock(faction: Entity, unlockId: string): boolean {
  if (!faction.has(FactionUnlocks)) return false
  return faction.get(FactionUnlocks)!.ids.includes(unlockId)
}

export function getFactionUnlocks(faction: Entity): readonly string[] {
  if (!faction.has(FactionUnlocks)) return []
  return faction.get(FactionUnlocks)!.ids
}
