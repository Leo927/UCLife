// Airport + transit-terminal introspection. listAirports / movePlayerToAirport
// drive scene-swap tests; flightHubCount + listTransitTerminals are
// tripwires for procgen drift (city must spawn the expected hubs).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, getWorld } from '../../ecs/world'
import { IsPlayer, Position, MoveTarget, FlightHub, Transit } from '../../ecs/traits'
import { flightHubs } from '../../data/flights'
import { transitTerminals } from '../../data/transit'
import { getAirportPlacement } from '../../sim/airportPlacements'
import { getTransitPlacement } from '../../sim/transitPlacements'

registerDebugHandle('listAirports', () => {
  return flightHubs.map((h) => ({
    hubId: h.id,
    sceneId: h.sceneId,
    nameZh: h.nameZh,
    placement: getAirportPlacement(h.id),
  }))
})

registerDebugHandle('listTransitTerminals', () => {
  return transitTerminals.map((t) => {
    const w = getWorld(t.sceneId)
    let live = false
    for (const e of w.query(Transit)) {
      const tr = e.get(Transit)
      if (tr && tr.terminalId === t.id) { live = true; break }
    }
    return {
      id: t.id,
      sceneId: t.sceneId,
      placement: t.placement,
      nameZh: t.nameZh,
      live,
      registered: !!getTransitPlacement(t.id),
    }
  })
})

registerDebugHandle('movePlayerToAirport', (hubId: string) => {
  const p = getAirportPlacement(hubId)
  if (!p) return false
  for (const e of world.query(IsPlayer, Position)) {
    e.set(Position, p.counterPx)
    e.set(MoveTarget, p.counterPx)
    return true
  }
  return false
})

registerDebugHandle('flightHubCount', () => {
  let n = 0
  for (const _ of world.query(FlightHub)) n++
  return n
})
