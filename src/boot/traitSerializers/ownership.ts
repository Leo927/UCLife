// Phase 5.5 ownership traits.
//
// Faction: faction entities are bootstrapped by setupWorld() (deterministic)
// but their fund mutates over time (Phase 5.5.2 introduces revenue/payroll).
//
// Owner: only persisted as an entity-key indirection. Buildings respawn from
// seed with a default Owner; the saved snapshot overlays the deltas (private
// NPC owner picks, player purchases). State and faction owners reuse the
// rebuilt entity refs via EntityKey resolution.
//
// Facility (5.5.2): per-Building daily-economics state. setupWorld attaches
// it fresh on every spawn; the save round-trip patches in the runtime
// fields (acc, insolvency counter, closed flags) so a save mid-grace-period
// preserves the warning state.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { Faction, Owner, Facility } from '../../ecs/traits'

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

interface FacilitySnap {
  revenueAcc: number
  salariesAcc: number
  insolventDays: number
  lastRolloverDay: number
  closedSinceDay: number
  closedReason: 'insolvent' | null
}

registerTraitSerializer<FacilitySnap>({
  id: 'facility',
  trait: Facility,
  read: (e) => ({ ...e.get(Facility)! }),
  write: (e, v) => {
    if (e.has(Facility)) e.set(Facility, v)
    else e.add(Facility(v))
  },
})
