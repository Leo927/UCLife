// Folds purchased perks into the StatSheet under source `perk:<id>`.
// Idempotent so it can re-run after every perk-array change without
// leaking duplicates.

import type { Entity } from 'koota'
import { Attributes } from '../ecs/traits'
import { getPerk, perkSource } from '../character/perks'
import { addModifier, removeBySource, type Modifier } from './sheet'
import type { StatId } from './schema'

const PERK_PREFIX = 'perk:'

// Idempotent: every existing 'perk:*' modifier is dropped and the full
// set is re-derived from the perks array. Safe to call after any
// add/remove/load.
export function syncPerkModifiers(entity: Entity, perks: readonly string[]): void {
  const a = entity.get(Attributes)
  if (!a) return
  let sheet = a.sheet
  // Collect *every* distinct perk source first; otherwise stripping by
  // source-of-first-match would skip a second perk-source on the same
  // stat and let it leak across syncs.
  const perkSources = new Set<string>()
  for (const id of Object.keys(sheet.stats) as StatId[]) {
    for (const m of sheet.stats[id].modifiers) {
      if (m.source.startsWith(PERK_PREFIX)) perkSources.add(m.source)
    }
  }
  for (const src of perkSources) sheet = removeBySource(sheet, src)

  for (const perkId of perks) {
    const def = getPerk(perkId)
    if (!def) continue
    const source = perkSource(def.id)
    for (const m of def.modifiers) {
      const mod: Modifier<StatId> = { statId: m.statId, type: m.type, value: m.value, source }
      sheet = addModifier(sheet, mod)
    }
  }

  if (sheet !== a.sheet) {
    entity.set(Attributes, { ...a, sheet })
  }
}
