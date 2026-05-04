import type { World } from 'koota'
import { Bed, Position, Action, Home, IsPlayer, PendingEviction } from '../ecs/traits'
import { emitSim } from '../sim/events'

// Tenants napping at expiry get a grace pass — otherwise their bed
// multiplier would snap to 'none' mid-sleep.
const SLEEPING_AT_BED_PX = 6

// Long enough to clear the corridor; short enough that a player can't park
// in the cell for a free comeback.
const EVICTION_EXIT_PASS_MS = 10 * 60 * 1000

export function rentSystem(world: World, currentMs: number) {
  for (const bedEnt of world.query(Bed, Position)) {
    const b = bedEnt.get(Bed)!
    if (!b.occupant) continue
    // Bought outright — rent expiry doesn't apply.
    if (b.owned) continue
    if (b.rentPaidUntilMs <= 0) continue
    if (b.rentPaidUntilMs > currentMs) continue

    const tenant = b.occupant
    const tenantAct = tenant.get(Action)
    const tenantPos = tenant.get(Position)
    const bedPos = bedEnt.get(Position)
    if (tenantAct?.kind === 'sleeping' && tenantPos && bedPos) {
      const dist = Math.hypot(tenantPos.x - bedPos.x, tenantPos.y - bedPos.y)
      if (dist < SLEEPING_AT_BED_PX) continue
    }

    bedEnt.set(Bed, { ...b, occupant: null, rentPaidUntilMs: 0 })
    const home = tenant.get(Home)
    if (home?.bed === bedEnt) {
      tenant.set(Home, { bed: null })
    }
    // pathfinding honors PendingEviction.bedEntity up to expireMs.
    const passData = { bedEntity: bedEnt, expireMs: currentMs + EVICTION_EXIT_PASS_MS }
    if (tenant.has(PendingEviction)) tenant.set(PendingEviction, passData)
    else tenant.add(PendingEviction(passData))
    if (tenant.has(IsPlayer)) {
      const tierLabel = b.tier === 'flop' ? '投币床' : b.tier === 'dorm' ? '宿舍床' : b.tier === 'apartment' ? '公寓' : '高级公寓'
      emitSim('toast', { textZh: `${tierLabel}租期已到 · 已退房` })
    }
  }
}
