// Phase 6.3.A — colony ownership save handler.
// Persists the set of player-owned colony POI records across save/load.
// Each record carries the poiId and the installed admin's EntityKey
// (null when no specific admin was designated in 6.3.A).

import { registerSaveHandler } from '../../save/registry'
import {
  getAllColonyRecords,
  restoreColonies,
  resetColonies,
  type ColonyRecord,
} from '../../sim/colony'

interface ColonyBlock {
  colonies: ColonyRecord[]
}

function snapshot(): ColonyBlock | undefined {
  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return undefined
  return { colonies }
}

function restore(blob: ColonyBlock): void {
  if (!blob.colonies) return
  restoreColonies(blob.colonies)
}

function reset(): void {
  resetColonies()
}

registerSaveHandler<ColonyBlock>({
  id: 'colonies',
  snapshot,
  restore,
  reset,
})
