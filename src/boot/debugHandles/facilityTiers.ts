// Phase 5.5.6 — facility-tier debug handles for deterministic smoke tests:
// read the manage-panel view, start an upgrade, inspect tier/downtime
// state, and grant a faction unlock directly (so the tier smoke doesn't
// re-run the multi-week research grind research.spec already covers).

import type { Entity } from 'koota'
import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  Building, EntityKey, FacilityTiers, Faction, FactionUnlocks, IsPlayer,
  Owner, Position, Workstation,
} from '../../ecs/traits'
import {
  startTierUpgrade, tierPanelView, isFacilityInDowntime,
  facilityTierDowntimeSystem,
} from '../../systems/facilityTiers'
import type { TierKnob } from '../../data/facilityTypes'
import { addFactionUnlock } from '../../ecs/factionEffects'

function buildingByKey(key: string): Entity | null {
  for (const b of world.query(Building, EntityKey)) {
    if (b.get(EntityKey)!.key === key) return b
  }
  return null
}

registerDebugHandle('facilityTierPanel', (buildingKey: string) => {
  const b = buildingByKey(buildingKey)
  if (!b) return null
  return tierPanelView(world, b)
})

registerDebugHandle('facilityTierStart', (buildingKey: string, knob: TierKnob, toTier: number) => {
  const b = buildingByKey(buildingKey)
  if (!b) return { ok: false, reason: 'no-building' }
  return startTierUpgrade(world, b, knob, toTier)
})

registerDebugHandle('facilityTierState', (buildingKey: string) => {
  const b = buildingByKey(buildingKey)
  if (!b) return null
  const bld = b.get(Building)!
  let stationsInside = 0
  for (const ws of world.query(Workstation, Position)) {
    const p = ws.get(Position)!
    if (p.x < bld.x || p.x >= bld.x + bld.w) continue
    if (p.y < bld.y || p.y >= bld.y + bld.h) continue
    stationsInside += 1
  }
  const tiers = b.has(FacilityTiers) ? b.get(FacilityTiers)! : null
  return {
    inDowntime: isFacilityInDowntime(b),
    tiers: tiers
      ? {
          jobSiteCount: tiers.jobSiteCount, efficiency: tiers.efficiency,
          operatingHours: tiers.operatingHours, loyaltyDrift: tiers.loyaltyDrift,
        }
      : null,
    upgrade: tiers?.upgrade ? { ...tiers.upgrade } : null,
    stationsInside,
  }
})

// Force one downtime-countdown tick (the day:rollover:settled path the prod
// loop drives) — forceDailyEconomics / forceResearchTick pattern, so smoke
// tests don't step whole game-days through the sim.
registerDebugHandle('forceFacilityTierTick', () => facilityTierDowntimeSystem(world))

// Test-only ownership grant (cheatMoney precedent): hand a building to the
// player so tier smokes don't re-run the realtor/foreclosure acquisition
// loops other specs already cover.
registerDebugHandle('cheatOwnBuilding', (buildingKey: string): boolean => {
  const b = buildingByKey(buildingKey)
  const player = world.queryFirst(IsPlayer)
  if (!b || !player) return false
  b.set(Owner, { kind: 'character', entity: player })
  return true
})

registerDebugHandle('grantFactionUnlock', (unlockId: string): boolean => {
  for (const fEnt of world.query(Faction, FactionUnlocks)) {
    if (fEnt.get(Faction)!.id === 'civilian') {
      addFactionUnlock(fEnt, unlockId)
      return true
    }
  }
  return false
})
