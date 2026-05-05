// Character backgrounds — authored modifier bundles applied as Effects
// onto the character's Effects trait. The StatSheet's modifier arrays
// are derived from Effects.list (see src/character/effects.ts), so a
// background's contribution rides through the same fold path as perks
// and condition bands.

import json5 from 'json5'
import raw from './backgrounds.json5?raw'
import type { Entity } from 'koota'
import { addEffect, removeEffect } from './effects'
import type { ModType } from '../stats/sheet'
import { STAT_IDS, type StatId } from '../stats/schema'

const VALID_TYPES: ReadonlySet<ModType> = new Set<ModType>([
  'flat', 'percentAdd', 'percentMult', 'floor', 'cap',
])
const VALID_STAT_IDS: ReadonlySet<string> = new Set<string>(STAT_IDS)

export interface BackgroundDef {
  id: string
  nameZh: string
  descZh: string
  modifiers: { statId: StatId; type: ModType; value: number }[]
}

interface BackgroundsFile {
  backgrounds: BackgroundDef[]
}

const parsed = json5.parse(raw) as BackgroundsFile

const seen = new Set<string>()
for (const bg of parsed.backgrounds) {
  if (!bg.id) throw new Error('backgrounds.json5: entry missing id')
  if (seen.has(bg.id)) throw new Error(`backgrounds.json5: duplicate id "${bg.id}"`)
  seen.add(bg.id)
  if (!bg.nameZh) throw new Error(`backgrounds.json5: "${bg.id}" missing nameZh`)
  if (!bg.descZh) throw new Error(`backgrounds.json5: "${bg.id}" missing descZh`)
  if (!Array.isArray(bg.modifiers)) {
    throw new Error(`backgrounds.json5: "${bg.id}" modifiers must be an array`)
  }
  for (const m of bg.modifiers) {
    if (!VALID_STAT_IDS.has(m.statId)) {
      throw new Error(`backgrounds.json5: "${bg.id}" unknown statId "${m.statId}"`)
    }
    if (!VALID_TYPES.has(m.type)) {
      throw new Error(`backgrounds.json5: "${bg.id}" unknown modifier type "${m.type}"`)
    }
    if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
      throw new Error(`backgrounds.json5: "${bg.id}" non-finite value`)
    }
  }
}

export const BACKGROUNDS: readonly BackgroundDef[] = parsed.backgrounds

const byId: Record<string, BackgroundDef> = Object.fromEntries(
  parsed.backgrounds.map((b) => [b.id, b]),
)

export function getBackground(id: string): BackgroundDef | undefined {
  return byId[id]
}

// Effect id for a background — `bg:<id>` keeps the namespace stable
// across the legacy direct-write and the new Effects layer.
export function backgroundEffectId(id: string): string {
  return `bg:${id}`
}

// Idempotent: addEffect replaces an existing Effect with the same id.
export function applyBackground(entity: Entity, id: string): boolean {
  const def = byId[id]
  if (!def) return false
  return addEffect(entity, {
    id: backgroundEffectId(id),
    originId: id,
    family: 'background',
    modifiers: def.modifiers.map((m) => ({ statId: m.statId, type: m.type, value: m.value })),
    nameZh: def.nameZh,
    descZh: def.descZh,
  })
}

export function removeBackground(entity: Entity, id: string): boolean {
  return removeEffect(entity, backgroundEffectId(id))
}
