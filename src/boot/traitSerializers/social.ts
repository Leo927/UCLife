// Social-layer traits: rough-source use, chat target/line, reputation,
// job tenure, faction role.
//
// Lifecycle differs:
//   RoughUse, ChatTarget, ChatLine, Reputation, JobTenure — added at
//     runtime (rough-spot use, chat session, faction interaction, hire);
//     reset() removes them so a load from before the trait was added
//     doesn't leave stale state.
//   FactionRole — always added by spawnNPC; reset() is a no-op.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import {
  ChatLine, ChatTarget, FactionRole, JobTenure, Reputation, RoughUse,
} from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof RoughUse>>({
  id: 'roughUse',
  trait: RoughUse,
  read: (e) => ({ ...e.get(RoughUse)! }),
  write: (e, v) => {
    if (e.has(RoughUse)) e.set(RoughUse, v)
    else e.add(RoughUse(v))
  },
  reset: (e) => { if (e.has(RoughUse)) e.remove(RoughUse) },
})

interface ChatTargetSnap { partnerKey: string | null }
registerTraitSerializer<ChatTargetSnap>({
  id: 'chatTarget',
  trait: ChatTarget,
  read: (e, ctx) => ({ partnerKey: ctx.keyOf(e.get(ChatTarget)!.partner) }),
  write: (e, v, ctx) => {
    const partner = ctx.resolveRef(v.partnerKey)
    if (e.has(ChatTarget)) e.set(ChatTarget, { partner })
    else e.add(ChatTarget({ partner }))
  },
  reset: (e) => { if (e.has(ChatTarget)) e.remove(ChatTarget) },
})

registerTraitSerializer<TraitInstance<typeof ChatLine>>({
  id: 'chatLine',
  trait: ChatLine,
  read: (e) => ({ ...e.get(ChatLine)! }),
  write: (e, v) => {
    if (e.has(ChatLine)) e.set(ChatLine, v)
    else e.add(ChatLine(v))
  },
  reset: (e) => { if (e.has(ChatLine)) e.remove(ChatLine) },
})

interface ReputationSnap {
  rep: TraitInstance<typeof Reputation>['rep']
}
registerTraitSerializer<ReputationSnap>({
  id: 'reputation',
  trait: Reputation,
  // Clone the inner rep map so live-trait mutations don't leak into the
  // snapshot.
  read: (e) => ({ rep: { ...e.get(Reputation)!.rep } }),
  write: (e, v) => {
    const payload = { rep: { ...v.rep } }
    if (e.has(Reputation)) e.set(Reputation, payload)
    else e.add(Reputation(payload))
  },
  reset: (e) => { if (e.has(Reputation)) e.remove(Reputation) },
})

registerTraitSerializer<TraitInstance<typeof JobTenure>>({
  id: 'jobTenure',
  trait: JobTenure,
  read: (e) => ({ ...e.get(JobTenure)! }),
  write: (e, v) => {
    if (e.has(JobTenure)) e.set(JobTenure, v)
    else e.add(JobTenure(v))
  },
  reset: (e) => { if (e.has(JobTenure)) e.remove(JobTenure) },
})

registerTraitSerializer<TraitInstance<typeof FactionRole>>({
  id: 'factionRole',
  trait: FactionRole,
  read: (e) => ({ ...e.get(FactionRole)! }),
  write: (e, v) => {
    if (e.has(FactionRole)) e.set(FactionRole, v)
    else e.add(FactionRole(v))
  },
  reset: (e) => { if (e.has(FactionRole)) e.remove(FactionRole) },
})
