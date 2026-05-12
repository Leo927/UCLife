// Phase 6.2.D — EmployedAsCrew trait. Sits on any NPC the player has
// hired as captain or crew of one of their ships. The Ship entity holds
// the inverse references (assignedCaptainId + crewIds), so this trait
// is the per-NPC "I belong to ship X" marker that gates the BT's job-
// seek loop + the hire-branch eligibility check.

import { registerTraitSerializer } from '../../save/traitRegistry'
import { EmployedAsCrew } from '../../ecs/traits'

interface EmployedAsCrewSnap {
  shipKey: string
  role: 'captain' | 'crew'
}

registerTraitSerializer<EmployedAsCrewSnap>({
  id: 'employedAsCrew',
  trait: EmployedAsCrew,
  read: (e) => {
    const r = e.get(EmployedAsCrew)!
    return { shipKey: r.shipKey, role: r.role }
  },
  write: (e, v) => {
    if (e.has(EmployedAsCrew)) e.set(EmployedAsCrew, v)
    else e.add(EmployedAsCrew(v))
  },
})
