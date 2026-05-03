// Phase 6.0 Starsector-shape tactical combat. Top-down 2D real-time-with-
// pause: ship position/velocity/heading, hardpoint weapons firing in arcs
// + range, projectile entities, flux/shields/armor/hull damage routing.
//
// Tick model (per frame, when clock.mode === 'combat' AND store.paused === false):
//   1. Player ship physics (heading toward MoveTarget; velocity decay)
//   2. Player weapon charge + auto-fire when target in arc + range
//   3. Enemy AI (maintain range or close to maintainRange; turn to face)
//   4. Enemy weapon charge + auto-fire
//   5. Projectile motion + collision -> damage application
//   6. Flux dissipation (both ships)
//   7. Resolution check (hull <= 0 -> end)
//
// State lives in:
//   - Ship trait on the player flagship (in playerShipInterior world)
//   - EnemyShipState trait on the enemy entity (same world)
//   - Module-local projectile pool (in-memory only, transient)
//   - useCombatStore (UI state: open/paused/selectedMount/flash)

import type { World } from 'koota'
import type { Entity } from 'koota'
import { create } from 'zustand'
import {
  Ship, WeaponMount, EnemyShipState, EntityKey, IsPlayer, Money,
} from '../ecs/traits'
import { getEnemyShip } from '../data/enemyShips'
import { getWeapon, type WeaponDef } from '../data/weapons'
import { useClock } from '../sim/clock'
import { setInCombat, damageHull } from '../sim/ship'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { logEvent } from '../ui/EventLog'

const SHIP_SCENE_ID = 'playerShipInterior'

// Tactical arena is a fixed 1000x600 unit box; player spawns left-of-center,
// enemy right-of-center. Ship positions are in arena units.
export const ARENA_W = 1000
export const ARENA_H = 600
const PLAYER_SPAWN = { x: 250, y: 300 }
const ENEMY_SPAWN = { x: 750, y: 300 }

interface ProjectileSnap {
  id: number
  ownerSide: 'player' | 'enemy'
  weaponId: string
  x: number
  y: number
  vx: number
  vy: number
  rangeRemaining: number
}

let nextProjectileId = 1
const projectiles: ProjectileSnap[] = []

interface CombatState {
  open: boolean
  paused: boolean
  selectedMountIdx: number | null
  // Recent flash banner (e.g. weapon hit)
  lastFlashZh: string
  lastFlashAtMs: number
  // Player throttle target — set by the tactical UI; combat tick steers
  // the flagship toward it. Null = hold position.
  playerTarget: { x: number; y: number } | null
  setOpen: (open: boolean) => void
  togglePause: () => void
  setSelectedMount: (idx: number | null) => void
  setPlayerTarget: (t: { x: number; y: number } | null) => void
  flash: (textZh: string) => void
  reset: () => void
  // Snapshot of projectiles — UI reads this each render. Not persisted
  // anywhere; combat is transient by design.
  getProjectiles: () => ProjectileSnap[]
}

export const useCombatStore = create<CombatState>((set) => ({
  open: false,
  paused: true,
  selectedMountIdx: null,
  lastFlashZh: '',
  lastFlashAtMs: 0,
  playerTarget: null,
  setOpen: (open) => set({ open }),
  togglePause: () => set((s) => {
    const next = !s.paused
    useClock.getState().setSpeed(next ? 0 : 1)
    return { paused: next }
  }),
  setSelectedMount: (selectedMountIdx) => set({ selectedMountIdx }),
  setPlayerTarget: (playerTarget) => set({ playerTarget }),
  flash: (lastFlashZh) => set({ lastFlashZh, lastFlashAtMs: performance.now() }),
  reset: () => set({
    open: false,
    paused: true,
    selectedMountIdx: null,
    lastFlashZh: '',
    lastFlashAtMs: 0,
    playerTarget: null,
  }),
  getProjectiles: () => projectiles.slice(),
}))

function shipWorld(): World {
  return getWorld(SHIP_SCENE_ID)
}

