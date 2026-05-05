// Conditions trait — round-trips the per-character active condition
// list. POJO instances; no entity references — `source` is a plain
// string, `bodyPart` is a string enum or null, so superjson handles
// them without entity-key indirection.
//
// Templates are not serialized (they're code, loaded from
// conditions.json5 at module import). Saves load against current
// templates; renaming a template id breaks instance.templateId
// resolution, which is why physiology-data.md mandates tombstoning
// retired ids rather than deleting them.

import { registerTraitSerializer } from '../../save/traitRegistry'
import { Conditions, type ConditionInstance } from '../../ecs/traits'

interface ConditionsSnap {
  list: ConditionInstance[]
}

registerTraitSerializer<ConditionsSnap>({
  id: 'conditions',
  trait: Conditions,
  read: (e) => {
    const c = e.get(Conditions)!
    return {
      list: c.list.map((x) => ({ ...x, activeBands: [...x.activeBands] })),
    }
  },
  write: (e, v) => {
    const list = v.list.map((x) => ({ ...x, activeBands: [...x.activeBands] }))
    if (e.has(Conditions)) e.set(Conditions, { list })
    else e.add(Conditions({ list }))
  },
  reset: (e) => {
    if (e.has(Conditions)) e.set(Conditions, { list: [] })
  },
})
