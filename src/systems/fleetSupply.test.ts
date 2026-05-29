// Phase 6.2.F fleet supply unit tests. Pure-koota — no clock, no loop,
// no save/load harness. Each test seeds a world with one Hangar and
// one Ship (or multiple), then drives the drain + delivery ticks
// directly and asserts the resulting state.

import { describe, expect, it, afterEach } from 'vitest'
import { createWorld, type World } from 'koota'
import {
  Building, Owner, Facility, Hangar, EntityKey,
  Ship, ShipStatSheet, IsFlagshipMark, Ms, MsStatSheet,
} from '../ecs/traits'
import { fleetSupplyDrainSystem } from './fleetSupplyDrain'
import {
  fleetSupplyDeliverySystem, enqueueSupplyDelivery,
} from './fleetSupplyDelivery'
import { fleetConfig } from '../config'
import { createShipSheet } from '../stats/shipSchema'
import { createMsSheet } from '../stats/msSchema'
import { setBase } from '../stats/sheet'

// koota caps live worlds at 16 per module; release each test's world so
// the suite doesn't exhaust the id pool as cases accumulate.
const createdWorlds: World[] = []
function freshWorld(): World {
  const w = createWorld()
  createdWorlds.push(w)
  return w
}
afterEach(() => {
  for (const w of createdWorlds) w.destroy()
  createdWorlds.length = 0
})

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

// Spawn an MS aboard a given ship (by the ship's EntityKey). `inRepair`
// damages the hull so isMsInRepair() trips, exercising the supplyPerRepairDay
// term. The MsStatSheet carries the supply stats the drain reads via getStat.
function spawnMsAboard(
  world: World,
  key: string,
  storedOnShipKey: string,
  supplyPerDay: number,
  supplyPerRepairDay: number,
  opts: { inRepair?: boolean } = {},
) {
  const hullMax = 320
  const armorMax = 80
  const ent = world.spawn(
    Ms({
      templateId: 'gm_pre',
      name: 'GM',
      hullCurrent: opts.inRepair ? hullMax - 50 : hullMax,
      hullMax,
      armorCurrent: armorMax,
      armorMax,
      mountedWeapons: {},
      storedOnShipKey,
      bayIndex: 0,
      dockedAtPoiId: '',
      pilotId: '',
      transitDestinationId: '',
      transitArrivalDay: 0,
      currentPropellant: 0,
      currentAmmoByWeapon: {},
      currentLifeSupport: 0,
      frameMods: [],
    }),
    EntityKey({ key }),
  )
  let sheet = setBase(createMsSheet(), 'supplyPerDay', supplyPerDay)
  sheet = setBase(sheet, 'supplyPerRepairDay', supplyPerRepairDay)
  ent.add(MsStatSheet({ sheet }))
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
    const world = freshWorld()
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
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4, { mothballed: true })

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(0)
    expect(r.shipsDraining).toBe(0)
    expect(sf.available).toBe(1000)
  })

  it('caps drain at zero — never negative supplyCurrent', () => {
    const world = freshWorld()
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
    const world = freshWorld()
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
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 's1', 'vonBraunDrydock', 4)  // dockedAtPoiId no longer gates drain

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(4)
    expect(sf.available).toBe(996)
  })

  // Issue #63 — per-MS supply drain folded into the daily walk.
  it('adds per-MS supplyPerDay for MS aboard a non-mothballed ship', () => {
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4)
    spawnMsAboard(world, 'ms1', 'ship', 0.5, 1.5)
    spawnMsAboard(world, 'ms2', 'ship', 0.5, 1.5)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    // ship 4 + 2 × MS 0.5 = 5; neither MS is in-repair so no repair term.
    expect(r.totalDrainSupply).toBe(5)
    expect(r.shipsDraining).toBe(1)
    expect(r.msDraining).toBe(2)
    expect(sf.available).toBe(995)
  })

  it('adds supplyPerRepairDay for an in-repair MS', () => {
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4)
    spawnMsAboard(world, 'ms1', 'ship', 0.5, 1.5, { inRepair: true })
    spawnMsAboard(world, 'ms2', 'ship', 0.5, 1.5)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    // ship 4 + ms1 (0.5 + 1.5 in-repair) + ms2 (0.5) = 6.5
    expect(r.totalDrainSupply).toBe(6.5)
    expect(r.msDraining).toBe(2)
    expect(sf.available).toBe(993.5)
  })

  it('skips MS aboard a mothballed ship — both ship and MS terms drop to 0', () => {
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4, { mothballed: true })
    spawnMsAboard(world, 'ms1', 'ship', 0.5, 1.5, { inRepair: true })
    spawnMsAboard(world, 'ms2', 'ship', 0.5, 1.5)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(0)
    expect(r.shipsDraining).toBe(0)
    expect(r.msDraining).toBe(0)
    expect(sf.available).toBe(1000)
  })

  it('debits the fleet pool exactly once per day — not per entity', () => {
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4)
    spawnMsAboard(world, 'ms1', 'ship', 0.5, 1.5, { inRepair: true })
    spawnMsAboard(world, 'ms2', 'ship', 0.5, 1.5)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    // ship 4 + ms1 (0.5 + 1.5) + ms2 (0.5) = 6.5, in a single debit.
    expect(sf.log.length).toBe(1)
    expect(sf.log[0]).toBe(6.5)
    expect(r.totalDrainSupply).toBe(6.5)
  })

  it('counts MS parked at a POI hangar (no parent ship) — never mothballed', () => {
    const world = freshWorld()
    spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    // No ship; MS parked at the depot (storedOnShipKey empty).
    spawnMsAboard(world, 'ms1', '', 0.5, 1.5)

    const sf = spendFactory(1000)
    const r = fleetSupplyDrainSystem(world, world, 1, sf.spend)
    expect(r.totalDrainSupply).toBe(0.5)
    expect(r.msDraining).toBe(1)
    expect(sf.available).toBe(999.5)
  })
})

describe('fleetSupplyDeliverySystem', () => {
  it('lands a 2-day supply delivery on day 2', () => {
    const world = freshWorld()
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
    const world = freshWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    hangar.set(Hangar, { ...hangar.get(Hangar)!, supplyCurrent: 950 })
    enqueueSupplyDelivery(hangar, 'supply', 200, 1)
    fleetSupplyDeliverySystem(world, 1)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
    expect(hangar.get(Hangar)!.pendingSupplyDeliveries.length).toBe(0)
  })

  it('lands fuel deliveries on the fuel reserve', () => {
    const world = freshWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    hangar.set(Hangar, { ...hangar.get(Hangar)!, fuelCurrent: 100 })
    enqueueSupplyDelivery(hangar, 'fuel', 50, 1)
    fleetSupplyDeliverySystem(world, 1)
    expect(hangar.get(Hangar)!.fuelCurrent).toBe(150)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
  })
})
