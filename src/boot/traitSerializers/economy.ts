// Money / Skills / Inventory / JobPerformance. Always present on every
// Character post-setupWorld, so reset() is a no-op.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Inventory, JobPerformance, Money, Skills } from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof Money>>({
  id: 'money',
  trait: Money,
  read: (e) => ({ ...e.get(Money)! }),
  write: (e, v) => e.set(Money, v),
})

registerTraitSerializer<TraitInstance<typeof Skills>>({
  id: 'skills',
  trait: Skills,
  read: (e) => ({ ...e.get(Skills)! }),
  write: (e, v) => e.set(Skills, v),
})

registerTraitSerializer<TraitInstance<typeof Inventory>>({
  id: 'inventory',
  trait: Inventory,
  read: (e) => ({ ...e.get(Inventory)! }),
  write: (e, v) => e.set(Inventory, v),
})

registerTraitSerializer<TraitInstance<typeof JobPerformance>>({
  id: 'jobPerformance',
  trait: JobPerformance,
  read: (e) => ({ ...e.get(JobPerformance)! }),
  write: (e, v) => e.set(JobPerformance, v),
})
