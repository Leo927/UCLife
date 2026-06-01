import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getGameState } from '../../test/gameStateView'
import { applyFixture } from '../../test/fixtures'
import { claimColony } from '../../sim/colony'

registerDebugHandle('getGameState', getGameState)
registerDebugHandle('applyFixture', applyFixture)
// Phase 6.3.A — colony ownership verb for deterministic tests.
// Call claimColony(poiId, adminEntityKey | null) to seal ownership
// without going through the UI panel. adminEntityKey may be null in 6.3.A.
registerDebugHandle('claimColony', claimColony)
