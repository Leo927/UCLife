// Phase 6.3.A — colony ownership save handler.
// Phase 6.3.B — extended with per-colony economics state.
// Phase 6.3.C — extended with construction jobs and build-path state
//               (charter grant, establishment package flag).
// Phase 6.3.D — extended with officer role assignments and detention occupants.
// Persists the set of player-owned colony POI records + economics state
// across save/load. Each record carries the poiId, the installed admin's
// EntityKey (null when no specific admin was designated in 6.3.A), plus
// the 6.3.B stability/income/warehouse block, 6.3.C construction state,
// and 6.3.D role assignments + detention occupants.

import { registerSaveHandler } from '../../save/registry'
import {
  getAllColonyRecords,
  getAllColonyEconomicsEntries,
  getAllConstructionJobEntries,
  getBuildPathState,
  restoreColonies,
  resetColonies,
  type ColonyRecord,
  type ColonyEconomicsState,
  type ConstructionJob,
  type BuildPathState,
} from '../../sim/colony'
import { getPrimaryDockScene } from '../../data/pois'
import { getWorld } from '../../ecs/world'
import { Building } from '../../ecs/traits'
import { getBuildingType } from '../../data/buildingTypes'

interface ColonyBlock {
  colonies: ColonyRecord[]
  economics?: Array<{ poiId: string; state: ColonyEconomicsState }>
  construction?: Array<{ poiId: string; jobs: ConstructionJob[] }>
  buildPath?: BuildPathState
}

function snapshot(): ColonyBlock | undefined {
  const colonies = getAllColonyRecords()
  const economics = getAllColonyEconomicsEntries()
  const construction = getAllConstructionJobEntries().filter((e) => e.jobs.length > 0)
  const buildPath = getBuildPathState()
  const hasBuildPathData = buildPath.charterGranted || buildPath.hasEstablishmentPackage || buildPath.pirateAttentionFlag
  if (colonies.length === 0 && construction.length === 0 && !hasBuildPathData) return undefined
  return {
    colonies,
    economics,
    construction: construction.length > 0 ? construction : undefined,
    buildPath: hasBuildPathData ? buildPath : undefined,
  }
}

function restore(blob: ColonyBlock): void {
  if (!blob.colonies) return
  restoreColonies(blob.colonies, blob.economics, blob.construction, blob.buildPath)
  respawnCompletedFacilities(blob.construction)
}

function respawnCompletedFacilities(
  construction: Array<{ poiId: string; jobs: ConstructionJob[] }> | undefined,
): void {
  if (!construction) return
  for (const { poiId, jobs } of construction) {
    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) continue
    const w = getWorld(sceneId)
    for (const job of jobs) {
      if (job.status !== 'completed') continue
      const bldType = getBuildingType(job.facilityTypeId)
      w.spawn(Building({ typeId: job.facilityTypeId, label: bldType.labelZh, x: 0, y: 0, w: 0, h: 0 }))
    }
  }
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
