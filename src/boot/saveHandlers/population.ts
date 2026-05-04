// Population counters (immigrant id seed, last spawn time, anonymous
// name counter). Persisted so reload doesn't reuse keys from prior
// immigrants.

import { registerSaveHandler } from '../../save/registry'
import {
  getPopulationState,
  setPopulationState,
  resetPopulationClock,
} from '../../systems/population'

type PopulationBlock = ReturnType<typeof getPopulationState>

registerSaveHandler<PopulationBlock>({
  id: 'population',
  snapshot: () => getPopulationState(),
  restore: (block) => setPopulationState(block),
  reset: () => resetPopulationClock(),
})
