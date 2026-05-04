// Runtime registry of transit-terminal positions. Procgen'd terminals
// (the central transitTerminal building, and the kiosk embedded in each
// airport) record their spawn-time positions here, keyed by terminal id.
// Hand-placed terminals (placement='fixed' in transit.json5) also write
// here so all UI/migration position lookups go through one path.
//
// `setupWorld` clears + repopulates the map on every world rebuild.

export type TransitPlacement = {
  // Pixel coords of the terminal entity (where the kiosk sprite sits).
  terminalPx: { x: number; y: number }
  // Pixel coords the player teleports to when this terminal is the
  // chosen destination — one tile next to the terminal so the click
  // doesn't immediately retrigger.
  arrivalPx: { x: number; y: number }
}

const placements = new Map<string, TransitPlacement>()

export function setTransitPlacement(terminalId: string, p: TransitPlacement): void {
  placements.set(terminalId, p)
}

export function getTransitPlacement(terminalId: string): TransitPlacement | null {
  return placements.get(terminalId) ?? null
}

export function clearTransitPlacements(): void {
  placements.clear()
}
