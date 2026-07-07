// Review finding (Important) — §4's enemy fire loop (src/systems/combat.ts)
// snapshots `playerSide` once at the top of combatSystem's tick, then for
// EVERY enemy re-scans that same snapshot to find the closest player-side
// unit via `ps.get(CombatShipState)!`. An earlier enemy's beam this same
// tick can synchronously destroy a player-side row (escort destruction
// strips CombatShipState via `tgt.remove(CombatShipState)` in fireWeapon;
// the player-MS destruction path does the same via onMsEjected) — so by
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
  Ship, IsFlagshipMark, CombatShipState, EntityKey, WeaponMount,
} from '../ecs/traits'
import { getWorld, setActiveSceneId } from '../ecs/world'
import {
  combatSystem, useCombatStore, tryBoost, __resetCombatProjectilesForTest,
  resolveReactionGatedTargetKey, jitterAimAngle, beamHitChance,
} from './combat'
import { getWeapon } from '../data/weapons'
import { getEnemyShip } from '../data/enemyShips'
import { getSimRng, setSimRngSeed } from '../sim/rng'

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
      hitRadiusPx: 12,
      boostRemainingSec: 0,
      boostCooldownSec: 0,
      pendingTargetKey: '',
      pendingTargetSec: 0,
      boostDecisionTimerSec: 0,
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
      hitRadiusPx: 12,
      boostRemainingSec: 0,
      boostCooldownSec: 0,
      pendingTargetKey: '',
      pendingTargetSec: 0,
      boostDecisionTimerSec: 0,
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
      hitRadiusPx: 12,
      boostRemainingSec: 0,
      boostCooldownSec: 0,
      pendingTargetKey: '',
      pendingTargetSec: 0,
      boostDecisionTimerSec: 0,
    }),
    EntityKey({ key }),
  )
  spawned.push(ent)
  return ent
}

