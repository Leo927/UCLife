// Phase 5.5 ownership traits. Faction is the only one persisted right now:
// faction entities are bootstrapped by setupWorld() (deterministic) but
// their fund mutates over time (Phase 5.5.2 introduces revenue/payroll).
//
// Owner has no serializer yet — Phase 5.5.0 buildings don't carry EntityKey
// and their default Owner is rebuilt from seed by spawnBuilding. Phase 5.5.1
// adds an Owner serializer alongside building-level EntityKeys when player-
// driven acquisition lands.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Faction } from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof Faction>>({
  id: 'faction',
  trait: Faction,
  read: (e) => ({ ...e.get(Faction)! }),
  write: (e, v) => {
    if (e.has(Faction)) e.set(Faction, v)
    else e.add(Faction(v))
  },
  reset: (e) => { if (e.has(Faction)) e.remove(Faction) },
})