function getPlayerShip(): Entity | undefined {
  return shipWorld().queryFirst(Ship)
}

function getEnemyEntity(): Entity | undefined {
  return shipWorld().queryFirst(EnemyShipState)
}

function findPlayer(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

export function startCombat(enemyShipId: string): void {
  const blueprint = getEnemyShip(enemyShipId)
  const w = shipWorld()

  for (const e of w.query(EnemyShipState)) e.destroy()
  projectiles.length = 0

  const ship = getPlayerShip()
  if (ship) {
    const s = ship.get(Ship)!
    // Reset combat-time state on the player ship: full flux dissipation
    // baseline, position at arena spawn, no in-flight velocity.
    ship.set(Ship, {
      ...s,
      fluxCurrent: 0,
      armorCurrent: s.armorMax,
      // fleetPos doubles as tactical arena position during combat. Saved
      // off + restored at endCombat() so the campaign-map render keeps
      // its docked position.
      fleetPos: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
    })
  }

  w.spawn(
    EnemyShipState({
      shipClassId: blueprint.id,
      nameZh: blueprint.nameZh,
      pos: { x: ENEMY_SPAWN.x, y: ENEMY_SPAWN.y },
      vel: { x: 0, y: 0 },
      heading: Math.PI,    // facing -x toward player
      hullCurrent: blueprint.hullMax, hullMax: blueprint.hullMax,
      armorCurrent: blueprint.armorMax, armorMax: blueprint.armorMax,
      fluxMax: blueprint.fluxMax, fluxCurrent: 0, fluxDissipation: blueprint.fluxDissipation,
      shieldEfficiency: blueprint.shieldEfficiency,
      shieldUp: true,
      topSpeed: blueprint.topSpeed,
      maneuverability: blueprint.maneuverability,
      weapons: blueprint.defaultWeapons.map((id, i) => ({
        weaponId: id,
        size: blueprint.mounts[i].size,
        chargeSec: 0,
        ready: false,
      })),
      ai: {
        aggression: blueprint.ai.aggression,
        retreatThreshold: blueprint.ai.retreatThresholdPct,
      },
    }),
    EntityKey({ key: 'enemy-ship' }),
  )
  // The blueprint's maintainRange isn't part of the trait shape; keep it
  // module-local so the AI step can read it without a re-query.
  enemyMaintainRange = blueprint.ai.maintainRange

  setInCombat(true)
  useClock.getState().setMode('combat')
  useClock.getState().setSpeed(0)
  useCombatStore.getState().reset()
  useCombatStore.getState().setOpen(true)
  logEvent(`战斗开始 · 对手: ${blueprint.nameZh}`)
}

let enemyMaintainRange = 160

export type CombatOutcome = 'victory' | 'defeat' | 'flee'

export function endCombat(outcome: CombatOutcome): void {
  const w = shipWorld()
  for (const e of w.query(EnemyShipState)) e.destroy()
  projectiles.length = 0

  // Reset player weapon charge so a follow-up encounter starts cold.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    e.set(WeaponMount, { ...m, chargeSec: 0, ready: false })
  }

  setInCombat(false)
  useClock.getState().setMode('normal')
  useClock.getState().setSpeed(1)
  useCombatStore.getState().reset()

  if (outcome === 'victory') {
    const reward = 800 + Math.floor(Math.random() * 700)
    const player = findPlayer()
    if (player) {
      const m = player.get(Money) ?? { amount: 0 }
      player.set(Money, { amount: m.amount + reward })
    }
    logEvent(`战斗胜利 · 缴获 ¥${reward}`)
  } else if (outcome === 'defeat') {
    // Spine: defeat is non-game-over. Slice 6.2 wires permadeath / POW.
    const ship = getPlayerShip()
    if (ship) {
      const s = ship.get(Ship)!
      ship.set(Ship, { ...s, hullCurrent: Math.max(1, s.hullCurrent) })
    }
    logEvent('战斗失败 · 飞船重创')
  } else {
    logEvent('战斗脱离')
  }
}