beforeEach(() => {
  setActiveSceneId(SHIP_SCENE_ID)
  useCombatStore.setState({ paused: false })
  __resetCombatProjectilesForTest()
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

// W3 (ms-identity) Task 3 — hit-radius investigation finding: projectiles
// collided against a hardcoded `12` for every CombatShipState row before
// this task; tickProjectiles now reads each row's own hitRadiusPx. Beams
// are untouched (documented as an evidence-based decision in combat.ts —
// they're deterministic instant hits against an already-arc/range-resolved
// target, with no geometry to miss with).
//
// The flight below is aimed dead-on at the target's ORIGINAL position; the
// target is then repositioned sideways by exactly `offsetY` between the
// firing tick and the projectile's arrival, so the projectile's CLOSEST
// approach to the target is exactly `offsetY` — a value chosen larger than
// the pre-existing hardcoded 12, so neither case below could ever register
// a hit under the old code (a strong regression pin against reverting to a
// fixed radius).
describe('combatSystem — tickProjectiles reads per-row hitRadiusPx (W3 Task 3)', () => {
  const FLAGSHIP_POS = { x: 100, y: 300 }
  const BALLISTIC_ID = 'ballisticMk1'
  const OFFSET_Y = 20   // > the old hardcoded 12

  // accel/decel/topSpeed all 0 — the flagship stays exactly at FLAGSHIP_POS
  // for the whole flight (its own AI directive would otherwise nudge it a
  // fraction of a unit per tick; zeroing physics removes that noise
  // entirely rather than relying on it being negligible).
  function spawnFlagshipForFlightTest(): Entity {
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      Ship({
        templateId: 'lightFreighter',
        hullCurrent: 800, hullMax: 800,
        armorCurrent: 200, armorMax: 200,
        fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
        hasShield: false, shieldEfficiency: 1,
        topSpeed: 0, accel: 0, decel: 0, angularAccel: 4, maxAngVel: 1.5,
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
        pos: { ...FLAGSHIP_POS },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 800, hullMax: 800,
        armorCurrent: 200, armorMax: 200,
        fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
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
      EntityKey({ key: 'flagship-flight-test' }),
    )
    spawned.push(ent)
    return ent
  }

  // A fully-charged ballistic mount, full-circle arc so aiming never gates
  // the shot — fires the instant combatSystem ticks in 'auto' mode.
  function spawnBallisticMount(): Entity {
    const def = getWeapon(BALLISTIC_ID)
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(WeaponMount({
      mountIdx: 0,
      weaponId: BALLISTIC_ID,
      size: 'small',
      firingArcRad: Math.PI * 2,
      facingRad: 0,
      chargeSec: def.chargeSec,
      ready: true,
      targetIdx: -1,
    }))
    spawned.push(ent)
    return ent
  }

  // Stationary target — accel/decel/topSpeed all 0 so the AI directive
  // (which would otherwise steer it toward the flagship) can never move it;
  // its position stays exactly wherever this test sets it.
  function spawnStationaryTarget(pos: { x: number; y: number }, hitRadiusPx: number): Entity {
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      CombatShipState({
        shipClassId: 'pirate_junkerMs',
        nameZh: '测试小目标',
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: true,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { ...pos },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 100, hullMax: 100,
        armorCurrent: 0, armorMax: 0,
        fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: 3,
        maxAngVel: 1,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 50 },
        currentTargetKey: '',
        hitRadiusPx,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'flight-test-target' }),
    )
    spawned.push(ent)
    return ent
  }

  function targetHullAfterFlight(hitRadiusPx: number): number {
    const w = getWorld(SHIP_SCENE_ID)
    spawnFlagshipForFlightTest()
    spawnBallisticMount()
    // Aimed dead-on at (targetX, FLAGSHIP_POS.y) — the fire call resolves
    // `to: target.pos` exactly, so the projectile's straight-line path
    // passes through this point.
    const targetX = FLAGSHIP_POS.x + 90
    const target = spawnStationaryTarget({ x: targetX, y: FLAGSHIP_POS.y }, hitRadiusPx)

    // Tick 1: mount fires (spawns the projectile at FLAGSHIP_POS) AND
    // tickProjectiles moves it one step within the same call.
    combatSystem(w, 50)
    // Reposition the target sideways — simulates "it juked after the
    // shot was fired." The projectile's closest approach to the target's
    // NEW position is now exactly OFFSET_Y (reached when p.x === targetX).
    const cs = target.get(CombatShipState)!
    target.set(CombatShipState, { ...cs, pos: { x: targetX, y: FLAGSHIP_POS.y + OFFSET_Y } })

    // Ticks 2-5: projectile travels the remaining 4 × 18 = 72 units,
    // landing exactly at p.x === targetX on the 5th tick.
    for (let i = 0; i < 4; i++) combatSystem(w, 50)

    return target.get(CombatShipState)!.hullCurrent
  }

  it('a hitRadiusPx smaller than the closest-approach distance never registers a hit', () => {
    const hullAfter = targetHullAfterFlight(5)   // 5 < OFFSET_Y (20)
    expect(hullAfter, 'target must be untouched — closest approach (20) exceeds its hitRadiusPx (5)').toBe(100)
  })

  it('a hitRadiusPx larger than the closest-approach distance registers a hit', () => {
    const hullAfter = targetHullAfterFlight(25)   // 25 > OFFSET_Y (20)
    // ballisticMk1: damage 60 × armorDamage 1.4 = 84, armorMax 0 → all to hull.
    expect(hullAfter, 'target must take the full ballisticMk1 hit — closest approach (20) is inside its hitRadiusPx (25)').toBe(16)
  })
})

// W3 (ms-identity) Task 3 — vernier boost mechanics. Ships get no boost;
// isMs rows author one. tryBoost() is the single seam Task 4's enemy-MS AI
// and Task 5's wing AI will call directly — these tests exercise it on a
// hand-built enemy MS row (side:'enemy'), which has no propellant ledger
// (only the player's own piloted MS does — see tryBoost's doc comment), so
// cooldown is the only gate exercised here. The player-MS propellant debit
// is covered end-to-end by tests/smoke/ms-boost.spec.ts, which drives the
// real launch flow tryBoost's player branch depends on (getActiveMsRosterKey()).
describe('tryBoost (W3 Task 3)', () => {
  function spawnPlainEnemyShip(): Entity {
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      CombatShipState({
        shipClassId: 'pirateLight',
        nameZh: '测试敌舰',
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: false,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { x: 500, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 100, hullMax: 100,
        armorCurrent: 20, armorMax: 20,
        fluxMax: 200, fluxCurrent: 0, fluxDissipation: 20,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 40, accel: 40, decel: 20, angularAccel: 3, maxAngVel: 1.2,
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
      EntityKey({ key: 'plain-ship-under-test' }),
    )
    spawned.push(ent)
    return ent
  }

  function spawnEnemyMs(): Entity {
    const bp = getEnemyShip('pirate_junkerMs')
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      CombatShipState({
        shipClassId: 'pirate_junkerMs',
        nameZh: bp.nameZh,
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: true,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { x: 500, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: bp.hullMax, hullMax: bp.hullMax,
        armorCurrent: bp.armorMax, armorMax: bp.armorMax,
        fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: bp.topSpeed, accel: bp.accel, decel: bp.decel,
        angularAccel: bp.angularAccel, maxAngVel: bp.maxAngVel,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 200 },
        currentTargetKey: '',
        hitRadiusPx: bp.hitRadiusPx!,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'enemy-ms-under-test' }),
    )
    spawned.push(ent)
    return ent
  }

  it('a ship (non-isMs row) has no boost — tryBoost returns false and mutates nothing', () => {
    const ship = spawnPlainEnemyShip()
    const before = ship.get(CombatShipState)!
    expect(tryBoost(ship)).toBe(false)
    const after = ship.get(CombatShipState)!
    expect(after.boostRemainingSec).toBe(before.boostRemainingSec)
    expect(after.boostCooldownSec).toBe(before.boostCooldownSec)
  })

  it('an MS boost activates once, then its cooldown blocks an immediate re-trigger', () => {
    const bp = getEnemyShip('pirate_junkerMs')
    const ms = spawnEnemyMs()

    expect(tryBoost(ms)).toBe(true)
    const afterFirst = ms.get(CombatShipState)!
    expect(afterFirst.boostRemainingSec).toBe(bp.boost!.durationSec)
    expect(afterFirst.boostCooldownSec).toBe(bp.boost!.durationSec + bp.boost!.cooldownSec)

    expect(tryBoost(ms), 'cooldown must block an immediate re-trigger').toBe(false)
    const afterSecond = ms.get(CombatShipState)!
    expect(afterSecond.boostRemainingSec, 'a blocked retrigger must not reset the active window').toBe(afterFirst.boostRemainingSec)
  })

  it('boost raises effective topSpeed/accel above the un-boosted cap during a physics tick', () => {
    const bp = getEnemyShip('pirate_junkerMs')
    spawnFlagship()   // hostile target far away so the AI directive closes in (full thrust)
    const ms = spawnEnemyMs()
    const w = getWorld(SHIP_SCENE_ID)

    // Un-boosted baseline: 30 ticks × 16ms = 0.48s of full "close in" thrust.
    // v ≈ accel × t, comfortably under the un-boosted topSpeed cap (no clamp
    // to worry about muddying the comparison).
    for (let i = 0; i < 30; i++) combatSystem(w, 16)
    const baselineSpeed = Math.hypot(ms.get(CombatShipState)!.vel.x, ms.get(CombatShipState)!.vel.y)
    expect(baselineSpeed, 'sanity check — the AI directive must actually be thrusting').toBeGreaterThan(0)
    expect(baselineSpeed).toBeLessThan(bp.topSpeed)

    // Reset velocity to 0 and trigger boost, then repeat the identical
    // window — boosted accel is bp.boost.speedMul × higher, so the same
    // elapsed time must yield a proportionally higher speed.
    const cs = ms.get(CombatShipState)!
    ms.set(CombatShipState, { ...cs, vel: { x: 0, y: 0 } })
    expect(tryBoost(ms)).toBe(true)
    for (let i = 0; i < 30; i++) combatSystem(w, 16)
    const boostedSpeed = Math.hypot(ms.get(CombatShipState)!.vel.x, ms.get(CombatShipState)!.vel.y)

    expect(boostedSpeed, 'boosted accel must move the MS faster than the un-boosted baseline over the same window')
      .toBeGreaterThan(baselineSpeed * (bp.boost!.speedMul - 0.1))
  })
})

// W3 (ms-identity) Task 4 — pilot-quality AI for hostile MS. Pure-math unit
// tests for the three exported building blocks (reaction-delay state
// machine, projectile jitter, beam miss-chance), plus one combatSystem-level
// integration test proving the reaction-delay wiring end to end. All three
// pure functions are deliberately decoupled from koota Entity/RNG objects
// (they take plain keys / a raw [0,1) draw), so they're testable without any
// world/entity setup at all.
describe('resolveReactionGatedTargetKey (W3 Task 4 — pure)', () => {
  const REACTION_SEC = 0.5

  it('keeps the committed key with no pending switch when the raw scan agrees', () => {
    const r = resolveReactionGatedTargetKey('a', '', 0, 'a', 0.1, REACTION_SEC)
    expect(r).toEqual({ committedKey: 'a', pendingKey: '', pendingElapsedSec: 0 })
  })

  it('acquires a target immediately on first contact — no delay on initial acquisition', () => {
    const r = resolveReactionGatedTargetKey('', '', 0, 'a', 0.1, REACTION_SEC)
    expect(r).toEqual({ committedKey: 'a', pendingKey: '', pendingElapsedSec: 0 })
  })

  it('holds the old committed key while a new candidate is still within the reaction window', () => {
    // Candidate 'b' has been pending for 0.3s of a 0.5s window; +0.1s more
    // keeps it under the threshold.
    const r = resolveReactionGatedTargetKey('a', 'b', 0.3, 'b', 0.1, REACTION_SEC)
    expect(r.committedKey, 'must not have switched — still short of reactionSec').toBe('a')
    expect(r.pendingKey).toBe('b')
    expect(r.pendingElapsedSec).toBeCloseTo(0.4, 10)
  })

  it('commits to the new candidate once it has persisted for >= reactionSec', () => {
    const r = resolveReactionGatedTargetKey('a', 'b', 0.45, 'b', 0.1, REACTION_SEC)
    expect(r).toEqual({ committedKey: 'b', pendingKey: '', pendingElapsedSec: 0 })
  })

  it('restarts the timer when the candidate itself changes mid-wait', () => {
    // Was timing a switch to 'b' for 0.4s; this tick the raw scan flips to
    // 'c' instead — 'c' is a brand new candidate, so its clock starts at 0,
    // not inheriting 'b'\'s progress.
    const r = resolveReactionGatedTargetKey('a', 'b', 0.4, 'c', 0.1, REACTION_SEC)
    expect(r).toEqual({ committedKey: 'a', pendingKey: 'c', pendingElapsedSec: 0 })
  })

  it('eventually commits to "no target" when the committed target dies and nothing replaces it', () => {
    // rawNearestKey === '' (no hostiles left) persisting past reactionSec —
    // the pilot gives up on the dead target rather than holding it forever.
    const r = resolveReactionGatedTargetKey('a', '', 0.5, '', 0.1, REACTION_SEC)
    expect(r).toEqual({ committedKey: '', pendingKey: '', pendingElapsedSec: 0 })
  })
})

describe('jitterAimAngle (W3 Task 4 — pure)', () => {
  it('passes the base angle through unchanged when aimJitterRad is 0, regardless of the draw', () => {
    expect(jitterAimAngle(1.23, 0, 0)).toBe(1.23)
    expect(jitterAimAngle(1.23, 0, 0.5)).toBe(1.23)
    expect(jitterAimAngle(1.23, 0, 1)).toBe(1.23)
  })

  it('maps draw=0 to the minimum offset (-aimJitterRad) and draw=1 to the maximum (+aimJitterRad)', () => {
    expect(jitterAimAngle(0, 0.2, 0)).toBeCloseTo(-0.2, 10)
    expect(jitterAimAngle(0, 0.2, 1)).toBeCloseTo(0.2, 10)
  })

  it('maps draw=0.5 to exactly the base angle (the midpoint of the uniform range)', () => {
    expect(jitterAimAngle(0.7, 0.3, 0.5)).toBeCloseTo(0.7, 10)
  })
})

describe('beamHitChance (W3 Task 4 — pure)', () => {
  it('is always 1 (never misses) when aimJitterRad is 0, at any distance', () => {
    expect(beamHitChance(0, 9, 90)).toBe(1)
    expect(beamHitChance(0, 9, 1)).toBe(1)
  })

  it('caps at 1 when the target\'s angular size exceeds the full jitter spread (close/large target)', () => {
    // atan2(9, 10) ≈ 0.73 rad, larger than aimJitterRad=0.1 — even the
    // widest possible jitter draw still lands on the target.
    expect(beamHitChance(0.1, 9, 10)).toBe(1)
  })

  it('matches the documented formula exactly: min(1, atan2(hitRadiusPx, distance) / aimJitterRad)', () => {
    const hitRadiusPx = 9
    const distance = 90
    const aimJitterRad = 0.6
    const expected = Math.atan2(hitRadiusPx, distance) / aimJitterRad
    expect(beamHitChance(aimJitterRad, hitRadiusPx, distance)).toBeCloseTo(expected, 10)
    expect(expected).toBeLessThan(1)   // sanity — this case must NOT hit the cap
  })

  it('approaches 0 as aimJitterRad grows arbitrarily large relative to the target', () => {
    expect(beamHitChance(1000, 9, 90)).toBeLessThan(0.001)
  })
})

// Deterministic seeded-roll smoke: the exact formula a high-jitter enemy-MS
// pilot's beam rolls against every shot, run over a fixed window of ROLLS
// seeded draws. A zero-jitter pilot's chance is always 1 (never misses,
// proven above), so it lands every roll; a jittery pilot's chance is well
// under 1 (see the boundary test above for these exact parameters), so it
// must land strictly fewer over the same seeded window. Same seed -> same
// draw sequence -> the exact hit count below is reproducible on any machine.
describe('enemy-MS pilot AI — high jitter lands fewer hits than zero jitter (W3 Task 4 smoke)', () => {
  const HIT_RADIUS_PX = 9   // pirate_junkerMs's authored hitRadiusPx
  const DISTANCE = 90       // pirate_junkerMs's authored maintainRange
  const ROLLS = 500

  function countHits(aimJitterRad: number, seed: string): number {
    setSimRngSeed(seed)
    const chance = beamHitChance(aimJitterRad, HIT_RADIUS_PX, DISTANCE)
    let hits = 0
    for (let i = 0; i < ROLLS; i++) {
      if (getSimRng().next() < chance) hits += 1
    }
    return hits
  }

  it('a zero-jitter pilot never misses over the roll window', () => {
    expect(countHits(0, 'w3-task4-jitter-zero')).toBe(ROLLS)
  })

  it('a high-jitter pilot lands strictly fewer hits than a zero-jitter pilot under the same seed', () => {
    const SEED = 'w3-task4-jitter-cmp'
    const zeroJitterHits = countHits(0, SEED)
    const highJitterHits = countHits(0.6, SEED)
    expect(zeroJitterHits, 'sanity — zero jitter must still be the perfect-hit baseline').toBe(ROLLS)
    expect(highJitterHits, 'a 0.6 rad jitter pilot must miss noticeably more than a zero-jitter pilot').toBeLessThan(ROLLS)
  })
})

describe('enemy-MS pilot AI — reaction delay wired into combatSystem (W3 Task 4 integration)', () => {
  const ENEMY_MS_CLASS = 'pirate_junkerMs'   // reactionSec: 0.5

  function spawnFrozenFlagship(pos: { x: number; y: number }, key: string): Entity {
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      Ship({
        templateId: 'lightFreighter',
        hullCurrent: 800, hullMax: 800,
        armorCurrent: 200, armorMax: 200,
        fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
        hasShield: false, shieldEfficiency: 1,
        topSpeed: 0, accel: 0, decel: 0, angularAccel: 4, maxAngVel: 1.5,
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
        pos: { ...pos },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 800, hullMax: 800,
        armorCurrent: 200, armorMax: 200,
        fluxMax: 1500, fluxCurrent: 0, fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        // Zeroed physics — this test is about currentTargetKey bookkeeping,
        // not motion; freezing every mover removes "did it also drift" as
        // a confound.
        topSpeed: 0, accel: 0, decel: 0, angularAccel: 4, maxAngVel: 1.5,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 999 },
        currentTargetKey: '',
        hitRadiusPx: 12,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key }),
    )
    spawned.push(ent)
    return ent
  }

  function spawnFrozenEscort(pos: { x: number; y: number }, key: string): Entity {
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
        pos: { ...pos },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 100, hullMax: 100,
        armorCurrent: 0, armorMax: 0,
        fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0, accel: 0, decel: 0, angularAccel: 3, maxAngVel: 1.2,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 999 },
        currentTargetKey: '',
        hitRadiusPx: 12,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key }),
    )
    spawned.push(ent)
    return ent
  }

  function spawnEnemyMs(pos: { x: number; y: number }): Entity {
    const bp = getEnemyShip(ENEMY_MS_CLASS)
    const w = getWorld(SHIP_SCENE_ID)
    const ent = w.spawn(
      CombatShipState({
        shipClassId: ENEMY_MS_CLASS,
        nameZh: bp.nameZh,
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: true,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { ...pos },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: bp.hullMax, hullMax: bp.hullMax,
        armorCurrent: bp.armorMax, armorMax: bp.armorMax,
        fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        // Zeroed accel/topSpeed — same reasoning as the flagship/escort
        // helpers above; only currentTargetKey bookkeeping is under test.
        topSpeed: 0, accel: 0, decel: 0,
        angularAccel: bp.angularAccel, maxAngVel: bp.maxAngVel,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: bp.ai.maintainRange },
        currentTargetKey: '',
        hitRadiusPx: bp.hitRadiusPx!,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'enemy-ms-reaction-test' }),
    )
    spawned.push(ent)
    return ent
  }

  it('holds the committed target through the reaction window, then switches once reactionSec elapses', () => {
    const bp = getEnemyShip(ENEMY_MS_CLASS)
    const w = getWorld(SHIP_SCENE_ID)
    const enemyMs = spawnEnemyMs({ x: 500, y: 300 })
    spawnFrozenFlagship({ x: 600, y: 300 }, 'target-a')

    // Tick 1 — only target A exists yet — immediate first-acquisition lock.
    combatSystem(w, 16)
    expect(enemyMs.get(CombatShipState)!.currentTargetKey).toBe('target-a')

    // Target B spawns closer than A — the raw nearest-hostile scan flips,
    // but the pilot must keep engaging A for reactionSec more.
    spawnFrozenEscort({ x: 510, y: 300 }, 'target-b')

    // Advance well under reactionSec (0.5s) in small steps — must still
    // read target-a on every one of these ticks.
    const smallTickMs = 50
    const stepsUnderWindow = Math.floor((bp.pilot!.reactionSec * 1000) / smallTickMs / 2)
    for (let i = 0; i < stepsUnderWindow; i++) {
      combatSystem(w, smallTickMs)
      expect(
        enemyMs.get(CombatShipState)!.currentTargetKey,
        `tick ${i + 1}: well inside the ${bp.pilot!.reactionSec}s reaction window — must not have switched yet`,
      ).toBe('target-a')
    }

    // One large tick, comfortably longer than reactionSec — must commit to B.
    combatSystem(w, bp.pilot!.reactionSec * 1000 * 3)
    expect(enemyMs.get(CombatShipState)!.currentTargetKey).toBe('target-b')
  })
})

