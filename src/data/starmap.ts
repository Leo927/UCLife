import json5 from 'json5'
import raw from './starmap.json5?raw'

// Phase 6 starmap data layer. Pure data + types — no koota, no traits,
// no runtime state. The encounter engine, captain-jump UI, and flight
// graph traversal all read from this module.
//
// Faction control is split pre/post Phase 7. Phase-7 trigger flips the
// active value; consumers pass the current war phase when resolving.
// Encounter pools are weighted bags of templateIds resolved against
// `data/encounters.json5` (Phase 6.1; placeholder ids are valid here).

export type FactionKey =
  | 'civilian'
  | 'efsf'
  | 'ae'
  | 'zeon'
  | 'neutral'
  | 'pirate'
  | 'none'

export type NodeType =
  | 'colony'
  | 'station'
  | 'asteroid'
  | 'derelict'
  | 'patrol'
  | 'distress'
  | 'mining'
  | 'anomaly'
  | 'shipyard'

export type ServiceKind =
  | 'refuel'
  | 'repair'
  | 'refit'
  | 'hire'
  | 'store'
  | 'news'

export interface MapPos {
  x: number
  y: number
}

export interface StarmapNode {
  id: string
  nameZh: string
  shortZh?: string
  sectorId: string
  type: NodeType
  factionControlPre: FactionKey
  factionControlPost: FactionKey
  services: ServiceKind[]
  encounterPoolId?: string
  sceneId?: string
  // Position in normalized 0–100 space; the starmap UI maps this onto
  // whatever SVG viewBox it renders at.
  mapPos: MapPos
  description?: string
}

export interface SectorEncounterEntry {
  templateId: string
  weight: number
  conditions?: { warPhase?: 'pre' | 'post' }
}

export interface Sector {
  id: string
  nameZh: string
  difficultyBand: 'tutorial' | 'low' | 'mid' | 'high' | 'extreme'
  nodeIds: string[]
  encounterPool: SectorEncounterEntry[]
}

export interface JumpEdge {
  from: string
  to: string
  fuelCost: number
  durationMin: number
  inSectorOnly?: boolean
}

export interface StarmapData {
  sectors: Sector[]
  nodes: StarmapNode[]
  edges: JumpEdge[]
}

const parsed = json5.parse(raw) as StarmapData

const nodeById = new Map<string, StarmapNode>()
for (const n of parsed.nodes) {
  if (nodeById.has(n.id)) {
    throw new Error(`starmap.json5: duplicate node id "${n.id}"`)
  }
  if (
    !n.mapPos ||
    typeof n.mapPos.x !== 'number' ||
    typeof n.mapPos.y !== 'number'
  ) {
    throw new Error(`starmap.json5: node "${n.id}" missing mapPos {x,y}`)
  }
  if (n.mapPos.x < 0 || n.mapPos.x > 100 || n.mapPos.y < 0 || n.mapPos.y > 100) {
    throw new Error(
      `starmap.json5: node "${n.id}" mapPos out of range — must be 0..100 (got ${n.mapPos.x}, ${n.mapPos.y})`,
    )
  }
  nodeById.set(n.id, n)
}

const sectorById = new Map<string, Sector>()
for (const s of parsed.sectors) {
  if (sectorById.has(s.id)) {
    throw new Error(`starmap.json5: duplicate sector id "${s.id}"`)
  }
  sectorById.set(s.id, s)
}

for (const n of parsed.nodes) {
  if (!sectorById.has(n.sectorId)) {
    throw new Error(
      `starmap.json5: node "${n.id}" references unknown sectorId "${n.sectorId}"`,
    )
  }
}

for (const s of parsed.sectors) {
  for (const nid of s.nodeIds) {
    const n = nodeById.get(nid)
    if (!n) {
      throw new Error(
        `starmap.json5: sector "${s.id}" lists unknown node id "${nid}"`,
      )
    }
    if (n.sectorId !== s.id) {
      throw new Error(
        `starmap.json5: sector "${s.id}" lists node "${nid}" but node.sectorId is "${n.sectorId}"`,
      )
    }
  }
}

for (const e of parsed.edges) {
  if (!nodeById.has(e.from)) {
    throw new Error(`starmap.json5: edge references unknown "from" node "${e.from}"`)
  }
  if (!nodeById.has(e.to)) {
    throw new Error(`starmap.json5: edge references unknown "to" node "${e.to}"`)
  }
  if (e.from === e.to) {
    throw new Error(`starmap.json5: edge has identical endpoints "${e.from}"`)
  }
}

export const STARMAP: StarmapData = parsed

export function getNode(id: string): StarmapNode | undefined {
  return nodeById.get(id)
}

export function getSector(id: string): Sector | undefined {
  return sectorById.get(id)
}

// Returns every neighbor reachable via a single jump from `nodeId`,
// paired with the edge taken. Treats edges as undirected: an edge with
// `from: A, to: B` yields {node: B, edge} when queried for A and
// {node: A, edge} when queried for B.
export function neighborsOf(
  nodeId: string,
): { node: StarmapNode; edge: JumpEdge }[] {
  const out: { node: StarmapNode; edge: JumpEdge }[] = []
  for (const e of parsed.edges) {
    let otherId: string | null = null
    if (e.from === nodeId) otherId = e.to
    else if (e.to === nodeId) otherId = e.from
    if (otherId == null) continue
    const other = nodeById.get(otherId)
    if (other) out.push({ node: other, edge: e })
  }
  return out
}
