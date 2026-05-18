import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getGameState } from '../../test/gameStateView'
import { applyFixture } from '../../test/fixtures'

registerDebugHandle('getGameState', getGameState)
registerDebugHandle('applyFixture', applyFixture)
