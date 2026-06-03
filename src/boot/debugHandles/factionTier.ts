// Phase 6.4.A — faction-tier debug handles for deterministic smoke tests.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { factionTierSystem, FACTION_TIER_UNLOCK_ID } from '../../systems/factionTier'
import { hasFactionUnlock } from '../../ecs/factionEffects'
import { Faction, IsPlayer, Reputation, FactionInterRep } from '../../ecs/traits'
import { SCENE_IDS, getWorld } from '../../ecs/world'
import { addRep } from '../../systems/reputation'
import type { FactionId } from '../../data/factions'

function findPlayerFactionAcrossScenes() {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(Faction)) {
      if (e.get(Faction)!.id === 'player') return e
    }
  }
  return null
}

// Run the faction-tier gate check for the given game-day.
// Returns the current faction-tier state after the check.
registerDebugHandle('forceFactionTierTick', (gameDay: number) => {
  factionTierSystem(gameDay)
  const pf = findPlayerFactionAcrossScenes()
  return {
    hasFactionTier: pf ? hasFactionUnlock(pf, FACTION_TIER_UNLOCK_ID) : false,
  }
})

// Returns true if the player-faction has the faction-tier unlock.
registerDebugHandle('playerFactionHasTierUnlock', () => {
  const pf = findPlayerFactionAcrossScenes()
  return pf ? hasFactionUnlock(pf, FACTION_TIER_UNLOCK_ID) : false
})

// Returns the player-faction's inter-faction reputation map, or null
// if no player-faction entity exists.
registerDebugHandle('playerFactionGetInterRep', () => {
  const pf = findPlayerFactionAcrossScenes()
  if (!pf) return null
  const ir = pf.get(FactionInterRep)
  return ir ? { ...ir.rep } : null
})

// Set the player character's personal reputation with a faction by delta
// from current. Used in smoke tests to push rep to threshold without
// advancing sim time. Clamps to [-100, 100] via addRep.
registerDebugHandle('setPlayerRep', (factionId: string, targetValue: number) => {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    const cur = p.get(Reputation)?.rep[factionId as FactionId] ?? 0
    const delta = Math.max(-100, Math.min(100, targetValue)) - cur
    if (delta !== 0) addRep(p, factionId as FactionId, delta)
    return { ok: true }
  }
  return { ok: false, reason: 'no player entity' }
})
