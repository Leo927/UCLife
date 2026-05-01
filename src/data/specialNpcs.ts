import json5 from 'json5'
import raw from './special-npcs.json5?raw'
import type { FactionId } from './factions'

export interface SpecialNpc {
  name: string
  color: string
  title?: string
  tileX: number
  tileY: number
  fatigue?: number
  hunger?: number
  thirst?: number
  money?: number
  skills?: Partial<Record<'mechanics' | 'marksmanship' | 'athletics' | 'cooking' | 'medicine' | 'computers', number>>
  factionRole?: { faction: FactionId; role: 'staff' | 'manager' | 'board' }
  // Pre-assign at world-init (specId match) so AE board / manager NPCs
  // populate immediately rather than waiting on natural job-seeking.
  workstation?: string
}

interface SpecialNpcsFile {
  npcs: SpecialNpc[]
}

const parsed = json5.parse(raw) as SpecialNpcsFile

export const specialNpcs: readonly SpecialNpc[] = parsed.npcs