// W3 (ms-identity) Task 4 — pilot boost-decision roll seeded proof. The
// boost path is a probabilistic roll against pilot.boostUse, gated by the
// decision timer window and the closing/disengaging condition. This test
// directly seeds the RNG to prove the roll fires — a willing pilot with
// favorable odds must actually boost, and an unwilling pilot (boostUse: 0)
// must never boost even when closing in.
describe('enemy-MS pilot AI — boost-decision seeded proof (W3 Task 4 unit)', () => {
  const ENEMY_MS_CLASS = 'pirate_junkerMs'
  const BOOST_DECISION_WINDOW_SEC = 1.0

  it('a willing pilot (boostUse > 0) closing in must boost once the decision window elapses and the roll passes', () => {
    const bp = getEnemyShip(ENEMY_MS_CLASS)
    const pilot = bp.pilot!
    expect(pilot.boostUse, 'sanity: test fixture must have boostUse > 0').toBeGreaterThan(0)

    const w = getWorld(SHIP_SCENE_ID)
    // Spawn enemy MS at {500, 300}. Flagship far away at {100, 300}.
    // Range = 400, maintainRange = 200, so range > 200 × 1.15 = 230 → closing in.
    const enemyMs = w.spawn(
      CombatShipState({
        shipClassId: ENEMY_MS_CLASS,
        nameZh: bp.nameZh,
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: true,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { x: 500, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: bp.hullMax,
        hullMax: bp.hullMax,
        armorCurrent: bp.armorMax,
        armorMax: bp.armorMax,
        fluxMax: 0,
        fluxCurrent: 0,
        fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: bp.angularAccel,
        maxAngVel: bp.maxAngVel,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange: 200 },
        currentTargetKey: 'flagship-boost-test',
        hitRadiusPx: bp.hitRadiusPx!,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'enemy-ms-boost-test' }),
    )
    spawned.push(enemyMs)

    const flagship = w.spawn(
      Ship({
        templateId: 'lightFreighter',
        hullCurrent: 800,
        hullMax: 800,
        armorCurrent: 200,
        armorMax: 200,
        fluxMax: 1500,
        fluxCurrent: 0,
        fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: 4,
        maxAngVel: 1.5,
        crCurrent: 100,
        crMax: 100,
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
        pos: { x: 100, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 800,
        hullMax: 800,
        armorCurrent: 200,
        armorMax: 200,
        fluxMax: 1500,
        fluxCurrent: 0,
        fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
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
      EntityKey({ key: 'flagship-boost-test' }),
    )
    spawned.push(flagship)

    // Seed the RNG so getSimRng().next() returns a value < pilot.boostUse.
    // With boostUse around 0.4-0.6 typically, seeding with '0' gives
    // deterministic next() values in [0, 1), so we can control the roll.
    setSimRngSeed('boost-willing-seed')

    // Tick past the decision window (1.0s).
    // Each combatSystem call advances boostDecisionTimerSec by dtSec.
    // We need boostDecisionTimerSec >= 1.0 to trigger the decision.
    combatSystem(w, 16) // 16ms, boostDecisionTimerSec = 0.016
    // Continue ticking until we reach 1.0s cumulative
    const tickSec = 0.016
    let elapsed = tickSec
    while (elapsed < BOOST_DECISION_WINDOW_SEC) {
      combatSystem(w, 16)
      elapsed += tickSec
    }

    // At this point, the decision window has fired at least once, and
    // the seeded RNG roll should have passed (firstRoll < pilot.boostUse).
    // Assert: boostCooldownSec > 0 — a successful boost activation.
    const afterBoost = enemyMs.get(CombatShipState)!
    expect(
      afterBoost.boostCooldownSec,
      'a willing pilot must actually boost when the roll passes and range is in closing state',
    ).toBeGreaterThan(0)
  })

  it('a pilot at maintainRange (not closing/disengaging) does not boost even with favorable RNG', () => {
    // This test verifies the msClosingOrDisengaging gate: even if the RNG
    // roll is favorable and boostUse > 0, the boost is only considered when
    // the MS is actively closing or disengaging (range < 0.85×mr or range > 1.15×mr).
    // At exactly maintainRange, neither condition is true — the pilot strafes
    // instead — so no boost should happen regardless of RNG.
    const bp = getEnemyShip(ENEMY_MS_CLASS)

    const w = getWorld(SHIP_SCENE_ID)
    const maintainRange = 200
    // Position enemy MS at distance exactly equal to maintainRange (200 units).
    // Flagship at {100, 300}, enemy at {300, 300} → range = 200.
    // 200 is not < 0.85×200 (170) and not > 1.15×200 (230), so
    // msClosingOrDisengaging = false → no boost decision considered.
    const enemyMs = w.spawn(
      CombatShipState({
        shipClassId: ENEMY_MS_CLASS,
        nameZh: bp.nameZh,
        captainId: '',
        side: 'enemy',
        isFlagship: false,
        isMs: true,
        pilotedByPlayer: false,
        isPlayer: false,
        pos: { x: 300, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: bp.hullMax,
        hullMax: bp.hullMax,
        armorCurrent: bp.armorMax,
        armorMax: bp.armorMax,
        fluxMax: 0,
        fluxCurrent: 0,
        fluxDissipation: 0,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: bp.angularAccel,
        maxAngVel: bp.maxAngVel,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange },
        currentTargetKey: 'flagship-maintain-test',
        hitRadiusPx: bp.hitRadiusPx!,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'enemy-ms-maintain-test' }),
    )
    spawned.push(enemyMs)

    const flagship = w.spawn(
      Ship({
        templateId: 'lightFreighter',
        hullCurrent: 800,
        hullMax: 800,
        armorCurrent: 200,
        armorMax: 200,
        fluxMax: 1500,
        fluxCurrent: 0,
        fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: 4,
        maxAngVel: 1.5,
        crCurrent: 100,
        crMax: 100,
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
        pos: { x: 100, y: 300 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        hullCurrent: 800,
        hullMax: 800,
        armorCurrent: 200,
        armorMax: 200,
        fluxMax: 1500,
        fluxCurrent: 0,
        fluxDissipation: 75,
        hasShield: false,
        shieldEfficiency: 1,
        shieldUp: false,
        topSpeed: 0,
        accel: 0,
        decel: 0,
        angularAccel: 4,
        maxAngVel: 1.5,
        weapons: [],
        ai: { aggression: 0.5, retreatThreshold: 0.2, maintainRange },
        currentTargetKey: '',
        hitRadiusPx: 12,
        boostRemainingSec: 0,
        boostCooldownSec: 0,
        pendingTargetKey: '',
        pendingTargetSec: 0,
        boostDecisionTimerSec: 0,
      }),
      EntityKey({ key: 'flagship-maintain-test' }),
    )
    spawned.push(flagship)

    // Even with a favorable RNG seed, at maintainRange the
    // msClosingOrDisengaging gate is false, so the boost decision
    // is never checked. After ticking past the decision window,
    // boostCooldownSec must remain 0.
    setSimRngSeed('boost-willing-seed')

    // Tick past the decision window
    combatSystem(w, 16)
    const tickSec = 0.016
    let elapsed = tickSec
    while (elapsed < BOOST_DECISION_WINDOW_SEC + 0.1) {
      combatSystem(w, 16)
      elapsed += tickSec
    }

    // At maintainRange, msClosingOrDisengaging = false, so no boost happens.
    const afterMaintain = enemyMs.get(CombatShipState)!
    expect(
      afterMaintain.boostCooldownSec,
      'a pilot at maintainRange must not boost (gate: msClosingOrDisengaging = false)',
    ).toBe(0)
  })
})
