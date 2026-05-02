// Runtime registry of airport positions. Each procgen-spawned airport
// records its ticket-counter pixel coords and its fly-in arrival pixel
// coords here, keyed by the FlightHub id. The FlightModal, TransitMap,
// and cross-scene migration all read from this registry instead of
// flights.json5's static data — those static fields were dropped when
// airports moved into procgen.
//
// `setupWorld` clears + repopulates the map on every world rebuild, so
// state survives scene swaps but resets cleanly on save reload (which
// re-runs setupWorld via determinism).

export type AirportPlacement = {
  counterPx: { x: number; y: number }
  arrivalPx: { x: number; y: number }
  // Building footprint in tile coords. Used by MapPanel to render the
  // airport marker — the map needs a rect at procgen-determined position.
  rectTile: { x: number; y: number; w: number; h: number }
}

const placements = new Map<string, AirportPlacement>()

export function setAirportPlacement(hubId: string, p: AirportPlacement): void {
  placements.set(hubId, p)
}

export function getAirportPlacement(hubId: string): AirportPlacement | null {
  return placements.get(hubId) ?? null
}

export function clearAirportPlacements(): void {
  placements.clear()
}
