// Session-only engagement modal state. The spaceSim contact-detection
// step calls prompt() when the player ship enters an enemy's contact
// radius; the modal renders three choices (engage/flee/negotiate) and
// resolve() routes them — engage hands off to the existing tactical
// combat store (systems/combat.ts), flee applies the standard flee
// penalty (hull/armor scuff + CR drain) and lets the ship coast on,
// negotiate is a not-yet-implemented stub.
//
// Not persisted to save (slice 8) — engagement is transient by design.

import { create } from 'zustand'
import { startCombat, applyFleePenalty } from '../systems/combat'
import { emitSim } from './events'
import { isEnemyShipId } from '../data/enemyShips'

export type EngagementChoice = 'engage' | 'flee' | 'negotiate'

interface EngagementState {
  open: boolean
  enemyKey: string | null
  enemyShipClassId: string | null
  // Lead ship's wingmen — joins the lead in the tactical arena. Empty
  // = solo encounter.
  enemyEscorts: string[]
  // Phase 6.2 — slot-keyed named-captain ids carried through to
  // startCombat so destruction events know which row to capture.
  enemyNotableCaptains: Record<string, string>
  prompt: (
    enemyKey: string,
    shipClassId: string,
    escorts: string[],
    notableCaptains: Record<string, string>,
  ) => void
  resolve: (choice: EngagementChoice) => void
  dismiss: () => void
}

function resolveCombatClassId(spaceClassId: string): string {
  if (isEnemyShipId(spaceClassId)) return spaceClassId
  return 'pirateLight'
}

export const useEngagement = create<EngagementState>((set, get) => ({
  open: false,
  enemyKey: null,
  enemyShipClassId: null,
  enemyEscorts: [],
  enemyNotableCaptains: {},
  prompt(enemyKey, shipClassId, escorts, notableCaptains) {
    if (get().open) return
    set({
      open: true,
      enemyKey,
      enemyShipClassId: shipClassId,
      enemyEscorts: escorts,
      enemyNotableCaptains: notableCaptains,
    })
  },
  resolve(choice) {
    const s = get()
    if (!s.open) return
    const classId = s.enemyShipClassId
    const escorts = s.enemyEscorts
    const key = s.enemyKey
    const captains = s.enemyNotableCaptains
    set({
      open: false,
      enemyKey: null,
      enemyShipClassId: null,
      enemyEscorts: [],
      enemyNotableCaptains: {},
    })
    if (choice === 'engage') {
      if (classId) {
        const escortClassIds = escorts
          .map((id) => (isEnemyShipId(id) ? id : 'pirateLight'))
        startCombat(resolveCombatClassId(classId), escortClassIds, key, captains)
      }
    } else if (choice === 'flee') {
      // Modal-flee disengages without committing to combat — applies the
      // flee penalty (hull/armor scuff + CR drain) since pulling away
      // hot from contact range isn't free in Starsector-shape combat.
      applyFleePenalty()
    } else if (choice === 'negotiate') {
      emitSim('toast', { textZh: '谈判尚未实装' })
    }
  },
  dismiss() {
    set({
      open: false,
      enemyKey: null,
      enemyShipClassId: null,
      enemyEscorts: [],
      enemyNotableCaptains: {},
    })
  },
}))

// Save/load reset hook — clears any stale modal state. The contact-detection
// re-prompt cooldown map lives in spaceSim.ts and is wiped by
// resetSpaceSimFlags(); this companion call drops the modal store itself so a
// load taken with the engagement modal open doesn't leave a ghost prompt.
export function resetEngagementCooldowns(): void {
  useEngagement.setState({
    open: false,
    enemyKey: null,
    enemyShipClassId: null,
    enemyEscorts: [],
    enemyNotableCaptains: {},
  })
}
