// Task 8 — ship <-> depot MS custody. Unlike the pure-entity helpers in
// shipAboard.test.ts, unloadMsToDepot / loadMsAboard resolve entities via
// the real scene-world registry (getWorld/SCENE_IDS) exactly like their
// closest analog (msTransfer.ts's enqueueMsTransfer) — so these tests spawn
// directly into the real per-scene worlds rather than a bespoke
// `createWorld()`. `marikoRefineryScene` / `marikoRefinery` is a real,
// single-region scene+POI pair from data/pois.json5 + scenes.json5, picked
// so poiIdForHangar resolves deterministically without depending on
// vonBraunCity's multi-region geometry.

import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Ms, Ship, ShipStatSheet, Building, Hangar, Owner, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { createShipSheet } from '../stats/shipSchema'
import { setBase } from '../stats/sheet'
import { useClock } from '../sim/clock'
import { unloadMsToDepot, loadMsAboard, countMsAboard } from './msCustody'

const SHIP_SCENE_ID = 'playerShipInterior'
const DEPOT_SCENE_ID = 'marikoRefineryScene'
const DEPOT_POI_ID = 'marikoRefinery'
const OTHER_POI_ID = 'vonBraun'

const spawned: Entity[] = []

afterEach(() => {
  for (const e of spawned) e.destroy()
  spawned.length = 0
  useClock.setState({ mode: 'normal' })
})

function spawnHangarAtDepot(msSlotCapacity = 1): Entity {
  const w = getWorld(DEPOT_SCENE_ID)
  const ent = w.spawn(
    Building({ x: 32, y: 32, w: 32, h: 32, label: 'test-hangar', typeId: 'hangarSurface' }),
    Hangar({
      tier: 'surface',
      slotCapacity: { ms: msSlotCapacity },
      repairPriorityShipKey: '',
      pendingDeliveries: [],
      supplyCurrent: 0,
      supplyMax: 0,
      fuelCurrent: 0,
      fuelMax: 0,
      pendingSupplyDeliveries: [],
      pendingMsDeliveries: [],
    }),
    EntityKey({ key: `test-hangar-${Math.random()}` }),
  )
  spawned.push(ent)
  return ent
}

