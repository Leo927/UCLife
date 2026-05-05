// Bridges the perks catalog (Phase 5.0 ambitions) and the per-character
// StatSheet. Perks live as a string array on Ambitions.perks; each maps
// to a PerkEffect, and right now only `vitalDecay` is sheet-driven —
// it pushes a percentMult modifier onto the matching <vital>DrainMul
// stat. Other perk effects (skillXpMul, wageMul, shopDiscountMul,
// rentMul) still flow through src/systems/perkEffects.ts and read the
// perks array on demand.

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
  // Drop every existing perk-sourced modifier (one pass, regardless of
  // which perks were removed since last sync).
  for (const id of Object.keys(sheet.stats) as StatId[]) {
    for (const m of sheet.stats[id].modifiers) {
      if (m.source.startsWith(PERK_PREFIX)) {
        sheet = removeBySource(sheet, m.source)
        break
      }
    }
  }

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
