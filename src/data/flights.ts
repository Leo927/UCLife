import json5 from 'json5'
import raw from './flights.json5?raw'
import { isSceneId } from './scenes'
import type { SceneId } from '../ecs/world'

// Static metadata about a flight hub. The hub's runtime location (ticket
// counter + arrival point) is procgen-determined per airport spawn — see
// sim/airportPlacements.ts. `id` is referenced by routes; `sceneId` binds
// the hub 1:1 to the airport spawned in that scene's procgen.
export interface FlightHub {
  id: string
  nameZh: string
  shortZh: string
  sceneId: SceneId
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
