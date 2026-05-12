import json5 from 'json5'
import raw from './special-npcs.json5?raw'
import type { FactionId } from '../data/factions'
import type { SkillId } from './skills'

// A named NPC. Tile coords are optional — entries without them are
// virtual: not placed in any city tilemap, but referenced by stable
// `id` from authoring layers that need to attach a character to a
// non-city slot (Phase 6.2: notable-hostile captains pinned to a
// space-entities row by id).
export interface SpecialNpc {
  // Stable id for cross-doc references. Optional for legacy entries that
  // only care about being placed in a tilemap; required to be cited from
  // notable-hostile authoring etc.
  id?: string
  name: string
  color: string
  title?: string
  // One-line context shown on the tally captured panel + brig listing,
  // e.g. "the redhead in the custom Zaku — you've heard about him on
  // the news". Optional; defaults to title when missing.
  contextZh?: string
  // Tilemap placement. Optional — virtual NPCs (notable hostiles,
  // future off-screen characters) omit these and the spawn loop skips
  // them.
  tileX?: number
  tileY?: number
  // Phase 6.2.C2 — which scene to spawn into. Defaults to the initial
  // scene (vonBraunCity) when omitted, matching every legacy entry.
  // Other valid scene ids are validated at spawn time.
  sceneId?: string
  fatigue?: number
  hunger?: number
  thirst?: number
  money?: number
  skills?: Partial<Record<SkillId, number>>
  factionRole?: { faction: FactionId; role: 'staff' | 'manager' | 'board' }
  // Pre-assign at world-init (specId match) so AE board / manager NPCs
  // populate immediately rather than waiting on natural job-seeking.
  workstation?: string
}

interface SpecialNpcsFile {
  npcs: SpecialNpc[]
}

const parsed = json5.parse(raw) as SpecialNpcsFile

// Catch duplicate ids early — silent collisions across a growing roster
// would crater the notable-hostile reference layer.
const idsSeen = new Set<string>()
for (const n of parsed.npcs) {
  if (!n.id) continue
  if (idsSeen.has(n.id)) {
    throw new Error(`special-npcs.json5: duplicate id "${n.id}"`)
  }
  idsSeen.add(n.id)
}

export const specialNpcs: readonly SpecialNpc[] = parsed.npcs

const byId = new Map<string, SpecialNpc>()
for (const n of parsed.npcs) {
  if (n.id) byId.set(n.id, n)
}

export function getSpecialNpcById(id: string): SpecialNpc | undefined {
  return byId.get(id)
}

export function isSpecialNpcId(id: string): boolean {
  return byId.has(id)
}
