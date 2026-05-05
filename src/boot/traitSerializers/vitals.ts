// Vital state + Health + current Action. Always present on player + NPC
// post-setupWorld, so reset() is a no-op.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Action, Health, Vitals } from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof Vitals>>({
  id: 'vitals',
  trait: Vitals,
  read: (e) => ({ ...e.get(Vitals)! }),
  write: (e, v) => e.set(Vitals, v),
})

registerTraitSerializer<TraitInstance<typeof Health>>({
  id: 'health',
  trait: Health,
  read: (e) => ({ ...e.get(Health)! }),
  write: (e, v) => e.set(Health, v),
})

registerTraitSerializer<TraitInstance<typeof Action>>({
  id: 'action',
  trait: Action,
  read: (e) => ({ ...e.get(Action)! }),
  write: (e, v) => e.set(Action, v),
})
