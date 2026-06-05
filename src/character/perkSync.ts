// Folds purchased perks onto the character's Effects trait. Each perk
// is one Effect with id 'perk:<id>' and originId = perk id. Idempotent:
// re-running drops every existing perk Effect and re-emits from the
// `perks` array, so a perk add/remove/load round-trips cleanly.
//
// The StatSheet's modifier arrays are derived from the Effects list
// (see src/character/effects.ts) so any modifiers a perk authors —
// including 'floor' / 'cap' types — flow through the unified fold.

import type { Entity } from 'koota'
import { Effects } from '../ecs/traits'
import { getPerk, isFactionPerk } from './perks'
import { addEffect, removeEffect } from './effects'
import {
  addFactionEffect, removeFactionEffect, getFactionEffects,
} from '../ecs/factionEffects'

const PERK_PREFIX = 'perk:'

function perkEffectId(id: string): string {
  return `${PERK_PREFIX}${id}`
}

export function syncPerkModifiers(entity: Entity, perks: readonly string[]): void {
  if (!entity.has(Effects)) return
  // Collect existing perk Effect ids first; otherwise removing one
  // would invalidate the iterator over the list.
  const existing = entity.get(Effects)!.list
    .filter((e) => e.id.startsWith(PERK_PREFIX))
    .map((e) => e.id)
  for (const id of existing) removeEffect(entity, id)

  for (const perkId of perks) {
    const def = getPerk(perkId)
    if (!def) continue
    addEffect(entity, {
      id: perkEffectId(perkId),
      originId: perkId,
      family: 'perk',
      modifiers: def.modifiers.map((m) => ({ statId: m.statId, type: m.type, value: m.value })),
      nameZh: def.nameZh,
      descZh: def.descZh,
    })
  }
}

// Phase 6.4.E — fold faction-leader perks onto the player-faction's
// FactionStatSheet. Mirror of syncPerkModifiers for the faction side:
// idempotent, drops every existing `perk:*` FactionEffect first and
// re-emits from the `perks` array, so add/remove/load round-trips cleanly.
// Perks without faction levers (vital/skill/economic/...) are skipped.
export function syncFactionPerks(faction: Entity, perks: readonly string[]): void {
  const existing = getFactionEffects(faction)
    .filter((e) => e.id.startsWith(PERK_PREFIX))
    .map((e) => e.id)
  for (const id of existing) removeFactionEffect(faction, id)

  for (const perkId of perks) {
    const def = getPerk(perkId)
    if (!def || !isFactionPerk(def)) continue
    addFactionEffect(faction, {
      id: perkEffectId(perkId),
      originId: perkId,
      family: 'perk',
      modifiers: def.factionModifiers!.map((m) => ({ statId: m.statId, type: m.type, value: m.value })),
      nameZh: def.nameZh,
      descZh: def.descZh,
    })
  }
}
