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
  hangars: Record<string, HangarFacilityType>
}

const parsed = json5.parse(raw) as FacilityTypesRaw

for (const [id, def] of Object.entries(parsed.hangars)) {
  if (typeof def.supplyStorage !== 'number' || def.supplyStorage < 0) {
    throw new Error(`facility-types.json5: hangar "${id}" supplyStorage must be a non-negative number`)
  }
  if (typeof def.fuelStorage !== 'number' || def.fuelStorage < 0) {
    throw new Error(`facility-types.json5: hangar "${id}" fuelStorage must be a non-negative number`)
  }
}

export const hangarFacilityTypes: Readonly<Record<string, HangarFacilityType>> =
  parsed.hangars

export function getHangarFacilityType(typeId: string): HangarFacilityType | null {
  return hangarFacilityTypes[typeId] ?? null
}

export function isHangarTypeId(typeId: string): boolean {
  return typeId in hangarFacilityTypes
}
