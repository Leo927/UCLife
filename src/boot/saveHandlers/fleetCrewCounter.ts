// Phase 6.2.D — `npc-crew-<N>` key counter persisted across save/load
// so a reload doesn't reuse a previously-issued key for a fresh hire.
// Same shape as the immigrant counter in src/systems/population.ts:
// scalar global state that survives reseed.

import { registerSaveHandler } from '../../save/registry'
import {
  getCrewKeyCounter, setCrewKeyCounter, resetCrewKeyCounter,
} from '../../systems/fleetCrew'

registerSaveHandler<number>({
  id: 'fleetCrewCounter',
  snapshot: () => getCrewKeyCounter(),
  restore: (n) => setCrewKeyCounter(typeof n === 'number' ? n : 0),
  reset: () => resetCrewKeyCounter(),
})
