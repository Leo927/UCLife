// Phase 4 condition catalog. The system spec lives in
// Design/characters/physiology.md and the data shape in
// Design/characters/physiology-data.md.
//
// Two-tier model:
//   ConditionTemplate — frozen authored row (this file + conditions.json5).
//   ConditionInstance — per-character runtime state (Conditions trait).
//
// Templates are loaded once at module import, validated, and stored in
// CONDITIONS / byId. The phase machine, band reconciler, and recovery
// formula read templates and write instances; they never mutate
// templates.

import json5 from 'json5'
import raw from '../data/conditions.json5?raw'
import { STAT_IDS, type StatId } from '../stats/schema'
import type { ModType } from '../stats/sheet'

// Runtime state lives on the Conditions trait; the type is declared
// in ecs/traits/character.ts so engine-eligible code (including
// src/systems/physiology.ts under the engine boundary) can read it
// without reaching up into character/.
export type { ConditionInstance, ConditionPhase } from '../ecs/traits/character'

const VALID_TYPES: ReadonlySet<ModType> = new Set<ModType>([
  'flat', 'percentAdd', 'percentMult', 'floor', 'cap',
])
const VALID_STAT_IDS: ReadonlySet<string> = new Set<string>(STAT_IDS)

export type ConditionFamily = 'acute' | 'injury' | 'chronic' | 'mental' | 'pregnancy'
export type RecoveryMode = 'treatment' | 'lifestyle' | 'chronic-permanent'
export type BodyPartScope = 'systemic' | 'bodyPart'
export type OnsetPath =
  | 'vitals_saturation' | 'ingestion' | 'environment' | 'contagion' | 'behavior_pattern'

export interface BandedEffectMod {
  statId: StatId
  type: ModType
  value: number
}

export interface BandedEffectSpec {
  // Inclusive on both ends. Ranges may overlap.
  severityRange: [number, number]
  // The Effect emitted when severity is inside the band. Carries the
  // modifier list plus zh-CN display metadata.
  nameZh: string
  flavorZh?: string
  glyphRef?: string
  modifiers: BandedEffectMod[]
}

export interface ConditionTemplate {
  id: string
  displayName: string
  family: ConditionFamily
  bodyPartScope: BodyPartScope
  recoveryMode: RecoveryMode
  onsetPaths: readonly OnsetPath[]

  // Duration shape — ranges roll once at onset into instance scalars.
  incubationDays: [number, number]
  riseDays: [number, number]
  peakSeverity: [number, number]
  // Either a [min, max] range or a single number; both serialize the same.
  peakDays: [number, number] | number

  // Recovery params (treatment mode).
  peakSeverityFloor: number
  baseRecoveryRate: number
  requiredTreatmentTier: number

  // Scar branching.
  scarThreshold: number
  scarConditionId: string | null
  scarTalentPenalty: { stat: StatId; capDelta: number } | null

  // Stalled-state complication roll. Each game-day spent stalled
  // rolls complicationRisk against [0,1]; on hit, the linked
  // condition spawns on the same body part as this instance.
  // 0 disables the roll.
  complicationRisk?: number
  complicationConditionId?: string | null

  // Environmental onset path: daily probability when the trigger
  // (high fatigue, etc.) is met. 0 / unauthored disables the roll
  // for this template. Templates that ship via this path must also
  // author eligibleBodyParts so the roll knows where to spawn.
  environmentRisk?: number
  eligibleBodyParts?: readonly string[]

  // Contagion (Phase 4.2). When `infectious=true`, every symptomatic
  // carrier (phase ∈ rising/peak/recovering/stalled) rolls
  // transmissionRate against susceptibles within contactRadius tiles
  // on each active-zone tick. `contactRadius` is in tiles.
  infectious?: boolean
  transmissionRate?: number
  contactRadius?: number

  // Player-facing strings.
  symptomBlurbs: { mild: string; moderate: string; severe: string }
  eventLogTemplates: {
    onset: string
    diagnosis?: string | null
    recoveryClean?: string | null
    recoveryScar?: string | null
    complication?: string | null
    stalled?: string | null
  }
  glyphRef?: string

