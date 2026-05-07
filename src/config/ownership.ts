import json5 from 'json5'
import raw from './ownership.json5?raw'
import type { FactionId } from './factions'

// Default-ownership entry for a building type. State-owned facilities have
// no factionId. Faction-owned facilities resolve factionId to the spawned
// Faction entity at world boot — see systems/ownership.ts for the lookup.
export type OwnershipDefault =
  | { kind: 'state' }
  | { kind: 'faction'; factionId: FactionId }

export interface OwnershipConfig {
  defaults: Record<string, OwnershipDefault>
}

export const ownershipConfig = json5.parse(raw) as OwnershipConfig
