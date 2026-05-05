// Folds vitalDecay perks into the StatSheet as <vital>DrainMul
// modifiers. Idempotent so it can re-run after every perk-array change
// without leaking duplicates.

import type { Entity } from 'koota'
import { Attributes } from '../ecs/traits'
import { getPerk, type VitalKey } from '../data/perks'
import { addModifier, removeBySource } from './sheet'
import { vitalDrainMulStat, VITAL_IDS, type StatId } from './schema'
import type { Modifier } from './sheet'

const PERK_PREFIX = 'perk:'

function applyVitalDecayMod(
  modifiers: Modifier<StatId>[],
  vital: VitalKey,
  mul: number,
  source: string,
): void {
  // perk.effect.mul is "drain at this fraction of normal" — 0.8 means
  // 80% of normal, i.e. −20% drain. percentMult uses additive deltas,
  // so feed in (mul − 1).
  if (vital === 'all') {
    for (const v of VITAL_IDS) {
      modifiers.push({ statId: vitalDrainMulStat(v), type: 'percentMult', value: mul - 1, source })
    }
  } else {
    modifiers.push({ statId: vitalDrainMulStat(vital), type: 'percentMult', value: mul - 1, source })
  }
}

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
    if (def.effect.kind !== 'vitalDecay') continue
    const source = `${PERK_PREFIX}${def.id}`
    const buf: Modifier<StatId>[] = []
    applyVitalDecayMod(buf, def.effect.vital, def.effect.mul, source)
    for (const m of buf) sheet = addModifier(sheet, m)
  }

  if (sheet !== a.sheet) {
    entity.set(Attributes, { ...a, sheet })
  }
}