  // What the condition does to the character at each severity band.
  effects: BandedEffectSpec[]
}

interface ConditionsFile {
  conditions: ConditionTemplate[]
}

const parsed = json5.parse(raw) as ConditionsFile

const FAMILIES: ReadonlySet<ConditionFamily> = new Set([
  'acute', 'injury', 'chronic', 'mental', 'pregnancy',
])
const RECOVERY: ReadonlySet<RecoveryMode> = new Set([
  'treatment', 'lifestyle', 'chronic-permanent',
])
const SCOPES: ReadonlySet<BodyPartScope> = new Set(['systemic', 'bodyPart'])
const PATHS: ReadonlySet<OnsetPath> = new Set([
  'vitals_saturation', 'ingestion', 'environment', 'contagion', 'behavior_pattern',
])

function assertRange(label: string, r: unknown): [number, number] {
  if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || r[0] > r[1]) {
    throw new Error(`conditions.json5: "${label}" must be [min, max] with min <= max`)
  }
  return [r[0], r[1]]
}

const seen = new Set<string>()
for (const c of parsed.conditions) {
  if (!c.id) throw new Error('conditions.json5: entry missing id')
  if (seen.has(c.id)) throw new Error(`conditions.json5: duplicate id "${c.id}"`)
  seen.add(c.id)
  if (!c.displayName) throw new Error(`conditions.json5: "${c.id}" missing displayName`)
  if (!FAMILIES.has(c.family)) throw new Error(`conditions.json5: "${c.id}" invalid family "${c.family}"`)
  if (!SCOPES.has(c.bodyPartScope)) throw new Error(`conditions.json5: "${c.id}" invalid bodyPartScope`)
  if (!RECOVERY.has(c.recoveryMode)) throw new Error(`conditions.json5: "${c.id}" invalid recoveryMode`)
  for (const p of c.onsetPaths) {
    if (!PATHS.has(p)) throw new Error(`conditions.json5: "${c.id}" invalid onsetPath "${p}"`)
  }
  assertRange(`${c.id}.incubationDays`, c.incubationDays)
  assertRange(`${c.id}.riseDays`, c.riseDays)
  assertRange(`${c.id}.peakSeverity`, c.peakSeverity)
  if (typeof c.peakDays === 'number') {
    if (!Number.isFinite(c.peakDays) || c.peakDays < 0) {
      throw new Error(`conditions.json5: "${c.id}" peakDays must be non-negative`)
    }
  } else {
    assertRange(`${c.id}.peakDays`, c.peakDays)
  }
  if (!Array.isArray(c.effects)) {
    throw new Error(`conditions.json5: "${c.id}" effects must be an array`)
  }
  for (const [i, b] of c.effects.entries()) {
    assertRange(`${c.id}.effects[${i}].severityRange`, b.severityRange)
    if (!b.nameZh) throw new Error(`conditions.json5: "${c.id}" effects[${i}] missing nameZh`)
    if (!Array.isArray(b.modifiers)) {
      throw new Error(`conditions.json5: "${c.id}" effects[${i}] modifiers must be an array`)
    }
    for (const m of b.modifiers) {
      if (!VALID_STAT_IDS.has(m.statId)) {
        throw new Error(`conditions.json5: "${c.id}" unknown statId "${m.statId}"`)
      }
      if (!VALID_TYPES.has(m.type)) {
        throw new Error(`conditions.json5: "${c.id}" unknown modifier type "${m.type}"`)
      }
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
        throw new Error(`conditions.json5: "${c.id}" non-finite modifier value`)
      }
    }
  }
  if (!c.symptomBlurbs?.mild || !c.symptomBlurbs?.moderate || !c.symptomBlurbs?.severe) {
    throw new Error(`conditions.json5: "${c.id}" symptomBlurbs missing mild/moderate/severe`)
  }
  if (!c.eventLogTemplates?.onset) {
    throw new Error(`conditions.json5: "${c.id}" eventLogTemplates.onset required`)
  }
  if (c.scarConditionId !== null && !c.scarConditionId) {
    throw new Error(`conditions.json5: "${c.id}" scarConditionId must be string or null`)
  }
  if (c.complicationRisk !== undefined) {
    if (typeof c.complicationRisk !== 'number' || c.complicationRisk < 0 || c.complicationRisk > 1) {
      throw new Error(`conditions.json5: "${c.id}" complicationRisk must be number in [0,1]`)
    }
  }
  if (c.complicationConditionId !== undefined && c.complicationConditionId !== null) {
    if (typeof c.complicationConditionId !== 'string' || !c.complicationConditionId) {
      throw new Error(`conditions.json5: "${c.id}" complicationConditionId must be string or null`)
    }
  }
  if (c.environmentRisk !== undefined) {
    if (typeof c.environmentRisk !== 'number' || c.environmentRisk < 0 || c.environmentRisk > 1) {
      throw new Error(`conditions.json5: "${c.id}" environmentRisk must be number in [0,1]`)
    }
    if (!Array.isArray(c.eligibleBodyParts) || c.eligibleBodyParts.length === 0) {
      throw new Error(`conditions.json5: "${c.id}" environmentRisk requires non-empty eligibleBodyParts`)
    }
  }
  if (c.eligibleBodyParts !== undefined) {
    if (!Array.isArray(c.eligibleBodyParts)) {
      throw new Error(`conditions.json5: "${c.id}" eligibleBodyParts must be array`)
    }
    for (const p of c.eligibleBodyParts) {
      if (typeof p !== 'string' || !p) {
        throw new Error(`conditions.json5: "${c.id}" eligibleBodyParts entries must be non-empty strings`)
      }
    }
  }
  if (c.infectious !== undefined && typeof c.infectious !== 'boolean') {
    throw new Error(`conditions.json5: "${c.id}" infectious must be boolean`)
  }
  if (c.infectious) {
    if (typeof c.transmissionRate !== 'number' || c.transmissionRate < 0 || c.transmissionRate > 1) {
      throw new Error(`conditions.json5: "${c.id}" infectious requires transmissionRate in [0,1]`)
    }
    if (typeof c.contactRadius !== 'number' || c.contactRadius <= 0) {
      throw new Error(`conditions.json5: "${c.id}" infectious requires contactRadius > 0`)
    }
    if (!c.onsetPaths.includes('contagion')) {
      throw new Error(`conditions.json5: "${c.id}" infectious must include 'contagion' in onsetPaths`)
    }
  }
}