function spawnShip(key: string, opts: {
  dockedAtPoiId?: string
  hangarCapacity?: number
  owned?: boolean
} = {}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const sheet = setBase(createShipSheet(), 'hangarCapacity', opts.hangarCapacity ?? 1)
  const ent = w.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: opts.dockedAtPoiId ?? DEPOT_POI_ID,
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
    }),
    ShipStatSheet({ sheet }),
    Owner({ kind: opts.owned === false ? 'state' : 'character', entity: null }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

function spawnMs(key: string, opts: {
  storedOnShipKey?: string
  dockedAtPoiId?: string
  transitDestinationId?: string
} = {}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ms({
      templateId: 'mobileWorker',
      name: '',
      hullCurrent: 100, hullMax: 100,
      armorCurrent: 20, armorMax: 20,
      mountedWeapons: {},
      storedOnShipKey: opts.storedOnShipKey ?? '',
      bayIndex: 0,
      dockedAtPoiId: opts.dockedAtPoiId ?? '',
      pilotId: '',
      transitDestinationId: opts.transitDestinationId ?? '',
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

describe('unloadMsToDepot', () => {
  it('flips storedOnShipKey -> dockedAtPoiId when the host ship is docked at that POI', () => {
    spawnHangarAtDepot()
    const ship = spawnShip('ship-1')
    void ship
    const ms = spawnMs('ms-1', { storedOnShipKey: 'ship-1' })

    const r = unloadMsToDepot('ms-1', DEPOT_POI_ID)

    expect(r.ok).toBe(true)
    const after = ms.get(Ms)!
    expect(after.storedOnShipKey).toBe('')
    expect(after.dockedAtPoiId).toBe(DEPOT_POI_ID)
  })

  it('refuses when the host ship is docked elsewhere', () => {
    spawnHangarAtDepot()
    spawnShip('ship-2', { dockedAtPoiId: OTHER_POI_ID })
    const ms = spawnMs('ms-2', { storedOnShipKey: 'ship-2' })

    const r = unloadMsToDepot('ms-2', DEPOT_POI_ID)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonZh.length).toBeGreaterThan(0)
    const after = ms.get(Ms)!
    expect(after.storedOnShipKey).toBe('ship-2')
    expect(after.dockedAtPoiId).toBe('')
  })

  it('refuses when the MS is not stored aboard any ship', () => {
    spawnHangarAtDepot()
    spawnMs('ms-3', { dockedAtPoiId: OTHER_POI_ID })

    const r = unloadMsToDepot('ms-3', DEPOT_POI_ID)

    expect(r).toEqual({ ok: false, reasonZh: expect.any(String) })
  })

  it('refuses when the MS is in transit', () => {
    spawnHangarAtDepot()
    spawnShip('ship-4')
    spawnMs('ms-4', { storedOnShipKey: 'ship-4', transitDestinationId: OTHER_POI_ID })

    const r = unloadMsToDepot('ms-4', DEPOT_POI_ID)

    expect(r.ok).toBe(false)
  })

  it('refuses when the depot hangar has no MS-fitting slot', () => {
    spawnHangarAtDepot(0)
    spawnShip('ship-5')
    spawnMs('ms-5', { storedOnShipKey: 'ship-5' })

    const r = unloadMsToDepot('ms-5', DEPOT_POI_ID)

    expect(r.ok).toBe(false)
  })

  it('refuses when unknown msKey', () => {
    spawnHangarAtDepot()
    const r = unloadMsToDepot('does-not-exist', DEPOT_POI_ID)
    expect(r.ok).toBe(false)
  })
})

describe('loadMsAboard', () => {
  it('flips dockedAtPoiId -> storedOnShipKey when the ship has a free bay at the same POI', () => {
    const ship = spawnShip('ship-6', { hangarCapacity: 1 })
    void ship
    const ms = spawnMs('ms-6', { dockedAtPoiId: DEPOT_POI_ID })

    const r = loadMsAboard('ms-6', 'ship-6')

    expect(r.ok).toBe(true)
    const after = ms.get(Ms)!
    expect(after.dockedAtPoiId).toBe('')
    expect(after.storedOnShipKey).toBe('ship-6')
  })

  it('refuses when the ship has no free bay (hangarCapacity full)', () => {
    spawnShip('ship-7', { hangarCapacity: 1 })
    spawnMs('ms-7a', { storedOnShipKey: 'ship-7' }) // occupies the only bay
    const ms = spawnMs('ms-7b', { dockedAtPoiId: DEPOT_POI_ID })

    const r = loadMsAboard('ms-7b', 'ship-7')

    expect(r.ok).toBe(false)
    expect(ms.get(Ms)!.storedOnShipKey).toBe('')
  })

  it('refuses when the ship is docked at a different POI than the MS', () => {
    spawnShip('ship-8', { dockedAtPoiId: OTHER_POI_ID, hangarCapacity: 1 })
    const ms = spawnMs('ms-8', { dockedAtPoiId: DEPOT_POI_ID })

    const r = loadMsAboard('ms-8', 'ship-8')

    expect(r.ok).toBe(false)
    expect(ms.get(Ms)!.dockedAtPoiId).toBe(DEPOT_POI_ID)
  })

  it('refuses when the MS is not parked at any depot (already aboard / in transit)', () => {
    spawnShip('ship-9', { hangarCapacity: 2 })
    spawnShip('ship-9b', { hangarCapacity: 2 })
    spawnMs('ms-9', { storedOnShipKey: 'ship-9b' })

    const r = loadMsAboard('ms-9', 'ship-9')

    expect(r.ok).toBe(false)
  })

  it('refuses when unknown shipKey', () => {
    spawnMs('ms-10', { dockedAtPoiId: DEPOT_POI_ID })
    const r = loadMsAboard('ms-10', 'does-not-exist')
    expect(r.ok).toBe(false)
  })
})

describe('countMsAboard', () => {
  it('counts only Ms entities whose storedOnShipKey matches', () => {
    spawnShip('ship-11')
    spawnMs('ms-11a', { storedOnShipKey: 'ship-11' })
    spawnMs('ms-11b', { storedOnShipKey: 'ship-11' })
    spawnMs('ms-11c', { dockedAtPoiId: DEPOT_POI_ID })

    expect(countMsAboard('ship-11')).toBe(2)
  })

  it('returns 0 for an empty key', () => {
    expect(countMsAboard('')).toBe(0)
  })
})
