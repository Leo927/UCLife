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

interface FacilityTypesRaw {
  slotHierarchy: HangarSlotClass[]
  hangars: Record<string, HangarFacilityType>
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

export const hangarFacilityTypes: Readonly<Record<string, HangarFacilityType>> =
  parsed.hangars

export function getHangarFacilityType(typeId: string): HangarFacilityType | null {
  return hangarFacilityTypes[typeId] ?? null
}

export function isHangarTypeId(typeId: string): boolean {
  return typeId in hangarFacilityTypes
}
