import json5 from 'json5'
import raw from './transit.json5?raw'
import { isSceneId } from './scenes'

export type TransitPlacementKind = 'building' | 'airport' | 'fixed'

export interface TransitTerminal {
  id: string
  sceneId: string
  placement: TransitPlacementKind
  nameZh: string
  shortZh: string
  description?: string
  // Only present for placement='fixed'. For 'building' and 'airport' the
  // spawn-time positions live in sim/transitPlacements.ts.
  terminalTile?: { x: number; y: number }
  arrivalTile?: { x: number; y: number }
}

interface TransitFile {
  terminals: TransitTerminal[]
}

const parsed = json5.parse(raw) as TransitFile

for (const t of parsed.terminals) {
  if (!isSceneId(t.sceneId)) {
    throw new Error(`transit.json5: terminal "${t.id}" references unknown sceneId "${t.sceneId}"`)
  }
  if (t.placement === 'fixed') {
    if (!t.terminalTile || !t.arrivalTile) {
      throw new Error(`transit.json5: fixed terminal "${t.id}" needs terminalTile + arrivalTile`)
    }
  } else if (t.terminalTile || t.arrivalTile) {
    throw new Error(`transit.json5: terminal "${t.id}" placement=${t.placement} must not declare coords`)
  }
}

export const transitTerminals: readonly TransitTerminal[] = parsed.terminals

export function getTransitTerminal(id: string): TransitTerminal | undefined {
  return transitTerminals.find((t) => t.id === id)
}

// Same-scene only — cross-scene travel is the flight system. Listing
// destinations from another scene would let the player teleport between
// colonies for free.
export function getTransitDestinationsFor(sourceId: string): readonly TransitTerminal[] {
  const src = getTransitTerminal(sourceId)
  if (!src) return []
  return transitTerminals.filter((t) => t.sceneId === src.sceneId)
}
