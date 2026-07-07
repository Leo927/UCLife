// W4.3 (completes W1.5) — on-ship forward MS repair band. Spawns a flagship
// + aboard MS directly into the real playerShipInterior world (like
// msCustody.test.ts) and drives runOnShipRepair through the band:
//   - an aboard MS below the floor is refused (untouchable aboard);
//   - an aboard MS within the band climbs toward `cap × max` and stops there,
//     never past;
//   - a depoted MS (dockedAtPoiId set) is NOT touched by on-ship repair (it's
//     the depot hangar's job — hangarRepair.ts restores it to 100%).

import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import { Ms, Ship, ShipStatSheet, EntityKey } from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { projectShipSheet } from '../ecs/shipEffects'
import { getShipClass } from '../data/ship-classes'
import { getStat } from '../stats/sheet'
import { computeMsDamageState } from '../ecs/msDamage'
import { runOnShipRepair, describeOnShipRepair } from './onShipRepair'

const SHIP_SCENE_ID = 'playerShipInterior'
const FLAGSHIP_KEY = 'flagship'

const spawned: Entity[] = []

afterEach(() => {
  for (const e of spawned) e.destroy()
  spawned.length = 0
})

function spawnFlagship(): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: '',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
    }),
    ShipStatSheet({ sheet: projectShipSheet(getShipClass('lightFreighter')) }),
    EntityKey({ key: FLAGSHIP_KEY }),
  )
  spawned.push(ent)
  return ent
}

function spawnMs(key: string, opts: {
  storedOnShipKey?: string
  dockedAtPoiId?: string
  hullCurrent: number
  armorCurrent: number
}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ms({
      templateId: 'mobileWorker',
      name: '',
      hullCurrent: opts.hullCurrent, hullMax: 100,
      armorCurrent: opts.armorCurrent, armorMax: 20,
      mountedWeapons: {},
      storedOnShipKey: opts.storedOnShipKey ?? '',
      bayIndex: 0,
      dockedAtPoiId: opts.dockedAtPoiId ?? '',
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
  spawned.push(ent)
  return ent
}

describe('runOnShipRepair — band clamp', () => {
  it('projects a non-zero band onto the ship sheet (completes W1.5)', () => {
    const ship = spawnFlagship()
    const sheet = ship.get(ShipStatSheet)!.sheet
    expect(getStat(sheet, 'onShipRepairCap'), 'cap must be read from the ship sheet').toBeGreaterThan(0)
    expect(getStat(sheet, 'onShipRepairFloor'), 'floor must be read from the ship sheet').toBeGreaterThan(0)
  })

  it('refuses an aboard MS below the floor (untouchable aboard)', () => {
    const ship = spawnFlagship()
    const floor = getStat(ship.get(ShipStatSheet)!.sheet, 'onShipRepairFloor')
    // Integrity well below the floor: hull 10% / armor 10% ⇒ ~0.10 < 0.4.
    const ms = spawnMs('ms-crippled', { storedOnShipKey: FLAGSHIP_KEY, hullCurrent: 10, armorCurrent: 2 })
    const before = ms.get(Ms)!
    expect((before.hullCurrent + before.armorCurrent) / (before.hullMax + before.armorMax))
      .toBeLessThan(floor)

    const r = runOnShipRepair(ship)
    expect(r.msRefused, 'a below-floor MS is refused').toBe(1)
    expect(r.pointsApplied, 'nothing repaired on a sidelined MS').toBe(0)
    const after = ms.get(Ms)!
    expect(after.hullCurrent, 'below-floor hull unchanged').toBe(before.hullCurrent)
    expect(after.armorCurrent, 'below-floor armor unchanged').toBe(before.armorCurrent)
  })

  it('repairs an in-band MS toward the cap and never past it', () => {
    const ship = spawnFlagship()
    const cap = getStat(ship.get(ShipStatSheet)!.sheet, 'onShipRepairCap')
    // Start within band (hull 60% ⇒ integrity ≥ floor) but below cap.
    const ms = spawnMs('ms-damaged', { storedOnShipKey: FLAGSHIP_KEY, hullCurrent: 60, armorCurrent: 5 })

    // Run enough repair ticks to saturate the band.
    for (let i = 0; i < 50; i++) runOnShipRepair(ship)

    const after = ms.get(Ms)!
    expect(after.armorCurrent, 'armor climbs to the cap ceiling').toBeCloseTo(after.armorMax * cap, 5)
    expect(after.hullCurrent, 'hull climbs to the cap ceiling').toBeCloseTo(after.hullMax * cap, 5)
    expect(after.hullCurrent, 'hull never exceeds the cap ceiling').toBeLessThanOrEqual(after.hullMax * cap + 1e-6)
    // Aboard MS carry no dockedAtPoiId, so they stay 'ready' with deficit
    // (never 'in-repair', which is the depot state).
    expect(after.damageState, 'aboard MS stays ready (not in-repair)').toBe('ready')
    expect(after.damageState).toBe(computeMsDamageState(after))

    // A further tick applies nothing — already at the cap.
    const r = runOnShipRepair(ship)
    expect(r.pointsApplied, 'no repair past the cap').toBe(0)
  })

  it('ignores a depoted MS (dockedAtPoiId set) — that is the depot hangar\'s job', () => {
    const ship = spawnFlagship()
    const depot = spawnMs('ms-depot', {
      dockedAtPoiId: 'vonBraun', hullCurrent: 60, armorCurrent: 5,
    })
    const before = depot.get(Ms)!

    const r = runOnShipRepair(ship)
    expect(r.pointsApplied, 'on-ship repair does not touch a depoted MS').toBe(0)
    const after = depot.get(Ms)!
    expect(after.hullCurrent, 'depoted hull untouched by on-ship repair').toBe(before.hullCurrent)
  })

  it('describeOnShipRepair reports the band + each aboard MS state', () => {
    const ship = spawnFlagship()
    spawnMs('ms-ok', { storedOnShipKey: FLAGSHIP_KEY, hullCurrent: 60, armorCurrent: 5 })
    spawnMs('ms-low', { storedOnShipKey: FLAGSHIP_KEY, hullCurrent: 10, armorCurrent: 2 })

    const view = describeOnShipRepair(ship)
    expect(view.cap).toBeGreaterThan(0)
    expect(view.aboard.length, 'both aboard MS reported').toBe(2)
    expect(view.aboard.find((a) => a.key === 'ms-low')!.belowFloor, 'the crippled MS is flagged below floor').toBe(true)
    expect(view.aboard.find((a) => a.key === 'ms-ok')!.belowFloor, 'the in-band MS is not below floor').toBe(false)
  })
})
