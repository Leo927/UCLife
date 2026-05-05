// Character backgrounds — first concrete modifier source for the new
// stat system. Catalog lives in backgrounds.json5; parsed and validated
// at module import. applyBackground() / removeBackground() push or
// pull the entire modifier set against an entity's StatSheet, scoped to
// a single source string per background so re-rolls are clean.

import json5 from 'json5'
import raw from './backgrounds.json5?raw'
import type { Entity } from 'koota'
import { Attributes } from '../ecs/traits'
import { addModifier, removeBySource, type ModType, type Modifier } from '../stats/sheet'
import { STAT_IDS, type StatId } from '../stats/schema'

const VALID_TYPES: ReadonlySet<ModType> = new Set<ModType>(['flat', 'percentAdd', 'percentMult'])
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

export function backgroundSource(id: string): string {
  return `bg:${id}`
}

// Idempotent: already-applied backgrounds are removed and re-applied so
// the post-call sheet always matches the catalog.
export function applyBackground(entity: Entity, id: string): boolean {
  const def = byId[id]
  if (!def) return false
  const a = entity.get(Attributes)
  if (!a) return false
  const source = backgroundSource(id)
  let sheet = removeBySource(a.sheet, source)
  for (const m of def.modifiers) {
    const mod: Modifier<StatId> = { statId: m.statId, type: m.type, value: m.value, source }
    sheet = addModifier(sheet, mod)
  }
  entity.set(Attributes, { ...a, sheet })
  return true
}

export function removeBackground(entity: Entity, id: string): boolean {
  const a = entity.get(Attributes)
  if (!a) return false
  const next = removeBySource(a.sheet, backgroundSource(id))
  if (next === a.sheet) return false
  entity.set(Attributes, { ...a, sheet: next })
  return true
}
