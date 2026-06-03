// Phase 6.3.D — brig-overflow → colony detention routing.
//
// When the flagship brig is over capacity (prisoners accumulate in less-secure
// overflow quarters), this system routes surplus prisoners to a docked colony's
// detention facility. Called when the flagship docks at a player-owned colony.
//
// Perf budget: fires only at dock when the brig is over capacity — O(surplus
// prisoners), one-shot. Trivially sub-budget.

import { isPlayerColony, addDetentionOccupant, getDetentionCapacity, getDetentionOccupants } from '../sim/colony'
import { useBrig } from '../sim/brig'

export interface DetentionRoutingResult {
  routed: number
  detentionFull: boolean
}

// Route overflow prisoners from the brig to colony detention.
// Removes routed prisoners from the overflow queue.
// Returns the number routed and whether detention is now full.
export function routeBrigOverflowToColonyDetention(poiId: string): DetentionRoutingResult {
  if (!isPlayerColony(poiId)) {
    return { routed: 0, detentionFull: false }
  }

  const { overflowPrisoners } = useBrig.getState()
  if (overflowPrisoners.length === 0) {
    return { routed: 0, detentionFull: false }
  }

  const capacity = getDetentionCapacity()
  const currentOccupants = getDetentionOccupants(poiId)
  let available = capacity - currentOccupants.length
  let routed = 0

  const remaining: typeof overflowPrisoners = []
  for (const prisoner of overflowPrisoners) {
    if (available > 0 && prisoner.entityKey !== '') {
      const added = addDetentionOccupant(poiId, prisoner.entityKey)
      if (added) {
        available -= 1
        routed += 1
        continue
      }
    }
    remaining.push(prisoner)
  }

  if (routed > 0) {
    const brigState = useBrig.getState()
    brigState.clearOverflow()
    for (const p of remaining) brigState.addToOverflow(p)
  }

  const detentionFull = getDetentionOccupants(poiId).length >= capacity
  return { routed, detentionFull }
}
