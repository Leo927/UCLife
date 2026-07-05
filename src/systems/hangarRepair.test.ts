// Task 9 (W1 playable-loop) — hangar repair unit tests. hangarRepairSystem
// resolves scenes via the real getWorld()/SCENE_IDS registry internally
// (poiIdForHangar needs real POI data to resolve), so — like
// msCustody.test.ts — these tests spawn directly into real scene worlds
// rather than a bespoke createWorld(). marikoRefineryScene / marikoRefinery
// is a real, single-region scene+POI pair (data/pois.json5 + scenes.json5),
// picked so poiIdForHangar resolves deterministically.

import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Building, Hangar, EntityKey, Ship, Ms, Workstation, Position, Character, Job,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { hangarRepairSystem } from './hangarRepair'
import { computeMsDamageState } from '../ecs/msDamage'
import { worldConfig } from '../config'

const SHIP_SCENE_ID = 'playerShipInterior'
const DEPOT_SCENE_ID = 'marikoRefineryScene'
const DEPOT_POI_ID = 'marikoRefinery'
const OTHER_POI_ID = 'vonBraun'
const TILE = worldConfig.tilePx

// One worker (perf=1, npc has no Attributes → workPerformance() floors to
// 1) + one manager (perf=1) → throughput = 1 × 1 × baseRepairPerWorker(50)
// = 50 points/day. See src/config/fleet.json5.
const EXPECTED_DAILY_THROUGHPUT = 50

const spawned: Entity[] = []
let uniq = 0
function freshKey(prefix: string): string {
  uniq += 1
  return `${prefix}-${uniq}`
}

afterEach(() => {
  for (const e of spawned) e.destroy()
  spawned.length = 0
})

function spawnStaffedHangar(): Entity {
  const w = getWorld(DEPOT_SCENE_ID)
  const bld = w.spawn(
    Building({ x: 0, y: 0, w: 10 * TILE, h: 10 * TILE, label: 'test-hangar', typeId: 'hangarSurface' }),
    Hangar({
      tier: 'surface',
      slotCapacity: { ms: 4, smallCraft: 4 },
      repairPriorityShipKey: '',
      pendingDeliveries: [],
      supplyCurrent: 0,
      supplyMax: 0,
      fuelCurrent: 0,
      fuelMax: 0,
      pendingSupplyDeliveries: [],
      pendingMsDeliveries: [],
    }),
    EntityKey({ key: freshKey('bld') }),
  )
  spawned.push(bld)

  const managerWs = w.spawn(
    Position({ x: 1 * TILE, y: 1 * TILE }),
    Workstation({ specId: 'hangar_manager', occupant: null }),
    EntityKey({ key: freshKey('ws-manager') }),
  )
  const manager = w.spawn(
    Character({ name: '主管', color: '#fff', title: '机库主管' }),
    Job({ workstation: managerWs, unemployedSinceMs: 0 }),
    EntityKey({ key: freshKey('npc-manager') }),
  )
  managerWs.set(Workstation, { specId: 'hangar_manager', occupant: manager })
  spawned.push(managerWs, manager)

  const workerWs = w.spawn(
    Position({ x: 2 * TILE, y: 1 * TILE }),
    Workstation({ specId: 'hangar_worker', occupant: null }),
    EntityKey({ key: freshKey('ws-worker') }),
  )
  const worker = w.spawn(
    Character({ name: '工人', color: '#fff', title: '机库工人' }),
    Job({ workstation: workerWs, unemployedSinceMs: 0 }),
    EntityKey({ key: freshKey('npc-worker') }),
  )
  workerWs.set(Workstation, { specId: 'hangar_worker', occupant: worker })
  spawned.push(workerWs, worker)

  return bld
}

