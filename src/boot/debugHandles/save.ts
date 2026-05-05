// saveGame / loadGame are exposed verbatim — smoke tests drive them
// directly so save bundle round-trips run on the same code path the
// menu uses.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { saveGame, loadGame } from '../../save'

registerDebugHandle('saveGame', saveGame)
registerDebugHandle('loadGame', loadGame)
