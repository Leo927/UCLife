// Review finding (Important) — §4's enemy fire loop (src/systems/combat.ts)
// snapshots `playerSide` once at the top of combatSystem's tick, then for
// EVERY enemy re-scans that same snapshot to find the closest player-side
// unit via `ps.get(CombatShipState)!`. An earlier enemy's beam this same
// tick can synchronously destroy a player-side row (escort destruction
// strips CombatShipState via `tgt.remove(CombatShipState)` in fireWeapon;
// the player-MS destruction path does the same via onMsDestroyed) — so by
// the time a later enemy's turn runs in the same for-loop, `ps.get(...)!`
// dereferences a trait that's already gone, and `.pos` throws on undefined.
// This mirrors the same-tick-destroy bug §4b already guards against
// (resolvedTargets built at §1 vs. read after §3's damage in §4b).
//
// This test builds a minimal tactical world directly (same pattern as
// sim/cockpit.test.ts / systems/msCustody.test.ts: spawn straight into the
// real playerShipInterior world) with one 1-hp escort and two enemies both
// carrying an already-charged beam, positioned so both target the escort.
// The first enemy processed kills the escort outright (beam damage vastly
// exceeds 1 hp); the second enemy's scan over the stale `playerSide`
// snapshot is exactly the crash this test pins.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  Ship, IsFlagshipMark, CombatShipState, EntityKey,
} from '../ecs/traits'
import { getWorld, setActiveSceneId } from '../ecs/world'
import { combatSystem, useCombatStore } from './combat'
import { getWeapon } from '../data/weapons'

const SHIP_SCENE_ID = 'playerShipInterior'
const ENEMY_BEAM_ID = 'pirateBeamMk0'

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
    IsFlagshipMark(),
    CombatShipState({
      shipClassId: 'lightFreighter',
      nameZh: '旗舰',
      captainId: '',
      side: 'player',
      isFlagship: true,
      isMs: false,
      pilotedByPlayer: false,
      isPlayer: true,
      // Far from the escort/enemies below so enemy targeting always
      // resolves to the escort, not the flagship.
      pos: { x: 950, y: 550 },
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
    EntityKey({ key: 'flagship-under-test' }),
  )
  spawned.push(ent)
  return ent
}

// A player-side active-fleet escort (not the flagship, not an MS) at 1 hp
// with no armor — one beam hit destroys it outright via applyDamageToEscort.
function spawnFragileEscort(): Entity {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    CombatShipState({
      shipClassId: 'pirateLight',
      nameZh: '测试护卫舰',
      captainId: '',
      side: 'player',
      isFlagship: false,
      isMs: false,
      pilotedByPlayer: false,
      isPlayer: false,
      pos: { x: 500, y: 500 },
      vel: { x: 0, y: 0 },
      heading: 0,
      angVel: 0,
      hullCurrent: 1, hullMax: 100,
      armorCurrent: 0, armorMax: 0,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: 40,
      accel: 40,
      decel: 20,
      angularAccel: 3,
      maxAngVel: 1.2,
      weapons: [],
      ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 200 },
      currentTargetKey: '',
    }),
    EntityKey({ key: 'escort-under-test' }),
  )
  spawned.push(ent)
  return ent
}

// An enemy with one already-charged beam mount (full 360° arc so facing
// never matters), close enough to the escort to fire the instant
// combatSystem ticks.
function spawnReadyBeamEnemy(key: string, pos: { x: number; y: number }): Entity {
  const def = getWeapon(ENEMY_BEAM_ID)
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.spawn(
    CombatShipState({
      shipClassId: 'pirateLight',
      nameZh: `测试敌舰-${key}`,
      captainId: '',
      side: 'enemy',
      isFlagship: false,
      isMs: false,
      pilotedByPlayer: false,
      isPlayer: false,
      pos,
      vel: { x: 0, y: 0 },
      heading: 0,
      angVel: 0,
      hullCurrent: 100, hullMax: 100,
      armorCurrent: 20, armorMax: 20,
      fluxMax: 200, fluxCurrent: 0, fluxDissipation: 20,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: 40,
      accel: 40,
      decel: 20,
      angularAccel: 3,
      maxAngVel: 1.2,
      weapons: [{
        weaponId: ENEMY_BEAM_ID,
        size: 'small',
        firingArcRad: Math.PI * 2,
        facingRad: 0,
        chargeSec: def.chargeSec,
        ready: true,
        hardpointId: '',
      }],
      ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 200 },
      currentTargetKey: '',
    }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

beforeEach(() => {
  setActiveSceneId(SHIP_SCENE_ID)
  useCombatStore.setState({ paused: false })
})

afterEach(() => {
  for (const e of spawned) if (e.id !== undefined) e.destroy()
  spawned.length = 0
  useCombatStore.setState({ paused: true })
})

describe('combatSystem — §4 enemy fire loop same-tick-destroy liveness (review finding)', () => {
  it('does not throw when an earlier enemy kills the only player-side target before a later enemy scans it', () => {
    spawnFlagship()
    spawnFragileEscort()
    // Both enemies sit well within pirateBeamMk0's range of the escort and
    // both start fully charged, so both fire this same tick.
    spawnReadyBeamEnemy('enemy-a', { x: 520, y: 500 })
    spawnReadyBeamEnemy('enemy-b', { x: 540, y: 500 })

    expect(() => combatSystem(getWorld(SHIP_SCENE_ID), 16)).not.toThrow()

    const w = getWorld(SHIP_SCENE_ID)
    let escortAlive = false
    for (const e of w.query(CombatShipState, EntityKey)) {
      if (e.get(EntityKey)!.key === 'escort-under-test') escortAlive = true
    }
    expect(escortAlive, 'the 1-hp escort must have been destroyed by the first enemy beam this tick').toBe(false)
  })
})
