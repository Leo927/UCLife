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
}

interface FacilityTypesRaw {
  hangars: Record<string, HangarFacilityType>
}

const parsed = json5.parse(raw) as FacilityTypesRaw

export const hangarFacilityTypes: Readonly<Record<string, HangarFacilityType>> =
  parsed.hangars

export function getHangarFacilityType(typeId: string): HangarFacilityType | null {
  return hangarFacilityTypes[typeId] ?? null
}

export function isHangarTypeId(typeId: string): boolean {
  return typeId in hangarFacilityTypes
}
