import json5 from 'json5'
import raw from './ownership.json5?raw'
import type { FactionId } from './factions'

// Default-ownership entry for a building type. State-owned facilities have
// no factionId. Faction-owned facilities resolve factionId to the spawned
// Faction entity at world boot — see systems/ownership.ts for the lookup.
// 'private' is seated as state at spawn time and re-stamped to a named NPC
// owner by seedPrivateOwners (src/ecs/ownership.ts).
export type OwnershipDefault =
  | { kind: 'state' }
  | { kind: 'faction'; factionId: FactionId }
  | { kind: 'private' }

export interface OwnershipConfig {
  defaults: Record<string, OwnershipDefault>
}

export const ownershipConfig = json5.parse(raw) as OwnershipConfig

export function isPrivateBuildingType(typeId: string): boolean {
  return ownershipConfig.defaults[typeId]?.kind === 'private'
}
