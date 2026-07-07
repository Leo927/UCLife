// W4.1 — crew-aboard reconcile + save round-trip world identity.
//
// The reconcile pass owns the invariant that the ship-interior world holds
// exactly the flagship's roster as crew bodies. These tests drive it
// through its own public surface plus the save handler round-trip (via the
// registry, like ms.test.ts), asserting: idempotence, relocate-from-city,
// trim-on-roster-shrink, spawn-on-missing, and one-world-after-reload.

import { describe, it, expect, beforeEach } from 'vitest'
import '../boot/saveHandlers/ship'
import '../boot/saveHandlers/crewAboard'
import { snapshotAll, restoreAll } from '../save/registry'
import { getWorld, SCENE_IDS } from '../ecs/world'
import {
  Ship, EntityKey, Character, EmployedAsCrew, CrewStation, IsFlagshipMark,
  IsInActiveFleet, Owner,
} from '../ecs/traits'
import { spawnNPC, spawnPlayer } from '../character/spawn'
import { getShipClass } from '../data/ship-classes'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { fleetConfig } from '../config'
import { reconcileCrewAboard } from './crewAboard'

const SHIP_SCENE_ID = 'playerShipInterior'
const CITY = 'vonBraunCity'

function shipWorld() { return getWorld(SHIP_SCENE_ID) }
function cityWorld() { return getWorld(CITY) }

function resetWorlds(): void {
  for (const id of SCENE_IDS) getWorld(id).reset()
}

// A flagship with a roster but no crew bodies yet.
function spawnFlagship(opts: { key: string; captain?: string; crew?: string[] }) {
  const cls = getShipClass('lightFreighter')
  const ship = shipWorld().spawn(
    Ship({
      templateId: cls.id,
      name: 'Test Freighter',
      hullCurrent: cls.hullMax, hullMax: cls.hullMax,
      armorCurrent: cls.armorMax, armorMax: cls.armorMax,
      fluxMax: cls.fluxMax, fluxCurrent: 0,
      fluxDissipation: cls.fluxDissipation,
      hasShield: cls.hasShield,
      shieldEfficiency: cls.shieldEfficiency,
      topSpeed: cls.topSpeed,
      accel: cls.accel, decel: cls.decel,
      angularAccel: cls.angularAccel, maxAngVel: cls.maxAngVel,
      crCurrent: cls.crMax, crMax: cls.crMax,
      dockedAtPoiId: '',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      aggression: fleetConfig.aggressionDefault,
      formationSlot: fleetConfig.activeFleetGrid.flagshipSlot,
      assignedCaptainId: opts.captain ?? '',
      crewIds: opts.crew ? [...opts.crew] : [],
    }),
    EntityKey({ key: opts.key }),
    Owner({ kind: 'character', entity: null }),
    IsFlagshipMark,
    IsInActiveFleet,
  )
  attachShipStatSheet(ship)
  return ship
}

// Count bodies carrying this EntityKey across every scene world.
function bodyWorldCount(key: string): number {
  let n = 0
  for (const id of SCENE_IDS) {
    const w = getWorld(id)
    for (const e of w.query(EntityKey)) {
      if (e.get(EntityKey)!.key === key) { n += 1; break }
    }
  }
  return n
}

function crewBodyKeysAboard(): string[] {
  const out: string[] = []
  for (const e of shipWorld().query(Character, EmployedAsCrew, EntityKey)) {
    out.push(e.get(EntityKey)!.key)
  }
  return out.sort()
}

