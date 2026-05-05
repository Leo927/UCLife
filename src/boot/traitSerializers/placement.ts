// Bed / BarSeat / RoughSpot / Workstation. Static fields (tier,
// nightlyRent, specId) are rebuilt by setupWorld() — only the mutable
// occupant ref + (for beds) rent/owned state need persisting. Loader
// patches in place to preserve setupWorld's rebuilt static fields.
//
// reset() is a no-op: these traits are always present on the structural
// entities setupWorld created, so a snap-absent case means "no entity
// here", not "remove this trait".

import { registerTraitSerializer } from '../../save/traitRegistry'
import { Bed, BarSeat, RoughSpot, Workstation } from '../../ecs/traits'

interface BedSnap {
  occupant: string | null
  rentPaidUntilMs: number
  owned: boolean
}
registerTraitSerializer<BedSnap>({
  id: 'bed',
  trait: Bed,
  read: (e, ctx) => {
    const b = e.get(Bed)!
    return {
      occupant: ctx.keyOf(b.occupant),
      rentPaidUntilMs: b.rentPaidUntilMs,
      owned: b.owned,
    }
  },
  write: (e, v, ctx) => {
    const cur = e.get(Bed)!
    e.set(Bed, {
      ...cur,
      occupant: ctx.resolveRef(v.occupant),
      rentPaidUntilMs: v.rentPaidUntilMs,
      owned: v.owned,
    })
  },
})

interface OccupantOnly { occupant: string | null }

registerTraitSerializer<OccupantOnly>({
  id: 'barSeat',
  trait: BarSeat,
  read: (e, ctx) => ({ occupant: ctx.keyOf(e.get(BarSeat)!.occupant) }),
  write: (e, v, ctx) => e.set(BarSeat, { occupant: ctx.resolveRef(v.occupant) }),
})

registerTraitSerializer<OccupantOnly>({
  id: 'roughSpot',
  trait: RoughSpot,
  read: (e, ctx) => ({ occupant: ctx.keyOf(e.get(RoughSpot)!.occupant) }),
  write: (e, v, ctx) => e.set(RoughSpot, { occupant: ctx.resolveRef(v.occupant) }),
})

registerTraitSerializer<OccupantOnly>({
  id: 'workstation',
  trait: Workstation,
  read: (e, ctx) => ({ occupant: ctx.keyOf(e.get(Workstation)!.occupant) }),
  write: (e, v, ctx) => {
    const cur = e.get(Workstation)!
    e.set(Workstation, { ...cur, occupant: ctx.resolveRef(v.occupant) })
  },
})
