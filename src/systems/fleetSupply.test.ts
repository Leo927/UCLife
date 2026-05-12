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
      supplyCurrent: supplyMax,
      supplyMax,
      fuelCurrent: fuelMax,
      fuelMax,
      pendingSupplyDeliveries: [],
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
      fuelCurrent: 0, fuelMax: 16,
      suppliesCurrent: 0, suppliesMax: 40,
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
  it('drains the host hangar by the docked ship supplyPerDay', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4)

    const r = fleetSupplyDrainSystem(world, world, 1)
    expect(r.totalDrainSupply).toBe(4)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000 - 4)
  })

  it('skips mothballed ships', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 'ship', 'vonBraun', 4, { mothballed: true })

    const r = fleetSupplyDrainSystem(world, world, 1)
    expect(r.totalDrainSupply).toBe(0)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
  })

  it('caps drain at zero — never negative supplyCurrent', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 3, 0)
    spawnShipAt(world, 'ship', 'vonBraun', 10)

    const r = fleetSupplyDrainSystem(world, world, 1)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(0)
    // Drain was capped to whatever was available — 3, not 10.
    expect(r.totalDrainSupply).toBe(3)
  })

  it('aggregates drain across multiple docked ships at the same POI', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 's1', 'vonBraun', 4)
    spawnShipAt(world, 's2', 'vonBraun', 6)

    fleetSupplyDrainSystem(world, world, 1)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000 - 10)
  })

  it('skips ships not docked at this POI (different docked POI)', () => {
    const world = createWorld()
    const hangar = spawnHangar(world, 'h1', 'vonBraun', 1000, 400)
    spawnShipAt(world, 's1', 'granada', 4)  // docked elsewhere — no host hangar at this POI

    const r = fleetSupplyDrainSystem(world, world, 1)
    expect(r.totalDrainSupply).toBe(0)
    expect(hangar.get(Hangar)!.supplyCurrent).toBe(1000)
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
