// Phase 5.5 ownership debug surface. Lets the smoke suite verify the
// faction-entity bootstrap, the per-building Owner default, the realtor
// listing pipeline (5.5.1), and the daily-economics rollover (5.5.2)
// without reaching into koota internals.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, getWorld, getActiveSceneId } from '../../ecs/world'
import { Building, Faction, Owner, IsPlayer, Money, EntityKey, Facility, Character } from '../../ecs/traits'
import { gatherListings, buyFromState } from '../../systems/realtor'
import { dailyEconomicsSystem } from '../../systems/dailyEconomics'
import { gameDayNumber, useClock } from '../../sim/clock'

interface OwnerSummary {
  kind: 'state' | 'faction' | 'character'
  factionId: string | null
}

interface OwnershipSnapshot {
  factions: { id: string; fund: number }[]
  buildingsByOwnerKind: Record<'state' | 'faction' | 'character' | 'untagged', number>
  buildingsByFaction: Record<string, number>
}

registerDebugHandle('ownershipSnapshot', (): OwnershipSnapshot => {
  const factions: OwnershipSnapshot['factions'] = []
  for (const e of world.query(Faction)) {
    const f = e.get(Faction)!
    factions.push({ id: f.id, fund: f.fund })
  }
  const byKind: OwnershipSnapshot['buildingsByOwnerKind'] = {
    state: 0, faction: 0, character: 0, untagged: 0,
  }
  const byFaction: Record<string, number> = {}
  for (const b of world.query(Building)) {
    const o = b.get(Owner)
    if (!o) { byKind.untagged += 1; continue }
    byKind[o.kind] += 1
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      if (f) byFaction[f.id] = (byFaction[f.id] ?? 0) + 1
    }
  }
  return { factions, buildingsByOwnerKind: byKind, buildingsByFaction: byFaction }
})

registerDebugHandle('ownerOf', (label: string): OwnerSummary | null => {
  for (const b of world.query(Building)) {
    if (b.get(Building)!.label !== label) continue
    const o = b.get(Owner)
    if (!o) return null
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      return { kind: 'faction', factionId: f?.id ?? null }
    }
    return { kind: o.kind, factionId: null }
  }
  return null
})

interface ListingDebug {
  buildingKey: string
  typeId: string
  category: string
  ownerKind: string
  sellerName: string | null
  askingPrice: number | null
}

registerDebugHandle('realtorListings', (): ListingDebug[] => {
  return gatherListings(world).map((l) => ({
    buildingKey: l.buildingKey,
    typeId: l.typeId,
    category: l.category,
    ownerKind: l.ownerKind,
    sellerName: l.seller?.name ?? null,
    askingPrice: l.askingPrice,
  }))
})

interface BuyResult {
  ok: boolean
  paid: number | null
  reason?: string
}

interface FacilitySnapshot {
  buildingKey: string
  typeId: string
  ownerKind: string
  ownerName: string | null
  revenueAcc: number
  salariesAcc: number
  insolventDays: number
  closedSinceDay: number
  closedReason: string | null
  lastRolloverDay: number
}

// Per-building Facility state. Lets the smoke suite verify economic
// rollovers + insolvency transitions without parsing toasts. Optional
// `buildingKey` filter narrows the result to a single facility.
registerDebugHandle('facilitySnapshot', (buildingKey?: string): FacilitySnapshot[] => {
  const out: FacilitySnapshot[] = []
  for (const b of world.query(Building, Owner, Facility, EntityKey)) {
    const key = b.get(EntityKey)!.key
    if (buildingKey && key !== buildingKey) continue
    const o = b.get(Owner)!
    const fac = b.get(Facility)!
    const bld = b.get(Building)!
    let ownerName: string | null = null
    if (o.kind === 'character' && o.entity) {
      ownerName = o.entity.get(Character)?.name ?? null
    } else if (o.kind === 'faction' && o.entity) {
      ownerName = o.entity.get(Faction)?.id ?? null
    }
    out.push({
      buildingKey: key,
      typeId: bld.typeId,
      ownerKind: o.kind,
      ownerName,
      revenueAcc: fac.revenueAcc,
      salariesAcc: fac.salariesAcc,
      insolventDays: fac.insolventDays,
      closedSinceDay: fac.closedSinceDay,
      closedReason: fac.closedReason,
      lastRolloverDay: fac.lastRolloverDay,
    })
  }
  return out
})

interface FacilityForceState {
  // Mutate the named facility's bookkeeping. Smoke uses this to drop
  // owner fund / pump salariesAcc into insolvency without waiting for
  // a real shift to fire.
  buildingKey: string
  revenueAcc?: number
  salariesAcc?: number
  ownerFund?: number
}

registerDebugHandle('facilityForce', (state: FacilityForceState): boolean => {
  for (const b of world.query(Building, Owner, Facility, EntityKey)) {
    if (b.get(EntityKey)!.key !== state.buildingKey) continue
    const fac = b.get(Facility)!
    b.set(Facility, {
      ...fac,
      revenueAcc: state.revenueAcc ?? fac.revenueAcc,
      salariesAcc: state.salariesAcc ?? fac.salariesAcc,
    })
    if (state.ownerFund !== undefined) {
      const o = b.get(Owner)!
      if (o.kind === 'character' && o.entity) {
        o.entity.set(Money, { amount: state.ownerFund })
      } else if (o.kind === 'faction' && o.entity) {
        const f = o.entity.get(Faction)
        if (f) o.entity.set(Faction, { ...f, fund: state.ownerFund })
      }
    }
    return true
  }
  return false
})

interface RolloverResult {
  day: number
  facilitiesProcessed: number
  foreclosed: number
  insolventStarted: number
  warnings: number
}

// Force a daily-economics rollover for the active scene at the given
// game-day. Useful for tests that don't want to advance the sim clock 24h.
registerDebugHandle('forceDailyEconomics', (gameDay?: number): RolloverResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = dailyEconomicsSystem(getWorld(getActiveSceneId()), day)
  return { day, ...r }
})

registerDebugHandle('realtorBuy', (buildingKey: string): BuyResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, paid: null, reason: 'no player' }
  for (const b of world.query(Building, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    // Set wallet to a high number so the smoke test isn't gated on
    // debugCheats sequencing — this handle is a synthetic test hook.
    const cur = player.get(Money)?.amount ?? 0
    if (cur < 1_000_000) player.set(Money, { amount: 1_000_000 })
    const listings = gatherListings(world)
    const target = listings.find((l) => l.buildingKey === buildingKey)
    if (!target) return { ok: false, paid: null, reason: 'not listed' }
    if (target.ownerKind !== 'state') {
      return { ok: false, paid: null, reason: `not state-owned (${target.ownerKind})` }
    }
    const paid = buyFromState(player, target)
    if (paid === null) return { ok: false, paid: null, reason: 'buyFromState rejected' }
    return { ok: true, paid }
  }
  return { ok: false, paid: null, reason: 'building not found' }
})
