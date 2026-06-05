// Phase 6.4.E — faction-leader perk debug handles for deterministic smoke
// tests. grantAp / grantPlayerFactionTierUnlock are test-setup shortcuts
// (avoid driving the full ambition-clear + holdings gate); purchasePerk
// drives the real spend path.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { purchasePerk } from '../../systems/factionPerks'
import { Ambitions, Faction, IsPlayer } from '../../ecs/traits'
import { addFactionUnlock, hasFactionUnlock } from '../../ecs/factionEffects'
import { FACTION_TIER_UNLOCK_ID } from '../../systems/factionTier'
import { getWorld, SCENE_IDS } from '../../ecs/world'

function findPlayer() {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer, Ambitions)
    if (p) return p
  }
  return null
}

function findPlayerFaction() {
  for (const sceneId of SCENE_IDS) {
    for (const e of getWorld(sceneId).query(Faction)) {
      if (e.get(Faction)!.id === 'player') return e
    }
  }
  return null
}

// Credit AP to the player without waiting for ambition stage clears.
registerDebugHandle('grantAp', (amount: number) => {
  const p = findPlayer()
  if (!p) return { ok: false, apBalance: 0 }
  const a = p.get(Ambitions)!
  p.set(Ambitions, {
    active: a.active, history: a.history,
    apBalance: a.apBalance + amount,
    apEarned: a.apEarned + amount,
    perks: a.perks,
  })
  return { ok: true, apBalance: a.apBalance + amount }
})

// Force the faction-tier unlock onto the player-faction — a test-setup
// shortcut for the full colonies + ships + canon-rep gate (Phase 6.4.A).
registerDebugHandle('grantPlayerFactionTierUnlock', () => {
  const f = findPlayerFaction()
  if (!f) return { ok: false, hasFactionTier: false }
  addFactionUnlock(f, FACTION_TIER_UNLOCK_ID)
  return { ok: true, hasFactionTier: hasFactionUnlock(f, FACTION_TIER_UNLOCK_ID) }
})

// Spend AP on a perk via the real purchase path. Returns the structured
// { ok, refusal? } result so the test can assert refusals.
registerDebugHandle('purchasePerk', (perkId: string) => purchasePerk(perkId))
