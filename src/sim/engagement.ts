// Session-only engagement modal state. The spaceSim contact-detection
// step calls prompt() when the player ship enters an enemy's contact
// radius; the modal renders three choices (engage/flee/negotiate) and
// resolve() routes them — engage hands off to the existing tactical
// combat store (systems/combat.ts), flee logs an event and lets the
// ship coast on, negotiate is a not-yet-implemented stub.
//
// Not persisted to save (slice 8) — engagement is transient by design.

import { create } from 'zustand'
import { startCombat } from '../systems/combat'
import { emitSim } from './events'
import { isEnemyShipId } from '../data/enemyShips'

export type EngagementChoice = 'engage' | 'flee' | 'negotiate'

interface EngagementState {
  open: boolean
  enemyKey: string | null
  enemyShipClassId: string | null
  prompt: (enemyKey: string, shipClassId: string) => void
  resolve: (choice: EngagementChoice) => void
  dismiss: () => void
}

// Maps space-entities shipClassIds to the available combat blueprints in
// enemyShips.json5. The space-entities data uses Phase-6.0-spine names
// (pirate_skirmisher / pirate_raider) but combat currently only ships the
// pirateLight blueprint — slice 7+ will broaden the roster. Falls back to
// pirateLight for any unmapped id.
const COMBAT_CLASS_MAP: Record<string, string> = {
  pirate_skirmisher: 'pirateLight',
  pirate_raider: 'pirateLight',
}

function resolveCombatClassId(spaceClassId: string): string {
  const mapped = COMBAT_CLASS_MAP[spaceClassId]
  if (mapped && isEnemyShipId(mapped)) return mapped
  if (isEnemyShipId(spaceClassId)) return spaceClassId
  return 'pirateLight'
}

export const useEngagement = create<EngagementState>((set, get) => ({
  open: false,
  enemyKey: null,
  enemyShipClassId: null,
  prompt(enemyKey, shipClassId) {
    if (get().open) return
    set({ open: true, enemyKey, enemyShipClassId: shipClassId })
  },
  resolve(choice) {
    const s = get()
    if (!s.open) return
    const classId = s.enemyShipClassId
    set({ open: false, enemyKey: null, enemyShipClassId: null })
    if (choice === 'engage') {
      if (classId) startCombat(resolveCombatClassId(classId))
    } else if (choice === 'flee') {
      emitSim('log', { textZh: '脱离接触', atMs: Date.now() })
    } else if (choice === 'negotiate') {
      emitSim('toast', { textZh: '谈判尚未实装' })
    }
  },
  dismiss() {
    set({ open: false, enemyKey: null, enemyShipClassId: null })
  },
}))

// Save/load reset hook — clears any stale modal state. The contact-detection
// re-prompt cooldown map lives in spaceSim.ts and is wiped by
// resetSpaceSimFlags(); this companion call drops the modal store itself so a
// load taken with the engagement modal open doesn't leave a ghost prompt.
export function resetEngagementCooldowns(): void {
  useEngagement.setState({ open: false, enemyKey: null, enemyShipClassId: null })
}
