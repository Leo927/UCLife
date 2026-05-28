// MS frame-mod catalog loader — Phase 6.2.5.C.
//
// The validator below uses string-typed stat ids and mod types. The
// strict type binding (against `MsStatId` / `ModType`) lives at the
// consumer site (ecs/msEffects.ts), since `src/data/` is forbidden from
// reaching into `src/stats/` per the layering rule. The string lists
// below MUST stay in sync with stats/msSchema.ts MS_STAT_IDS and
// stats/sheet.ts ModType — adding a new MsStatId means updating both.

import json5 from 'json5'
import raw from './ms-frame-mods.json5?raw'

// Mirrors stats/msSchema.ts MS_STAT_IDS — runtime validation only; the
// effect application path consumes this as the canonical MsStatId at
// the consumer-side cast. Tests pin both lists.
const KNOWN_MS_STAT_IDS = [
  'hullPoints', 'armorPoints', 'topSpeed', 'maneuverability',
  'propellantStorage', 'lifeSupportMinutes', 'frameSlots', 'sortieResupplyMul',
] as const

// Mirrors stats/sheet.ts ModType.
const KNOWN_MOD_TYPES = ['flat', 'percentAdd', 'percentMult', 'floor', 'cap'] as const

export type FrameModStatId = typeof KNOWN_MS_STAT_IDS[number]
export type FrameModType = typeof KNOWN_MOD_TYPES[number]

export interface MsFrameModEffectAuthor {
  statId: FrameModStatId
  type: FrameModType
  value: number
}

export interface MsFrameModDef {
  id: string
  nameZh: string
  descZh: string
  slotCount: number
  effects: MsFrameModEffectAuthor[]
}

interface MsFrameModsFile {
  frameMods: MsFrameModDef[]
}

const parsed = json5.parse(raw) as MsFrameModsFile

if (!Array.isArray(parsed.frameMods) || parsed.frameMods.length === 0) {
  throw new Error('ms-frame-mods.json5 must declare at least one frame mod')
}

const VALID_STAT_IDS: ReadonlySet<string> = new Set(KNOWN_MS_STAT_IDS)
const VALID_MOD_TYPES: ReadonlySet<string> = new Set(KNOWN_MOD_TYPES)

const seen = new Set<string>()
for (const m of parsed.frameMods) {
  if (!m.id) throw new Error('ms-frame-mods.json5: mod missing id')
  if (seen.has(m.id)) throw new Error(`ms-frame-mods.json5: duplicate mod id "${m.id}"`)
  seen.add(m.id)
  if (!m.nameZh) throw new Error(`ms-frame-mods.json5: mod "${m.id}" missing nameZh`)
  if (!Number.isInteger(m.slotCount) || m.slotCount <= 0) {
    throw new Error(`ms-frame-mods.json5: mod "${m.id}" slotCount must be a positive integer`)
  }
  if (!Array.isArray(m.effects) || m.effects.length === 0) {
    throw new Error(`ms-frame-mods.json5: mod "${m.id}" must declare at least one effect`)
  }
  for (const e of m.effects) {
    if (!VALID_STAT_IDS.has(e.statId)) {
      throw new Error(`ms-frame-mods.json5: mod "${m.id}" unknown statId "${e.statId}"`)
    }
    if (!VALID_MOD_TYPES.has(e.type)) {
      throw new Error(`ms-frame-mods.json5: mod "${m.id}" invalid type "${e.type}"`)
    }
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) {
      throw new Error(`ms-frame-mods.json5: mod "${m.id}" effect value must be a finite number`)
    }
  }
}

const byId: Record<string, MsFrameModDef> = Object.fromEntries(
  parsed.frameMods.map((m) => [m.id, m]),
)

export const MS_FRAME_MODS: Record<string, MsFrameModDef> = byId
export const MS_FRAME_MOD_LIST: readonly MsFrameModDef[] = parsed.frameMods

export function getMsFrameMod(id: string): MsFrameModDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown MS frame mod id: ${id}`)
  return def
}

export function isMsFrameModId(id: string): boolean {
  return id in byId
}

// Source string used for every Modifier this mod produces on the
// MsStatSheet. Mirrors stats/effects.ts effectSource() naming so
// removeBySource(`eff:framemod:<id>`) cleanly unwinds one mod.
export function frameModEffectId(modId: string): string {
  return `framemod:${modId}`
}