// Damage routing on the enemy. Shields-up: incoming damage builds flux
// (proportional to shieldEfficiency). Once flux maxes, shields drop and
// the next hit eats armor + hull.
function applyDamageToEnemy(
  enemyEnt: Entity,
  weapon: WeaponDef,
): { absorbed: boolean; destroyed: boolean } {
  const e = enemyEnt.get(EnemyShipState)!
  let { fluxCurrent, fluxMax, shieldEfficiency, shieldUp } = e
  let armorCurrent = e.armorCurrent
  let hullCurrent = e.hullCurrent

  const damage = weapon.damage
  if (shieldUp && fluxCurrent < fluxMax) {
    const fluxAdd = damage * weapon.shieldDamage * shieldEfficiency
    fluxCurrent = Math.min(fluxMax, fluxCurrent + fluxAdd)
    if (fluxCurrent >= fluxMax) {
      shieldUp = false   // overload — shields drop until flux vents below 0.5*max
    }
    enemyEnt.set(EnemyShipState, { ...e, fluxCurrent, shieldUp })
    return { absorbed: true, destroyed: false }
  }

  // Shields down — armor first, then hull.
  let remaining = damage * weapon.armorDamage
  if (e.armorMax > 0 && armorCurrent > 0) {
    const armorAbsorb = Math.min(armorCurrent, remaining * (armorCurrent / e.armorMax))
    armorCurrent = Math.max(0, armorCurrent - armorAbsorb)
    remaining = Math.max(0, remaining - armorAbsorb)
  }
  hullCurrent = Math.max(0, hullCurrent - remaining)
  enemyEnt.set(EnemyShipState, {
    ...e, fluxCurrent, shieldUp, armorCurrent, hullCurrent,
  })
  return { absorbed: false, destroyed: hullCurrent <= 0 }
}

// The player damage path goes through sim/ship.ts for hull/armor and a
// module-local flux/shield model that mirrors the enemy structure.
const playerShield = { fluxCurrent: 0, shieldUp: true, fluxMax: 0, shieldEfficiency: 1 }

function refreshPlayerFluxFromShip(ship: Entity): void {
  const s = ship.get(Ship)!
  playerShield.fluxMax = s.fluxMax
  playerShield.shieldEfficiency = s.shieldEfficiency
  // Sync fluxCurrent into the trait so the UI can read it.
  ship.set(Ship, { ...s, fluxCurrent: playerShield.fluxCurrent })
}

function applyDamageToPlayer(weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const ship = getPlayerShip()
  if (!ship) return { absorbed: false, destroyed: false }
  const s = ship.get(Ship)!
  const damage = weapon.damage

  if (playerShield.shieldUp && playerShield.fluxCurrent < playerShield.fluxMax) {
    const fluxAdd = damage * weapon.shieldDamage * playerShield.shieldEfficiency
    playerShield.fluxCurrent = Math.min(playerShield.fluxMax, playerShield.fluxCurrent + fluxAdd)
    if (playerShield.fluxCurrent >= playerShield.fluxMax) {
      playerShield.shieldUp = false
    }
    ship.set(Ship, { ...s, fluxCurrent: playerShield.fluxCurrent })
    return { absorbed: true, destroyed: false }
  }

  // Shields down — pipe through sim/ship.ts (handles armor + hull).
  const r = damageHull(damage * weapon.armorDamage)
  return { absorbed: false, destroyed: r.destroyed }
}

