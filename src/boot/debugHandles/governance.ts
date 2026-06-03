// Phase 6.4.C — governance council debug handles for deterministic smoke tests.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { callCouncil, resolveCouncil, governanceDissentDecayTick } from '../../systems/governance'
import { getActivePolicy, getAllActivePolicies, getDissentRecord } from '../../sim/governance'
import { gameDayNumber, useClock } from '../../sim/clock'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import { EntityKey, CouncilDissentMood } from '../../ecs/traits'
import type { PolicyKind } from '../../config/governance'

// Gather attendees and compute stances for a policy kind without committing.
// Returns null when no player colony is found or no attendees are available.
registerDebugHandle('callCouncil', (poiId: string, policyKind: string) => {
  return callCouncil(poiId, policyKind as PolicyKind)
})

// Commit a council resolution: apply the new policy effect and stamp dissent.
registerDebugHandle(
  'resolveCouncil',
  (poiId: string, policyKind: string, newValue: string) => {
    const session = callCouncil(poiId, policyKind as PolicyKind)
    if (!session) return { ok: false, reason: 'no_session' }
    const gameDay = gameDayNumber(useClock.getState().gameDate)
    resolveCouncil(session, newValue, gameDay)
    return { ok: true, gameDay }
  },
)

// Get all currently active faction policies.
registerDebugHandle('getCouncilPolicies', () => getAllActivePolicies())

// Get the active policy for a specific kind.
registerDebugHandle('getCouncilPolicy', (kind: string) => getActivePolicy(kind as PolicyKind))

// Get the dissent state for a specific NPC key (from the registry).
registerDebugHandle('getCouncilDissentRecord', (npcKey: string) => getDissentRecord(npcKey))

// Get the CouncilDissentMood trait from the NPC entity (live ECS state).
registerDebugHandle('getCouncilDissentTrait', (npcKey: string) => {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(EntityKey, CouncilDissentMood)) {
      if (e.get(EntityKey)!.key === npcKey) {
        return e.get(CouncilDissentMood)
      }
    }
  }
  return null
})

// Advance the governance dissent decay tick for a given game day.
registerDebugHandle('forceGovernanceDissentDecay', (gameDay?: number) => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  governanceDissentDecayTick(day)
  return { day }
})