// Frozen list — phase-machine reads must not mutate authored data.
function freeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj as object)) {
      freeze((obj as Record<string, unknown>)[k])
    }
    return Object.freeze(obj)
  }
  return obj
}

export const CONDITIONS: readonly ConditionTemplate[] = freeze(parsed.conditions)

const byId: Record<string, ConditionTemplate> = Object.fromEntries(
  parsed.conditions.map((c) => [c.id, c]),
)

export function getConditionTemplate(id: string): ConditionTemplate | undefined {
  return byId[id]
}

// Severity → 'mild' | 'moderate' | 'severe' label, used by the HUD strip
// glyph fill, the symptomatic card heading, and the daily digest line.
export type SeverityTier = 'mild' | 'moderate' | 'severe'

export function severityTier(severity: number): SeverityTier {
  if (severity >= 60) return 'severe'
  if (severity >= 30) return 'moderate'
  return 'mild'
}

export const SEVERITY_TIER_ZH: Record<SeverityTier, string> = {
  mild: '轻微',
  moderate: '中等',
  severe: '严重',
}

export const SEVERITY_TIER_COLOR: Record<SeverityTier, string> = {
  mild: '#facc15',
  moderate: '#f97316',
  severe: '#ef4444',
}

// Treatment-tier ordinal → zh-CN label. Indexed by ConditionInstance.currentTreatmentTier.
export const TREATMENT_TIER_ZH: readonly string[] = ['未治疗', '药店', '诊所']