function spawnMs(key: string, opts: {
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  storedOnShipKey?: string
  dockedAtPoiId?: string
}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const storedOnShipKey = opts.storedOnShipKey ?? ''
  const dockedAtPoiId = opts.dockedAtPoiId ?? ''
  const ent = w.spawn(
    Ms({
      templateId: 'mobileWorker',
      name: '',
      hullCurrent: opts.hullCurrent,
      hullMax: opts.hullMax,
      armorCurrent: opts.armorCurrent,
      armorMax: opts.armorMax,
      mountedWeapons: {},
      storedOnShipKey,
      bayIndex: 0,
      dockedAtPoiId,
      pilotId: '',
      transitDestinationId: '',
      transitArrivalDay: 0,
      currentPropellant: 0,
      currentAmmoByWeapon: {},
      currentLifeSupport: 0,
      frameMods: [],
      damageState: computeMsDamageState({
        hullCurrent: opts.hullCurrent, hullMax: opts.hullMax,
        armorCurrent: opts.armorCurrent, armorMax: opts.armorMax,
        dockedAtPoiId,
      }),
    }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

function spawnShip(key: string, opts: {
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  dockedAtPoiId: string
}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: opts.hullCurrent, hullMax: opts.hullMax,
      armorCurrent: opts.armorCurrent, armorMax: opts.armorMax,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: opts.dockedAtPoiId,
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
    }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

describe('hangarRepairSystem — MS repair lifecycle (Task 9)', () => {
  it('repairs a damaged depot MS armor-first, then hull, flipping damageState on completion', () => {
    spawnStaffedHangar()
    const ms = spawnMs('ms-1', {
      hullCurrent: 40, hullMax: 100, armorCurrent: 5, armorMax: 20, dockedAtPoiId: DEPOT_POI_ID,
    })
    expect(ms.get(Ms)!.damageState, 'damaged + docked at a depot starts in-repair').toBe('in-repair')

    // Day 1: throughput 50 — armor deficit (15) closes first, remaining
    // 35 flows to hull (40 -> 75). Hull deficit (25) remains — not fully
    // repaired yet, so damageState stays 'in-repair'.
    const r1 = hangarRepairSystem(1)
    expect(r1.pointsApplied).toBe(EXPECTED_DAILY_THROUGHPUT)
    const afterDay1 = ms.get(Ms)!
    expect(afterDay1.armorCurrent, 'armor should repair before hull').toBe(20)
    expect(afterDay1.hullCurrent).toBe(75)
    expect(afterDay1.damageState, 'still damaged after day 1').toBe('in-repair')
    expect(r1.msRepaired).toBe(0)

    // Day 2: remaining hull deficit (25) fits well within the day's 50-
    // point throughput — fully repairs, damageState flips to 'ready'.
    const r2 = hangarRepairSystem(2)
    const afterDay2 = ms.get(Ms)!
    expect(afterDay2.hullCurrent).toBe(100)
    expect(afterDay2.armorCurrent).toBe(20)
    expect(afterDay2.damageState, 'fully repaired MS is ready').toBe('ready')
    expect(r2.msRepaired).toBe(1)
  })

  it('does NOT repair a damaged MS still stored aboard a ship (depot-only)', () => {
    spawnStaffedHangar()
    const ms = spawnMs('ms-2', {
      hullCurrent: 40, hullMax: 100, armorCurrent: 5, armorMax: 20, storedOnShipKey: 'some-ship',
    })
    expect(ms.get(Ms)!.damageState, 'damaged but aboard a ship stays ready-with-deficit').toBe('ready')

    const r = hangarRepairSystem(1)

    const after = ms.get(Ms)!
    expect(after.hullCurrent, 'aboard-ship MS must not be touched').toBe(40)
    expect(after.armorCurrent).toBe(5)
    expect(after.damageState).toBe('ready')
    expect(r.pointsApplied).toBe(0)
    expect(r.msRepaired).toBe(0)
  })

  it('still repairs a damaged ship (regression — ship-only pool unaffected by the MS generalization)', () => {
    spawnStaffedHangar()
    const ship = spawnShip('ship-1', {
      hullCurrent: 600, hullMax: 800, armorCurrent: 150, armorMax: 200, dockedAtPoiId: DEPOT_POI_ID,
    })

    const r = hangarRepairSystem(1)
    expect(r.pointsApplied).toBe(EXPECTED_DAILY_THROUGHPUT)
    const after = ship.get(Ship)!
    expect(after.armorCurrent, 'armor repairs before hull').toBe(200)
    expect(after.hullCurrent).toBe(600)
    expect(r.shipsRepaired).toBe(0)
    expect(r.msRepaired).toBe(0)
  })

  it('spreads one throughput pool evenly across a damaged ship AND a damaged depot MS', () => {
    spawnStaffedHangar()
    const ship = spawnShip('ship-2', {
      hullCurrent: 780, hullMax: 800, armorCurrent: 200, armorMax: 200, dockedAtPoiId: DEPOT_POI_ID,
    })
    const ms = spawnMs('ms-3', {
      hullCurrent: 90, hullMax: 100, armorCurrent: 20, armorMax: 20, dockedAtPoiId: DEPOT_POI_ID,
    })

    // Deficits: ship 20, ms 10 — both smaller than half the 50-point pool,
    // so both fully repair in one tick with leftover points on the floor
    // (the accumulator only rolls overflow to targets still damaged).
    const r = hangarRepairSystem(1)
    expect(ship.get(Ship)!.hullCurrent).toBe(800)
    expect(ms.get(Ms)!.hullCurrent).toBe(100)
    expect(ms.get(Ms)!.damageState).toBe('ready')
    expect(r.shipsRepaired).toBe(1)
    expect(r.msRepaired).toBe(1)
    expect(r.pointsApplied).toBe(30)
  })

  it('repair-priority focus can target an MS EntityKey, starving other damaged targets that tick', () => {
    const hangar = spawnStaffedHangar()
    const ms = spawnMs('ms-4', {
      hullCurrent: 40, hullMax: 100, armorCurrent: 20, armorMax: 20, dockedAtPoiId: DEPOT_POI_ID,
    })
    const ship = spawnShip('ship-3', {
      hullCurrent: 700, hullMax: 800, armorCurrent: 200, armorMax: 200, dockedAtPoiId: DEPOT_POI_ID,
    })
    const cur = hangar.get(Hangar)!
    hangar.set(Hangar, { ...cur, repairPriorityShipKey: 'ms-4' })

    const r = hangarRepairSystem(1)
    expect(ms.get(Ms)!.hullCurrent, 'focused MS gets the full pool').toBe(90)
    expect(ship.get(Ship)!.hullCurrent, 'unfocused ship gets nothing this tick').toBe(700)
    expect(r.pointsApplied).toBe(EXPECTED_DAILY_THROUGHPUT)
  })

  it('an MS parked at an unrelated POI is left untouched', () => {
    spawnStaffedHangar()
    const ms = spawnMs('ms-5', {
      hullCurrent: 40, hullMax: 100, armorCurrent: 5, armorMax: 20, dockedAtPoiId: OTHER_POI_ID,
    })

    const r = hangarRepairSystem(1)
    expect(ms.get(Ms)!.hullCurrent).toBe(40)
    expect(r.pointsApplied).toBe(0)
  })
})
