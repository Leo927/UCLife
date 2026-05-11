// Phase 6.2 — flagship brig POW roster. Long-arc state (POWs ride with
// the ship between encounters until 6.2.5+ verbs resolve them); shape is
// trivial enough to ride as a single block.

import { registerSaveHandler } from '../../save/registry'
import { useBrig, type SerializedBrig } from '../../sim/brig'

registerSaveHandler<SerializedBrig>({
  id: 'brig',
  snapshot: () => useBrig.getState().serialize(),
  restore: (block) => useBrig.getState().hydrate(block),
  reset: () => useBrig.getState().reset(),
})
