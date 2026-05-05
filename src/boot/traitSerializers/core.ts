// Core identity + spatial traits. These are always (re-)created by
// setupWorld(), so reset() is a no-op — the snapshot's absence implies
// the entity simply isn't a Character/Position-bearing entity, not that
// the trait was added at runtime and now needs removal.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Character, MoveTarget, Position } from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof Character>>({
  id: 'character',
  trait: Character,
  read: (e) => ({ ...e.get(Character)! }),
  write: (e, v) => e.set(Character, v),
})

registerTraitSerializer<TraitInstance<typeof Position>>({
  id: 'position',
  trait: Position,
  read: (e) => ({ ...e.get(Position)! }),
  write: (e, v) => e.set(Position, v),
})

registerTraitSerializer<TraitInstance<typeof MoveTarget>>({
  id: 'moveTarget',
  trait: MoveTarget,
  read: (e) => ({ ...e.get(MoveTarget)! }),
  write: (e, v) => e.set(MoveTarget, v),
})
