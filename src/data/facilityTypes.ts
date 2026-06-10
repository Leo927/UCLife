import json5 from 'json5'
import raw from './facility-types.json5?raw'

export type HangarTier = 'surface' | 'drydock'

// Slot classes a hangar can hold. Surface tier hosts ms + smallCraft;
// drydock hosts capital + smallCraft. Authoring time enforces the tier
// → slot-class compatibility via getHangarFacilityType().
export type HangarSlotClass = 'ms' | 'smallCraft' | 'capital'

export interface HangarFacilityType {
  tier: HangarTier
  slotCapacity: Partial<Record<HangarSlotClass, number>>
  // Phase 6.2.F — per-hangar supply + fuel reserves. The hangar's daily
  // drain tick draws against `supplyStorage`; AE dealer / secretary
  // bulk-order verbs route incoming shipments to top them back up.
  supplyStorage: number
  fuelStorage: number
}

// Phase 5.5.6 — facility-tier ladders (Design/social/facility-tiers.md).
// The four universal knobs every owned facility carries.
export const TIER_KNOBS = [
  'jobSiteCount', 'efficiency', 'operatingHours', 'loyaltyDrift',
] as const
export type TierKnob = typeof TIER_KNOBS[number]

export interface TierRow {
  tier: number
  // Tier-N (N>1) gating + cost. Tier-1 rows are the baseline and carry none.
  requiresUnlock?: string
  creditCost?: number
  downtimeDays?: number
  // jobSiteCount payload: object-template ids spawned as new seats.
  addStations?: string[]
  // efficiency / loyaltyDrift payload.
  mul?: number
}

export type FacilityTierLadder = Record<TierKnob, TierRow[]>

interface FacilityTypesRaw {
  slotHierarchy: HangarSlotClass[]
  hangars: Record<string, HangarFacilityType>
  tiers: Record<string, FacilityTierLadder>
}

const parsed = json5.parse(raw) as FacilityTypesRaw

const VALID_SLOT_CLASSES: ReadonlySet<HangarSlotClass> = new Set<HangarSlotClass>([
  'ms', 'smallCraft', 'capital',
])

if (!Array.isArray(parsed.slotHierarchy) || parsed.slotHierarchy.length === 0) {
  throw new Error('facility-types.json5: slotHierarchy must be a non-empty array')
}
for (const cls of parsed.slotHierarchy) {
  if (!VALID_SLOT_CLASSES.has(cls)) {
    throw new Error(`facility-types.json5: slotHierarchy entry "${cls}" is not a HangarSlotClass`)
  }
}

for (const [id, def] of Object.entries(parsed.hangars)) {
  if (typeof def.supplyStorage !== 'number' || def.supplyStorage < 0) {
    throw new Error(`facility-types.json5: hangar "${id}" supplyStorage must be a non-negative number`)
  }
  if (typeof def.fuelStorage !== 'number' || def.fuelStorage < 0) {
    throw new Error(`facility-types.json5: hangar "${id}" fuelStorage must be a non-negative number`)
  }
}

export const HANGAR_SLOT_HIERARCHY: readonly HangarSlotClass[] = parsed.slotHierarchy

// Lower index = larger slot. A slot of class C accepts ships whose class
// index is >= index(C).
const slotRank = new Map<HangarSlotClass, number>(
  HANGAR_SLOT_HIERARCHY.map((c, i) => [c, i]),
)

export function slotAcceptsShipClass(
  slotClass: HangarSlotClass,
  shipClass: HangarSlotClass,
): boolean {
  const slotIdx = slotRank.get(slotClass)
  const shipIdx = slotRank.get(shipClass)
  if (slotIdx === undefined || shipIdx === undefined) return false
  return slotIdx <= shipIdx
}

export function fittingSlotClasses(
  slotCapacity: Partial<Record<HangarSlotClass, number>>,
  shipClass: HangarSlotClass,
): HangarSlotClass[] {
  const out: HangarSlotClass[] = []
  for (const cls of HANGAR_SLOT_HIERARCHY) {
    if (!slotAcceptsShipClass(cls, shipClass)) continue
    if ((slotCapacity[cls] ?? 0) <= 0) continue
    out.push(cls)
  }
  return out
}

for (const [typeId, ladder] of Object.entries(parsed.tiers ?? {})) {
  for (const knob of TIER_KNOBS) {
    const rows = ladder[knob]
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`facility-types.json5: tiers.${typeId}.${knob} must be a non-empty array`)
    }
    rows.forEach((row, i) => {
      if (row.tier !== i + 1) {
      throw new Error(`facility-types.json5: tiers.${typeId}.${knob}[${i}].tier must be ${i + 1} (sequential from 1)`)
      }
      if (row.tier > 1) {
        if (typeof row.creditCost !== 'number' || row.creditCost < 0) {
          throw new Error(`facility-types.json5: tiers.${typeId}.${knob} tier ${row.tier} needs a non-negative creditCost`)
        }
        if (typeof row.downtimeDays !== 'number' || row.downtimeDays < 0) {
          throw new Error(`facility-types.json5: tiers.${typeId}.${knob} tier ${row.tier} needs a non-negative downtimeDays`)
        }
      }
      if (knob === 'jobSiteCount' && row.tier > 1) {
        if (!Array.isArray(row.addStations) || row.addStations.length === 0) {
          throw new Error(`facility-types.json5: tiers.${typeId}.jobSiteCount tier ${row.tier} needs addStations`)
        }
      }
    })
  }
}

export const facilityTierLadders: Readonly<Record<string, FacilityTierLadder>> =
  parsed.tiers ?? {}

export function facilityTierLadder(typeId: string): FacilityTierLadder | null {
  return facilityTierLadders[typeId] ?? null
}

export const hangarFacilityTypes: Readonly<Record<string, HangarFacilityType>> =
  parsed.hangars

export function getHangarFacilityType(typeId: string): HangarFacilityType | null {
  return hangarFacilityTypes[typeId] ?? null
}

export function isHangarTypeId(typeId: string): boolean {
  return typeId in hangarFacilityTypes
}
