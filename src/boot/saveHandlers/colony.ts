// Phase 6.3.A — colony ownership save handler.
// Phase 6.3.B — extended with per-colony economics state.
// Persists the set of player-owned colony POI records + economics state
// across save/load. Each record carries the poiId, the installed admin's
// EntityKey (null when no specific admin was designated in 6.3.A), plus
// the 6.3.B stability/income/warehouse block.

import { registerSaveHandler } from '../../save/registry'
import {
  getAllColonyRecords,
  getAllColonyEconomicsEntries,
  restoreColonies,
  resetColonies,
  type ColonyRecord,
  type ColonyEconomicsState,
} from '../../sim/colony'

interface ColonyBlock {
  colonies: ColonyRecord[]
  economics?: Array<{ poiId: string; state: ColonyEconomicsState }>
}

function snapshot(): ColonyBlock | undefined {
  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return undefined
  const economics = getAllColonyEconomicsEntries()
  return { colonies, economics }
}

function restore(blob: ColonyBlock): void {
  if (!blob.colonies) return
  restoreColonies(blob.colonies, blob.economics)
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
