// Issue #163 — MS combat damage never persisted to the roster. The clone
// (`CombatShipState`, keyed `PLAYER_MS_KEY`) that `spawnPlayerMs` builds
// for the tactical arena took all combat damage; `dockMs` / `onMsDestroyed`
// despawned it without writing hull/armor back onto the persistent `Ms`
// roster entity, so a limp-home MS re-launched at full hull next sortie.
//
// These tests spawn directly into the real `playerShipInterior` world
// (same pattern as msCustody.test.ts) using the real `lightFreighter` /
// `mobileWorker` data so `launchMs`'s door-pick + weapon-hardpoint
// resolution run unmodified.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Ms, Ship, CombatShipState, EntityKey,
} from '../ecs/traits'
import { getWorld, setActiveSceneId } from '../ecs/world'
import {
  launchMs, dockMs, onMsDestroyed, getPlayerMs, syncMsCombatDamageToRoster,
} from './cockpit'
import { routeDockedMsToResupply, tickResupply } from './sortieResupply'

const SHIP_SCENE_ID = 'playerShipInterior'
const SHIP_KEY = 'ship'
const MS_KEY = 'roster-ms-1'

const spawned: Entity[] = []

function spawnFlagship(): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ship({
      templateId: 'lightFreighter',
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
      hasShield: false, shieldEfficiency: 1,
      topSpeed: 60, accel: 60, decel: 30, angularAccel: 4, maxAngVel: 1.5,
      crCurrent: 100, crMax: 100,
      dockedAtPoiId: '',
      fleetPos: { x: 0, y: 0 },
      inCombat: true,
    }),
    CombatShipState({
      shipClassId: 'lightFreighter',
      nameZh: '旗舰',
      captainId: '',
      side: 'player',
      isFlagship: true,
      isMs: false,
      pilotedByPlayer: true,
      isPlayer: true,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      heading: 0,
      angVel: 0,
      hullCurrent: 800, hullMax: 800,
      armorCurrent: 200, armorMax: 200,
      fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: 60,
      accel: 60,
      decel: 30,
      angularAccel: 4,
      maxAngVel: 1.5,
      weapons: [],
      ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 200 },
      currentTargetKey: '',
    }),
    EntityKey({ key: SHIP_KEY }),
  )
  spawned.push(ent)
  return ent
}

function spawnRosterMs(key: string, opts: {
  hullCurrent?: number
  armorCurrent?: number
  dockedAtPoiId?: string
} = {}): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    Ms({
      templateId: 'mobileWorker',
      name: 'Test MS',
      hullCurrent: opts.hullCurrent ?? 160,
      hullMax: 160,
      armorCurrent: opts.armorCurrent ?? 20,
      armorMax: 20,
      mountedWeapons: {},
      storedOnShipKey: SHIP_KEY,
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

beforeEach(() => {
  setActiveSceneId(SHIP_SCENE_ID)
})

afterEach(() => {
  const clone = getPlayerMs()
  if (clone) clone.destroy()
  for (const e of spawned) e.destroy()
  spawned.length = 0
})

describe('syncMsCombatDamageToRoster', () => {
  it('copies the clone hull/armor onto the named roster Ms entity', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    const clone = getPlayerMs()!
    clone.set(CombatShipState, { ...clone.get(CombatShipState)!, hullCurrent: 40, armorCurrent: 2 })

    syncMsCombatDamageToRoster(MS_KEY)

    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(40)
    expect(after.armorCurrent).toBe(2)
  })

  it('recomputes damageState to in-repair when the roster entity is parked at a depot and damaged', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    const clone = getPlayerMs()!
    clone.set(CombatShipState, { ...clone.get(CombatShipState)!, hullCurrent: 40 })
    // Defensive scenario — a depot-parked MS taking combat damage is not
    // reachable through the current single-MS launch flow (deployed MS
    // are always ship-stored), but the recompute must still be correct
    // for Task 5's wing reuse.
    ms.set(Ms, { ...ms.get(Ms)!, dockedAtPoiId: 'test-depot' })

    syncMsCombatDamageToRoster(MS_KEY)

    expect(ms.get(Ms)!.damageState).toBe('in-repair')
  })

  it('is a no-op when no clone is deployed', () => {
    spawnRosterMs(MS_KEY)
    expect(() => syncMsCombatDamageToRoster(MS_KEY)).not.toThrow()
  })

  it('is a no-op when the roster msKey does not match any Ms entity', () => {
    spawnFlagship()
    spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    expect(() => syncMsCombatDamageToRoster('does-not-exist')).not.toThrow()
  })
})

describe('dockMs', () => {
  it('writes the clone\'s damaged hull/armor back to the roster before despawning it', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    const clone = getPlayerMs()!
    clone.set(CombatShipState, { ...clone.get(CombatShipState)!, hullCurrent: 90, armorCurrent: 0 })

    const dockRes = dockMs({ force: true })
    expect(dockRes.ok).toBe(true)

    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(90)
    expect(after.armorCurrent).toBe(0)
    // Still aboard the ship (dockedAtPoiId untouched by dockMs — custody
    // transfer is a separate system) so damageState stays 'ready' per
    // Task 9's depot-only in-repair rule.
    expect(after.damageState).toBe('ready')
    expect(getPlayerMs()).toBeUndefined()
  })

  it('leaves the roster untouched when the clone docks at full hull', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    expect(dockMs({ force: true }).ok).toBe(true)

    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(160)
    expect(after.armorCurrent).toBe(20)
  })
})

describe('onMsDestroyed', () => {
  it('writes hull 0 back to the roster Ms entity on destruction', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    const clone = getPlayerMs()!
    clone.set(CombatShipState, { ...clone.get(CombatShipState)!, hullCurrent: 0, armorCurrent: 0 })

    onMsDestroyed()

    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(0)
    expect(after.armorCurrent).toBe(0)
    expect(getPlayerMs()).toBeUndefined()
  })
})

describe('resupply guard (#163)', () => {
  it('does not restore hull/armor — only propellant/ammo', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY, { hullCurrent: 50, armorCurrent: 5 })

    routeDockedMsToResupply(MS_KEY, SHIP_KEY, 'port-cradle')
    tickResupply(9999)

    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(50)
    expect(after.armorCurrent).toBe(5)
    expect(after.currentPropellant).toBeGreaterThan(0)
  })
})
