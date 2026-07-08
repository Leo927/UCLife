// Issue #163 — MS combat damage never persisted to the roster. The clone
// (`CombatShipState`, keyed `PLAYER_MS_KEY`) that `spawnPlayerMs` builds
// for the tactical arena took all combat damage; `dockMs` / the destruction
// exit (now `onMsEjected`, W3 Task 7) despawned it without writing
// hull/armor back onto the persistent `Ms` roster entity, so a limp-home MS
// re-launched at full hull next sortie.
//
// These tests spawn directly into the real `playerShipInterior` world
// (same pattern as msCustody.test.ts) using the real `lightFreighter` /
// `mobileWorker` data so `launchMs`'s door-pick + weapon-hardpoint
// resolution run unmodified.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Ms, Ship, CombatShipState, EntityKey, IsPlayer, ShipBody, Position,
  MoveTarget, Action,
} from '../ecs/traits'
import { getWorld, setActiveSceneId } from '../ecs/world'
import {
  launchMs, dockMs, onMsEjected, getPlayerMs, syncMsCombatDamageToRoster,
  leaveBridge,
} from './cockpit'
import { useScene } from './scene'
import { useClock } from './clock'
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
      hitRadiusPx: 12,
      boostRemainingSec: 0,
      boostCooldownSec: 0,
      pendingTargetKey: '',
      pendingTargetSec: 0,
      boostDecisionTimerSec: 0,
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

  it('docking from the helm scene flips to the interior without destroying the campaign ship', () => {
    spawnFlagship()
    spawnRosterMs(MS_KEY)
    const space = getWorld('spaceCampaign')
    const campaignShip = space.spawn(
      IsPlayer(), ShipBody(), Position({ x: 0, y: 0 }), EntityKey({ key: 'spacePlayer' }),
    )
    spawned.push(campaignShip)
    const w = getWorld(SHIP_SCENE_ID)
    const avatar = w.spawn(
      IsPlayer(), Position({ x: 0, y: 0 }),
      MoveTarget({ x: 0, y: 0 }), Action({ kind: 'idle', remaining: 0, total: 0 }),
      EntityKey({ key: 'player' }),
    )
    spawned.push(avatar)
    expect(launchMs(MS_KEY).ok).toBe(true)
    useScene.getState().setActive('spaceCampaign')

    expect(dockMs({ force: true }).ok).toBe(true)

    expect(space.queryFirst(IsPlayer, ShipBody),
      'the campaign player-ship entity must survive the dock-back').toBeDefined()
    expect(useScene.getState().activeId,
      'docking lands the player in the walkable ship interior').toBe(SHIP_SCENE_ID)
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

describe('onMsEjected', () => {
  it('writes hull 0 back to the roster Ms entity and returns the clone\'s last pose', () => {
    spawnFlagship()
    const ms = spawnRosterMs(MS_KEY)
    expect(launchMs(MS_KEY).ok).toBe(true)

    const clone = getPlayerMs()!
    clone.set(CombatShipState, {
      ...clone.get(CombatShipState)!,
      hullCurrent: 0, armorCurrent: 0,
      pos: { x: 123, y: 456 }, vel: { x: 7, y: -8 },
    })

    const snap = onMsEjected()

    expect(snap, 'onMsEjected must return the ejected clone snapshot').not.toBeNull()
    expect(snap!.rosterKey, 'snapshot must carry the roster key for the pod').toBe(MS_KEY)
    expect(snap!.pos, 'pod spawns where the MS died').toEqual({ x: 123, y: 456 })
    expect(snap!.vel, 'pod drift derives from the MS\'s last velocity').toEqual({ x: 7, y: -8 })
    const after = ms.get(Ms)!
    expect(after.hullCurrent).toBe(0)
    expect(after.armorCurrent).toBe(0)
    expect(getPlayerMs()).toBeUndefined()
  })

  it('returns null when no MS is launched', () => {
    spawnFlagship()
    expect(onMsEjected()).toBeNull()
  })
})

describe('leaveBridge', () => {
  // W3 Task 9 regression — leaving the bridge while at the helm (active
  // scene 'spaceCampaign') used to route through migratePlayerToScene,
  // whose queryFirst(IsPlayer) in the space world is the CAMPAIGN PLAYER
  // SHIP (IsPlayer + ShipBody): the migration destroyed the ship entity
  // and cloned a duplicate avatar into the interior. The avatar never
  // lives in the space world — takeHelm only swaps the active scene — so
  // leaveBridge must only reposition the interior avatar and swap back.
  it('from the helm it must not destroy the campaign player-ship entity', () => {
    spawnFlagship()
    const space = getWorld('spaceCampaign')
    const campaignShip = space.spawn(
      IsPlayer(), ShipBody(), Position({ x: 100, y: 200 }),
      EntityKey({ key: 'spacePlayer' }),
    )
    spawned.push(campaignShip)
    const w = getWorld(SHIP_SCENE_ID)
    const avatar = w.spawn(
      IsPlayer(), Position({ x: 0, y: 0 }),
      MoveTarget({ x: 0, y: 0 }), Action({ kind: 'idle', remaining: 0, total: 0 }),
      EntityKey({ key: 'player' }),
    )
    spawned.push(avatar)
    useScene.getState().setActive('spaceCampaign')

    leaveBridge()

    expect(space.queryFirst(IsPlayer, ShipBody),
      'the campaign player-ship entity must survive leaving the bridge').toBeDefined()
    expect([...w.query(IsPlayer)].length,
      'leaveBridge must not clone a second interior avatar').toBe(1)
    expect(useScene.getState().activeId,
      'leaveBridge lands the player in the walkable ship interior').toBe(SHIP_SCENE_ID)
  })

  // Reported bug — the player could not walk the ship interior mid-combat.
  // With a single time authority (clock.speed), the tactical auto-pause
  // stops all sim time (speed=0), which also freezes on-foot movement.
  // Stepping off the helm has no tactical control to justify a pause, so
  // leaveBridge resumes time: the fight continues on AI and the avatar walks.
  it('resumes the game clock so the avatar can walk (combat runs on AI)', () => {
    spawnFlagship()
    const w = getWorld(SHIP_SCENE_ID)
    const avatar = w.spawn(
      IsPlayer(), Position({ x: 0, y: 0 }),
      MoveTarget({ x: 0, y: 0 }), Action({ kind: 'idle', remaining: 0, total: 0 }),
      EntityKey({ key: 'player' }),
    )
    spawned.push(avatar)
    setActiveSceneId(SHIP_SCENE_ID)
    useScene.getState().setActive(SHIP_SCENE_ID)
    // Combat auto-paused the single clock on first contact.
    useClock.getState().setMode('combat')
    useClock.getState().setSpeed(0)

    leaveBridge()

    expect(useClock.getState().speed,
      'leaving the helm must resume sim time so the player can walk').toBe(1)
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
