// Phase 6.2.F fleet supply unit tests. Pure-koota — no clock, no loop,
// no save/load harness. Each test seeds a world with one Hangar and
// one Ship (or multiple), then drives the drain + delivery ticks
// directly and asserts the resulting state.

import { describe, expect, it } from 'vitest'
import { createWorld, type World } from 'koota'
import {
  Building, Owner, Facility, Hangar, EntityKey,
  Ship, ShipStatSheet, IsFlagshipMark,
} from '../ecs/traits'
import { fleetSupplyDrainSystem } from './fleetSupplyDrain'
import {
  fleetSupplyDeliverySystem, enqueueSupplyDelivery,
} from './fleetSupplyDelivery'
import { fleetConfig } from '../config'
import { createShipSheet } from '../stats/shipSchema'
import { setBase } from '../stats/sheet'

// EntityKey format must match spawn.ts: `bld-<sceneId>-<typeId>-<n>`.
// The drain system reads `dockedAtPoiId` off each ship, then walks every
// hangar across the passed world and resolves its host POI via the
// EntityKey-encoded sceneId. For tests we encode 'vonBraunCity' (the
// scene id POIS canonically maps to the 'vonBraun' POI id).
function spawnHangar(
  world: World,
  key: string,
  _poiId: string,
  supplyMax: number,
  fuelMax: number,
  sceneId = 'vonBraunCity',
) {
  return world.spawn(
    Building({ x: 0, y: 0, w: 14 * 32, h: 14 * 32, label: 'H', typeId: 'hangarSurface' }),
    Owner({ kind: 'state', entity: null }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    Hangar({
      tier: 'surface',
      slotCapacity: { ms: 4, smallCraft: 4 },
      repairPriorityShipKey: '',
      pendingDeliveries: [],
      supplyCurrent: supplyMax,
      supplyMax,
      fuelCurrent: fuelMax,
      fuelMax,
      pendingSupplyDeliveries: [],
      pendingMsDeliveries: [],
    }),
    EntityKey({ key: `bld-${sceneId}-hangarSurface-${key}` }),
  )
}

function spawnShipAt(
  world: World,
  key: string,
  poiId: string,
  supplyPerDay: number,
  opts: { mothballed?: boolean; flagship?: boolean } = {},
) {
  const ent = world.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: poiId,
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      mothballed: opts.mothballed ?? false,
    }),
    EntityKey({ key }),
  )
  if (opts.flagship) ent.add(IsFlagshipMark)
  const sheet = setBase(createShipSheet(), 'supplyPerDay', supplyPerDay)
  ent.add(ShipStatSheet({ sheet }))
  return ent
}

describe('fleetSupplyDrainSystem', () => {
  // Tests inject a fake "spend" so they don't depend on the global
  // FleetPool singleton (lives in playerShipInterior world). The fake
  // mimics the cap-at-availability contract that production
  // spendFleetSupply implements.
  function spendFactory(initialAvailable: number) {
    let avail = initialAvailable
    const log: number[] = []
    const spend = (amount: number): number => {
      const applied = Math.min(amount, avail)
      avail -= applied
      log.push(applied)
      return applied
    }
    return { spend, log, get available() { return avail } }
  }

  it('drains the fleet pool by the docked ship supplyPerDay', () => {
    const world = createWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(4)
    expect(r.shipsDraining).toBe(1)
    expect(r.ranDry).toBe(false)
    expect(sf.available).toBe(996)
  })

  it('skips mothballed ships', () => {
    const world = createWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4, { mothballed: true })

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(0)
    expect(r.shipsDraining).toBe(0)
    expect(sf.available).toBe(1000)
  })

  it('caps drain at zero — never negative supplyCurrent', () => {
    const world = createWorld()
    spawnHangar(world, 'h1', 'vonBraun', 3, 0)
    spawnShipAt(world, 'ship', 'vonBraun', 10)

    const sf = spendFactory(3)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    // Drain was capped to whatever was available — 3, not 10.
    expect(r.totalDrainSupply).toBe(3)
    expect(r.ranDry).toBe(true)
    expect(sf.available).toBe(0)
  })

  it('aggregates drain across multiple ships (fleet pool is global)', () => {
    const world = createWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 's1', 'vonBraun', 4)
    spawnShipAt(world, 's2', 'vonBraun', 6)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(10)
    expect(r.shipsDraining).toBe(2)
    expect(sf.available).toBe(990)
  })

  it('drains regardless of docked POI — fleet pool is global, not per-hangar', () => {
    const world = createWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 's1', 'vonBraunDrydock', 4)  // dockedAtPoiId no longer gates drain

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(4)
    expect(sf.available).toBe(996)
  })
})

describe('fleetSupplyDeliverySystem', () => {
  it('lands a 2-day supply delivery on day 2', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    // Pre-drain so the cap headroom is real.
    hangar.set(Hangar, { ...hangar.get(Hangar)!, supplyCurrent: 500 })
    enqueueSupplyDelivery(hangar, 'supply', 200, fleetConfig.supplyDeliveryDays)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries.length).toBe(1)

    // Tick 1 — daysRemaining 2 → 1, not yet landed.
    fleetSupplyDeliverySystem(world, 1)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(500)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries.length).toBe(1)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries[0].daysRemaining).toBe(1)

    // Tick 2 — daysRemaining 1 → 0, lands.
    fleetSupplyDeliverySystem(world, 2)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(700)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries.length).toBe(0)
  })

  it('caps delivery at supplyMax — never overflows', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    hangar.set(Hangar, { ...hangar.get(Hangar)!, supplyCurrent: 950 })
    enqueueSupplyDelivery(hangar, 'supply', 200, 1)
    fleetSupplyDeliverySystem(world, 1)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries.length).toBe(0)
  })

  it('lands fuel deliveries on the fuel reserve', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    hangar.set(Hangar, { ...hangar.get(Hangar)!, fuelCurrent: 100 })
    enqueueSupplyDelivery(hangar, 'fuel', 50, 1)
    fleetSupplyDeliverySystem(world, 1)
    expect(hangar.get(Hangar)!.fuelCurrent).toBe(150)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
  })
})