describe('reconcileCrewAboard — world identity', () => {
  beforeEach(() => {
    resetWorlds()
    // A player is needed so crew bodies get RecruitedTo(owner=player).
    spawnPlayer(cityWorld(), { x: 0, y: 0 })
  })

  it('relocates city-hired crew into the ship world and marks them', () => {
    spawnFlagship({ key: 'ship-1', captain: 'npc-crew-1', crew: ['npc-crew-2'] })
    // Source bodies exist in the city (as after a hire).
    spawnNPC(cityWorld(), { name: 'Kai', color: '#abc', x: 5, y: 5, key: 'npc-crew-1' })
    spawnNPC(cityWorld(), { name: 'Sayla', color: '#def', x: 6, y: 6, key: 'npc-crew-2' })

    reconcileCrewAboard()

    expect(crewBodyKeysAboard(), 'both roster keys are bodied aboard')
      .toEqual(['npc-crew-1', 'npc-crew-2'])
    expect(bodyWorldCount('npc-crew-1'), 'captain resolves to exactly one world').toBe(1)
    expect(bodyWorldCount('npc-crew-2'), 'crew resolves to exactly one world').toBe(1)
    expect(getEntityScene('npc-crew-1'), 'captain now lives aboard').toBe(SHIP_SCENE_ID)
    const captain = crewBodyByKey('npc-crew-1')!
    expect(captain.get(EmployedAsCrew)!.role, 'captain role marked').toBe('captain')
    expect(captain.has(CrewStation), 'CrewStation activated on the crew body').toBe(true)
  })

  it('is idempotent — a second reconcile changes nothing', () => {
    spawnFlagship({ key: 'ship-1', crew: ['npc-crew-1', 'npc-crew-2'] })
    reconcileCrewAboard()
    const first = crewBodyKeysAboard()
    reconcileCrewAboard()
    expect(crewBodyKeysAboard(), 'body set is stable across reconciles').toEqual(first)
    expect(first.length, 'no duplicate bodies spawned').toBe(2)
  })

  it('trims a body when its roster entry is fired', () => {
    const ship = spawnFlagship({ key: 'ship-1', crew: ['npc-crew-1', 'npc-crew-2'] })
    reconcileCrewAboard()
    expect(crewBodyKeysAboard().length).toBe(2)

    const s = ship.get(Ship)!
    ship.set(Ship, { ...s, crewIds: ['npc-crew-1'] })
    reconcileCrewAboard()

    expect(crewBodyKeysAboard(), 'fired crew body is gone').toEqual(['npc-crew-1'])
    expect(bodyWorldCount('npc-crew-2'), 'fired crew removed from every world').toBe(0)
  })

  it('spawns a fresh body for a roster key with no source anywhere', () => {
    spawnFlagship({ key: 'ship-1', crew: ['npc-crew-9'] })
    reconcileCrewAboard()
    expect(crewBodyKeysAboard(), 'missing roster key materialized aboard').toEqual(['npc-crew-9'])
    expect(getEntityScene('npc-crew-9')).toBe(SHIP_SCENE_ID)
  })
})

describe('crewAboard save handler — round-trip', () => {
  beforeEach(() => {
    resetWorlds()
    spawnPlayer(cityWorld(), { x: 0, y: 0 })
  })

  it('crew survive save → reload in exactly one world (the ship)', () => {
    spawnFlagship({ key: 'ship-1', captain: 'npc-crew-1', crew: ['npc-crew-2', 'npc-crew-3'] })
    spawnNPC(cityWorld(), { name: 'Bright', color: '#abc', x: 1, y: 1, key: 'npc-crew-1' })
    spawnNPC(cityWorld(), { name: 'Mirai', color: '#def', x: 2, y: 2, key: 'npc-crew-2' })
    spawnNPC(cityWorld(), { name: 'Hayato', color: '#123', x: 3, y: 3, key: 'npc-crew-3' })
    reconcileCrewAboard()
    expect(crewBodyKeysAboard().length, 'seeded 3 crew aboard').toBe(3)

    const bundle = snapshotAll()
    expect(bundle.crewAboard, 'crewAboard handler produced a snapshot').toBeTruthy()

    // Simulate the reload — wipe every world, then restore the post phase.
    resetWorlds()
    spawnPlayer(cityWorld(), { x: 0, y: 0 })
    restoreAll(bundle, 'post')

    expect(crewBodyKeysAboard(), 'all three crew re-materialized aboard')
      .toEqual(['npc-crew-1', 'npc-crew-2', 'npc-crew-3'])
    for (const k of ['npc-crew-1', 'npc-crew-2', 'npc-crew-3']) {
      expect(bodyWorldCount(k), `${k} resolves to exactly one world after reload`).toBe(1)
      expect(getEntityScene(k), `${k} lives aboard after reload`).toBe(SHIP_SCENE_ID)
    }
    expect(crewBodyByKey('npc-crew-1')!.get(Character)!.name, 'name survived the round-trip')
      .toBe('Bright')
  })
})

function crewBodyByKey(key: string) {
  for (const e of shipWorld().query(Character, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

function getEntityScene(key: string): string | null {
  for (const id of SCENE_IDS) {
    const w = getWorld(id)
    for (const e of w.query(EntityKey)) {
      if (e.get(EntityKey)!.key === key) return id
    }
  }
  return null
}