// Geometry helpers
function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function angleDelta(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function inArc(targetAngle: number, mountFacing: number, arcWidth: number): boolean {
  const d = Math.abs(angleDelta(mountFacing, targetAngle))
  return d <= arcWidth / 2
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// Spawn a projectile or instant-hit for `weapon` from `from` toward `to`.
// Beams (projectileSpeed === 0) resolve as instant hits at distance check.
function fireWeapon(
  ownerSide: 'player' | 'enemy',
  weapon: WeaponDef,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  if (weapon.projectileSpeed === 0) {
    // Instant beam — apply damage immediately if within range and tracking
    // succeeds. We model tracking as a deterministic miss when the target
    // is moving fast; for the spine, every beam hits.
    const enemy = getEnemyEntity()
    if (!enemy) return
    if (ownerSide === 'player') {
      const r = applyDamageToEnemy(enemy, weapon)
      useCombatStore.getState().flash(
        r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
      )
      if (r.destroyed) endCombat('victory')
    } else {
      const r = applyDamageToPlayer(weapon)
      useCombatStore.getState().flash(
        r.absorbed ? `敌方${weapon.nameZh} → 命中护盾` : `敌方${weapon.nameZh} → 命中船体`,
      )
      if (r.destroyed) endCombat('defeat')
    }
    return
  }

  // Projectile-based weapon — spawn a moving body, resolve damage on impact.
  const ang = angleBetween(from, to)
  projectiles.push({
    id: nextProjectileId++,
    ownerSide,
    weaponId: weapon.id,
    x: from.x,
    y: from.y,
    vx: Math.cos(ang) * weapon.projectileSpeed,
    vy: Math.sin(ang) * weapon.projectileSpeed,
    rangeRemaining: weapon.range,
  })
}

function tickProjectiles(dtSec: number): void {
  const enemy = getEnemyEntity()
  const ship = getPlayerShip()
  if (!enemy || !ship) return
  const enemyState = enemy.get(EnemyShipState)!
  const playerPos = ship.get(Ship)!.fleetPos
  // Mutate-in-place + filter pattern.
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    p.x += p.vx * dtSec
    p.y += p.vy * dtSec
    const stepDist = Math.hypot(p.vx, p.vy) * dtSec
    p.rangeRemaining -= stepDist
    if (p.rangeRemaining <= 0) { projectiles.splice(i, 1); continue }
    if (p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) {
      projectiles.splice(i, 1); continue
    }
    const target = p.ownerSide === 'player'
      ? enemyState.pos
      : playerPos
    if (dist(p, target) < 12) {
      const weapon = getWeapon(p.weaponId)
      if (p.ownerSide === 'player') {
        const r = applyDamageToEnemy(enemy, weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
        )
        if (r.destroyed) { projectiles.length = 0; endCombat('victory'); return }
      } else {
        const r = applyDamageToPlayer(weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `敌方${weapon.nameZh} → 命中护盾` : `敌方${weapon.nameZh} → 命中船体`,
        )
        if (r.destroyed) { projectiles.length = 0; endCombat('defeat'); return }
      }
      projectiles.splice(i, 1)
    }
  }
}

export function combatSystem(_world: World, dtMs: number): void {
  const enemyEnt = getEnemyEntity()
  if (!enemyEnt) return
  const store = useCombatStore.getState()
  if (store.paused) return

  const dtSec = dtMs / 1000
  const w = shipWorld()
  const ship = getPlayerShip()
  if (!ship) return

  refreshPlayerFluxFromShip(ship)

  const shipState = ship.get(Ship)!
  const enemyState = enemyEnt.get(EnemyShipState)!

  // -- 1. Player ship physics ------------------------------------------------
  // Steer toward playerTarget; otherwise hold position. Top-speed clamp.
  const playerPos = { x: shipState.fleetPos.x, y: shipState.fleetPos.y }
  const playerTarget = store.playerTarget
  if (playerTarget) {
    const ang = angleBetween(playerPos, playerTarget)
    const d = dist(playerPos, playerTarget)
    if (d > 4) {
      const move = Math.min(d, shipState.topSpeed * dtSec)
      playerPos.x += Math.cos(ang) * move
      playerPos.y += Math.sin(ang) * move
    }
  }
  ship.set(Ship, {
    ...shipState,
    fleetPos: playerPos,
    fluxCurrent: Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec),
  })
  playerShield.fluxCurrent = Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec)
  if (!playerShield.shieldUp && playerShield.fluxCurrent < playerShield.fluxMax * 0.5) {
    playerShield.shieldUp = true
  }

  // -- 2. Player weapon charge + auto-fire ----------------------------------
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId) continue
    const def = getWeapon(m.weaponId)
    let charge = Math.min(def.chargeSec, m.chargeSec + dtSec)
    let ready = charge >= def.chargeSec
    if (ready) {
      // Auto-fire if the enemy is in arc + range.
      const targetAng = angleBetween(playerPos, enemyState.pos)
      const inRange = dist(playerPos, enemyState.pos) <= def.range
      const inArcCheck = inArc(targetAng, 0 /* heading is implicit forward */, m.size === 'small' ? Math.PI : Math.PI * 2)
      if (inRange && inArcCheck) {
        fireWeapon('player', def, playerPos, enemyState.pos)
        charge = 0
        ready = false
      }
    }
    if (ready !== m.ready || charge !== m.chargeSec) {
      e.set(WeaponMount, { ...m, chargeSec: charge, ready })
    }
  }

  // -- 3. Enemy AI ----------------------------------------------------------
  // Maintain `enemyMaintainRange` from player. Move toward/away as needed.
  const e2 = enemyEnt.get(EnemyShipState)!
  const enemyPos = { x: e2.pos.x, y: e2.pos.y }
  const toPlayerAng = angleBetween(enemyPos, playerPos)
  const range = dist(enemyPos, playerPos)
  let moveAng = toPlayerAng
  if (range < enemyMaintainRange * 0.85) {
    moveAng = toPlayerAng + Math.PI    // back away
  } else if (range > enemyMaintainRange * 1.15) {
    moveAng = toPlayerAng                // close in
  } else {
    moveAng = toPlayerAng + Math.PI / 2  // strafe
  }
  const enemyMove = e2.topSpeed * dtSec
  enemyPos.x += Math.cos(moveAng) * enemyMove
  enemyPos.y += Math.sin(moveAng) * enemyMove
  enemyPos.x = Math.max(20, Math.min(ARENA_W - 20, enemyPos.x))
  enemyPos.y = Math.max(20, Math.min(ARENA_H - 20, enemyPos.y))

  // -- 4. Enemy weapon charge + auto-fire ----------------------------------
  let updatedWeapons = e2.weapons.map((wpn) => {
    const def = getWeapon(wpn.weaponId)
    let charge = Math.min(def.chargeSec, wpn.chargeSec + dtSec * (0.5 + e2.ai.aggression))
    let ready = charge >= def.chargeSec
    if (ready && range <= def.range) {
      fireWeapon('enemy', def, enemyPos, playerPos)
      charge = 0
      ready = false
    }
    return { ...wpn, chargeSec: charge, ready }
  })

  // -- 5. Enemy flux dissipation + shield recovery -------------------------
  let enemyFlux = Math.max(0, e2.fluxCurrent - e2.fluxDissipation * dtSec)
  let enemyShieldUp = e2.shieldUp
  if (!enemyShieldUp && enemyFlux < e2.fluxMax * 0.5) enemyShieldUp = true

  // Persist enemy-side mutations.
  enemyEnt.set(EnemyShipState, {
    ...e2,
    pos: enemyPos,
    heading: toPlayerAng,
    weapons: updatedWeapons,
    fluxCurrent: enemyFlux,
    shieldUp: enemyShieldUp,
  })
  void updatedWeapons; void enemyFlux  // tsc happy

  // -- 6. Projectiles ------------------------------------------------------
  tickProjectiles(dtSec)

  // -- 7. Resolution ------------------------------------------------------
  const shipNow = ship.get(Ship)!
  if (shipNow.hullCurrent <= 0) { endCombat('defeat'); return }
  const enemyNow = enemyEnt.get(EnemyShipState)!
  if (enemyNow.hullCurrent <= 0) { endCombat('victory'); return }
}
