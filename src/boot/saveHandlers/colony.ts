// Phase 6.3.A — colony ownership save handler.
// Phase 6.3.B — extended with per-colony economics state.
// Phase 6.3.C — extended with construction jobs + build-path state.

import { registerSaveHandler } from '../../save/registry'
import {
  getAllColonyRecords,
  getAllColonyEconomicsEntries,
  getAllConstructionJobEntries,
  restoreColonies,
  restoreConstructionJobs,
  resetColonies,
  resetConstructionState,
  getBuildPathState,
  setBuildPathState,
  type ColonyRecord,
  type ColonyEconomicsState,
  type ConstructionJob,
  type BuildPathState,
} from '../../sim/colony'

interface ColonyBlock {
  colonies: ColonyRecord[]
  economics?: Array<{ poiId: string; state: ColonyEconomicsState }>
  // Phase 6.3.C additions.
  constructionJobs?: Array<{ poiId: string; jobs: ConstructionJob[] }>
  buildPathState?: BuildPathState
}

function snapshot(): ColonyBlock | undefined {
  const colonies = getAllColonyRecords()
  const constructionJobs = getAllConstructionJobEntries()
  const buildPath = getBuildPathState()
  // Always snapshot if there's anything — construction jobs or build-path
  // state may exist even without a claimed colony (charter granted, package
  // bought but not yet dropped).
  if (
    colonies.length === 0 &&
    constructionJobs.length === 0 &&
    !buildPath.charterGranted &&
    !buildPath.packageInFleet
  ) {
    return undefined
  }
  const economics = getAllColonyEconomicsEntries()
  return { colonies, economics, constructionJobs, buildPathState: buildPath }
}

function restore(blob: ColonyBlock): void {
  if (blob.colonies) restoreColonies(blob.colonies, blob.economics)
  if (blob.constructionJobs) restoreConstructionJobs(blob.constructionJobs)
  if (blob.buildPathState) setBuildPathState(blob.buildPathState)
}

function reset(): void {
  resetColonies()
  resetConstructionState()
}

registerSaveHandler<ColonyBlock>({
  id: 'colonies',
  snapshot,
  restore,
  reset,
})
