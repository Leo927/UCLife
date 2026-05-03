import json5 from 'json5'
import raw from './shipSystems.json5?raw'

// Stable id union for every subsystem a ship can install. Phase 6.0
// spine ships only the six below; Phase 6.1+ extends this union with
// medbay / sensors / doors / hacking / cloaking / teleporter — when
// adding, also add the corresponding entry to shipSystems.json5.
export type SystemId =
  | 'shields'
  | 'engines'
  | 'oxygen'
  | 'weapons'
  | 'hangar'
  | 'pilot'

// One band of integrity-driven effective-level degradation. The runtime
// applies the *first* stage whose `thresholdPct >= currentIntegrityPct`
// (when sorted descending), so higher thresholds gate lighter penalties.
// `effectiveLevelDelta` is added to the installed level to derive the
// currently-operating level — a deeply-negative value forces offline.
export interface SystemDamageStage {
  thresholdPct: number
  effectiveLevelDelta: number
}

export interface ShipSystemDef {
  id: SystemId
  nameZh: string
  descZh: string
  maxLevel: number
  powerPerLevel: number
  category: 'core' | 'optional'
  damageStages: SystemDamageStage[]
}

interface ShipSystemsFile {
  systems: ShipSystemDef[]
}

const parsed = json5.parse(raw) as ShipSystemsFile

if (!Array.isArray(parsed.systems) || parsed.systems.length === 0) {
  throw new Error('shipSystems.json5 must declare at least one system')
}

const KNOWN_IDS: ReadonlySet<SystemId> = new Set<SystemId>([
  'shields',
  'engines',
  'oxygen',
  'weapons',
  'hangar',
  'pilot',
])

const seen = new Set<SystemId>()
for (const s of parsed.systems) {
  if (!KNOWN_IDS.has(s.id)) {
    throw new Error(`shipSystems.json5: unknown system id "${s.id}"`)
  }
  if (seen.has(s.id)) {
    throw new Error(`shipSystems.json5: duplicate system id "${s.id}"`)
  }
  seen.add(s.id)
  if (s.maxLevel <= 0) {
    throw new Error(`shipSystems.json5: system "${s.id}" maxLevel must be > 0`)
  }
  if (s.powerPerLevel < 0) {
    throw new Error(`shipSystems.json5: system "${s.id}" powerPerLevel must be >= 0`)
  }
  if (s.category !== 'core' && s.category !== 'optional') {
    throw new Error(`shipSystems.json5: system "${s.id}" has invalid category "${s.category}"`)
  }
  if (!Array.isArray(s.damageStages)) {
    throw new Error(`shipSystems.json5: system "${s.id}" missing damageStages`)
  }
  for (const stage of s.damageStages) {
    if (stage.thresholdPct < 0 || stage.thresholdPct > 100) {
      throw new Error(
        `shipSystems.json5: system "${s.id}" damage stage thresholdPct ${stage.thresholdPct} out of [0,100]`,
      )
    }
  }
}

const byId: Record<SystemId, ShipSystemDef> = Object.fromEntries(
  parsed.systems.map((s) => [s.id, s]),
) as Record<SystemId, ShipSystemDef>

export const SHIP_SYSTEMS: Record<SystemId, ShipSystemDef> = byId

export const SHIP_SYSTEM_LIST: readonly ShipSystemDef[] = parsed.systems

export function getShipSystem(id: SystemId): ShipSystemDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown ship system id: ${id}`)
  return def
}

export function isSystemId(id: string): id is SystemId {
  return KNOWN_IDS.has(id as SystemId)
}
