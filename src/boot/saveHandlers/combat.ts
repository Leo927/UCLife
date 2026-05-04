// Combat is transient by design — combat-time saves are refused (see
// saveGame's mode==='combat' guard). This handler only runs on load,
// resetting any stale store state (open modal, paused flag, charge
// timers) regardless of what the bundle says.

import { registerSaveHandler } from '../../save/registry'
import { useCombatStore } from '../../systems/combat'

registerSaveHandler({
  id: 'combat',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => useCombatStore.getState().reset(),
})
