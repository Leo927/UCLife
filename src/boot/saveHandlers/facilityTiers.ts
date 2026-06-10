// Phase 5.5.6 — facility-tier state, keyed by per-Building EntityKey.
// Phase 'post' because restore must run after the entity overlay has
// rebuilt every Building: the world re-derives from seed (tier-1 layouts
// only), so restoring a completed jobSiteCount tier also respawns its
// seats (idempotent via deterministic seat EntityKeys — see
// restoreFacilityTiers).

import { registerSaveHandler } from '../../save/registry'
import { SCENE_IDS, getWorld } from '../../ecs/world'
import {
  snapshotFacilityTiers, restoreFacilityTiers, type FacilityTierSnap,
} from '../../systems/facilityTiers'

registerSaveHandler<Record<string, FacilityTierSnap[]>>({
  id: 'facilityTiers',
  phase: 'post',
  snapshot: () => {
    const out: Record<string, FacilityTierSnap[]> = {}
    for (const id of SCENE_IDS) {
      const snaps = snapshotFacilityTiers(getWorld(id))
      if (snaps.length > 0) out[id] = snaps
    }
    return out
  },
  restore: (blob) => {
    for (const id of SCENE_IDS) {
      const snaps = blob[id]
      if (snaps && snaps.length > 0) restoreFacilityTiers(getWorld(id), snaps)
    }
  },
  reset: () => {
    // Tier state lives on Building entities; world resets clear it.
  },
})
