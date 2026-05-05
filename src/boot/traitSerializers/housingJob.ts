// Job / Home / PendingEviction.
//
// Job is added by spawnNPC and the player bootstrap, so it is always
// present on a Character entity post-setupWorld; reset() is a no-op.
// Home + PendingEviction are added at runtime (rented bed, eviction
// notice) — reset() removes them so a load from a save where the player
// was homeless / not pending eviction doesn't keep stale traits.

import { registerTraitSerializer } from '../../save/traitRegistry'
import { Home, Job, PendingEviction } from '../../ecs/traits'

interface JobSnap {
  workstationKey: string | null
  unemployedSinceMs: number
}
registerTraitSerializer<JobSnap>({
  id: 'job',
  trait: Job,
  read: (e, ctx) => {
    const j = e.get(Job)!
    return {
      workstationKey: ctx.keyOf(j.workstation),
      unemployedSinceMs: j.unemployedSinceMs,
    }
  },
  write: (e, v, ctx) => {
    e.set(Job, {
      workstation: ctx.resolveRef(v.workstationKey),
      unemployedSinceMs: v.unemployedSinceMs,
    })
  },
})

interface HomeSnap { bedKey: string | null }
registerTraitSerializer<HomeSnap>({
  id: 'home',
  trait: Home,
  read: (e, ctx) => ({ bedKey: ctx.keyOf(e.get(Home)!.bed) }),
  write: (e, v, ctx) => {
    const bed = ctx.resolveRef(v.bedKey)
    if (e.has(Home)) e.set(Home, { bed })
    else e.add(Home({ bed }))
  },
  reset: (e) => { if (e.has(Home)) e.remove(Home) },
})

interface PendingEvictionSnap {
  bedKey: string | null
  expireMs: number
}
registerTraitSerializer<PendingEvictionSnap>({
  id: 'pendingEviction',
  trait: PendingEviction,
  read: (e, ctx) => {
    const p = e.get(PendingEviction)!
    return { bedKey: ctx.keyOf(p.bedEntity), expireMs: p.expireMs }
  },
  write: (e, v, ctx) => {
    const bedEntity = ctx.resolveRef(v.bedKey)
    if (e.has(PendingEviction)) e.set(PendingEviction, { bedEntity, expireMs: v.expireMs })
    else e.add(PendingEviction({ bedEntity, expireMs: v.expireMs }))
  },
  reset: (e) => { if (e.has(PendingEviction)) e.remove(PendingEviction) },
})
