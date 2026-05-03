import json5 from 'json5'
import raw from './flights.json5?raw'
import { isSceneId } from './scenes'
import { getNode, neighborsOf, type JumpEdge, type StarmapNode } from './starmap'
import type { SceneId } from '../ecs/world'

// Static metadata about a flight hub. The hub's runtime location (ticket
// counter + arrival point) is procgen-determined per airport spawn — see
// sim/airportPlacements.ts. `id` is referenced by routes; `sceneId` binds
// the hub 1:1 to the airport spawned in that scene's procgen.
//
// `nodeId` (Phase 6) maps the hub onto the starmap graph in
// `data/starmap.json5`. Hubs whose host scene corresponds to a starmap
// beacon set this to the matching node id; the starmap then becomes the
// source of truth for adjacency, fuel cost, and jump duration.
// Passenger flights and captain jumps walk the same graph — the UI
// shell differs (see Design/starmap.md).
export interface FlightHub {
  id: string
  nameZh: string
  shortZh: string
  sceneId: SceneId
  nodeId?: string
  description?: string
}

export interface FlightRoute {
  from: string
  to: string
  durationMin: number
  fare: number
}

interface FlightFile {
  hubs: FlightHub[]
  routes: FlightRoute[]
}

const parsed = json5.parse(raw) as FlightFile

for (const h of parsed.hubs) {
  if (!isSceneId(h.sceneId)) {
    throw new Error(`flights.json5: hub "${h.id}" references unknown sceneId "${h.sceneId}"`)
  }
  if (h.nodeId != null && !getNode(h.nodeId)) {
    throw new Error(`flights.json5: hub "${h.id}" references unknown starmap nodeId "${h.nodeId}"`)
  }
}

export const flightHubs: readonly FlightHub[] = parsed.hubs
export const flightRoutes: readonly FlightRoute[] = parsed.routes

export function getFlightHub(id: string): FlightHub | undefined {
  return flightHubs.find((h) => h.id === id)
}

// Direction matters — return flights are separate entries in the catalog
// with `from` swapped.
export function getRoutesFrom(hubId: string): readonly FlightRoute[] {
  return flightRoutes.filter((r) => r.from === hubId)
}

// Phase 6 graph adjacency — looks up jump edges on the starmap graph
// for the hub's underlying node. Returns the neighboring starmap nodes
// reachable via a single jump (with the edge taken). Hubs without a
// `nodeId` (not yet bound to the starmap) return an empty list.
//
// This is the captain-jump query: passenger flights remain driven by
// `flightRoutes` for the existing booking modal. Phase 6+ captain UI
// reads adjacency from here.
export function jumpEdgesFromHub(
  hubId: string,
): { node: StarmapNode; edge: JumpEdge }[] {
  const hub = getFlightHub(hubId)
  if (!hub || !hub.nodeId) return []
  return neighborsOf(hub.nodeId)
}
