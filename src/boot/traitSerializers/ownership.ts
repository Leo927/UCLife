// Phase 5.5 ownership traits.
//
// Faction: faction entities are bootstrapped by setupWorld() (deterministic)
// but their fund mutates over time (Phase 5.5.2 introduces revenue/payroll).
//
// Owner: only persisted as an entity-key indirection. Buildings respawn from
// seed with a default Owner; the saved snapshot overlays the deltas (private
// NPC owner picks, player purchases). State and faction owners reuse the
// rebuilt entity refs via EntityKey resolution.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Faction, Owner } from '../../ecs/traits'

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

interface OwnerSnap {
  kind: 'state' | 'faction' | 'character'
  ownerKey: string | null
}

registerTraitSerializer<OwnerSnap>({
  id: 'owner',
  trait: Owner,
  read: (e, ctx) => {
    const o = e.get(Owner)!
    return { kind: o.kind, ownerKey: ctx.keyOf(o.entity) }
  },
  write: (e, v, ctx) => {
    const entity = ctx.resolveRef(v.ownerKey)
    if (e.has(Owner)) e.set(Owner, { kind: v.kind, entity })
    else e.add(Owner({ kind: v.kind, entity }))
  },
})
