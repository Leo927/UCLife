// W4.3b (completes W3.6) — resupply time reads real hangar-crew stats. The
// placeholder `defaultHangarBossPerformance` / `defaultMechanicCrewCount` are
// replaced with the live hangar boss's workPerfMul + the count of additional
// hangar-stationed mechanic crew (ecs/crewRoles.ts). This test spawns a
// flagship + aboard MS directly into the real playerShipInterior world and
// proves a stronger boss shrinks the resupply window.

import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Ms, Ship, ShipStatSheet, Character, EmployedAsCrew, CrewStation, Attributes, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { projectShipSheet } from '../ecs/shipEffects'
import { getShipClass } from '../data/ship-classes'
import { setBase } from '../stats/sheet'
import { hangarResupplyStatsFor } from '../ecs/crewRoles'
import { resupplyTimeForMs } from './sortieResupply'
import { sortieConfig } from '../config'

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
      hullCurrent: 800, hullMax: 800, armorCurrent: 200, armorMax: 200,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 0, accel: 0, decel: 0, angularAccel: 1, maxAngVel: 1,
      crCurrent: 100, crMax: 100, dockedAtPoiId: '', fleetPos: { x: 0, y: 0 }, inCombat: false,
    }),
    ShipStatSheet({ sheet: projectShipSheet(getShipClass('lightFreighter')) }),
    EntityKey({ key: FLAGSHIP_KEY }),
  )
  spawned.push(ent)
  return ent
}

function spawnAboardMs(key: string): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ms({
      templateId: 'mobileWorker', name: '',
      hullCurrent: 100, hullMax: 100, armorCurrent: 20, armorMax: 20,
      mountedWeapons: {}, storedOnShipKey: FLAGSHIP_KEY, bayIndex: 0, dockedAtPoiId: '',
      pilotId: '', transitDestinationId: '', transitArrivalDay: 0,
      currentPropellant: 0, currentAmmoByWeapon: {}, currentLifeSupport: 0, frameMods: [],
    }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

// A hangar boss = a crew member stationed at the hangar bay (CrewStation
// roomId 'hangarBay'), with the given workPerfMul.
function spawnHangarBoss(key: string, workPerfMul: number): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Character({ name: '机库长', color: '#cccccc', title: '' }),
    EmployedAsCrew({ shipKey: FLAGSHIP_KEY, role: 'crew' }),
    CrewStation({ roomEntity: null, roomId: 'hangarBay', anchorX: 0, anchorY: 0, current: 'station' }),
    Attributes,
    EntityKey({ key }),
  )
  const a = ent.get(Attributes)!
  ent.set(Attributes, { ...a, sheet: setBase(a.sheet, 'workPerfMul', workPerfMul) })
  spawned.push(ent)
  return ent
}

describe('resupplyTimeForMs — real hangar-crew stats (completes W3.6)', () => {
  it('falls back to the config placeholder when no hangar boss is aboard', () => {
    spawnFlagship()
    const stats = hangarResupplyStatsFor(FLAGSHIP_KEY)
    expect(stats.bossPerf, 'no boss → config boss placeholder').toBe(sortieConfig.defaultHangarBossPerformance)
    expect(stats.mechanicCrewCount, 'no boss → config crew placeholder').toBe(sortieConfig.defaultMechanicCrewCount)
  })

  it('reads the hangar boss workPerfMul and shrinks the resupply window', () => {
    spawnFlagship()
    const ms = spawnAboardMs('ms-1')
    const tNoBoss = resupplyTimeForMs(ms)

    spawnHangarBoss('npc-crew-boss', 2)
    const stats = hangarResupplyStatsFor(FLAGSHIP_KEY)
    expect(stats.bossPerf, 'boss workPerfMul read live').toBe(2)

    const tWithBoss = resupplyTimeForMs(ms)
    expect(tWithBoss, 'a stronger hangar boss shrinks resupply time').toBeLessThan(tNoBoss)
    // base / 2 / (1 + 0) — a workPerfMul-2 boss halves the base window.
    expect(tWithBoss, 'resupply scales inversely with boss workPerfMul').toBeCloseTo(tNoBoss / 2, 5)
  })
})
