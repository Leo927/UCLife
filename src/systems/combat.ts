// Phase 6.0 Starsector-shape tactical combat. Top-down 2D real-time-with-
// pause: ship position/velocity/heading, hardpoint weapons firing in arcs
// + range, projectile entities, flux/shields/armor/hull damage routing.
//
// Tick model (per frame, when clock.mode === 'combat' AND store.paused === false):
//   1. Player ship physics (heading rotates toward shift+mouse cursor only;
//      otherwise the helm holds its last orientation). Velocity decay.
//   2. Player weapon charge + auto-fire when target in arc + range
//   3. Per-enemy AI (maintain own range or close to maintainRange; turn to face)
//   4. Per-enemy weapon charge + auto-fire
//   5. Projectile motion + collision -> damage application against any enemy
//   6. Flux dissipation (player + each enemy)
//   7. Resolution check (player hull <= 0 -> defeat; no enemies left -> victory)
//
// State lives in:
//   - Ship trait on the player flagship (in playerShipInterior world)
//   - One EnemyShipState trait per enemy in the engagement (same world)
//   - Module-local projectile pool (in-memory only, transient)
//   - useCombatStore (UI state: open/paused/selectedMount/flash)

import type { World } from 'koota'
import type { Entity } from 'koota'
import { create } from 'zustand'
import {
  Ship, WeaponMount, EnemyShipState, EntityKey, IsPlayer, Money,
  EnemyAI, Flags,
} from '../ecs/traits'
import { getEnemyShip } from '../data/enemyShips'
import { getShipClass } from '../data/ships'
import { getWeapon, type WeaponDef } from '../data/weapons'
import { useClock } from '../sim/clock'
import { setInCombat, damageHull, drainCR, getPlayerShipEntity } from '../sim/ship'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { emitSim } from '../sim/events'
import { migratePlayerToScene } from '../sim/scene'
import { getAirportPlacement } from '../sim/airportPlacements'

function logEvent(textZh: string): void {
  emitSim('log', { textZh, atMs: useClock.getState().gameDate.getTime() })
}

const SHIP_SCENE_ID = 'playerShipInterior'

// Tactical arena is a fixed 1000x600 unit box; player spawns left-of-center,
// enemies fan out on the right. Ship positions are in arena units.
export const ARENA_W = 1000
export const ARENA_H = 600
const PLAYER_SPAWN = { x: 250, y: 300 }
const ENEMY_FORMATION_CENTER = { x: 750, y: 300 }
const ENEMY_FORMATION_SPACING = 90

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

// Transient visual record for an instant-hit beam shot — the renderer
// draws a fading line for the duration of `lifetimeMs`. Without this,
// beams resolve instantly and the only feedback is the flash banner.
export interface BeamFlash {
  id: number
  ownerSide: 'player' | 'enemy'
  from: { x: number; y: number }
  to: { x: number; y: number }
  ageMs: number
  lifetimeMs: number
}
const BEAM_FLASH_LIFETIME_MS = 220
const beamFlashes: BeamFlash[] = []
let nextBeamId = 1

export function getBeamFlashes(): BeamFlash[] {
  return beamFlashes.slice()
}

// per-active-scene only: combat runs exclusively in the playerShipInterior
// world; only one tactical encounter exists at any time. Module-level
// projectile pool + id seed are safe — there's no second concurrent combat
// to keep separate state for. (combatSystem itself takes a `world` argument
// but doesn't use it — it always reads/writes the SHIP_SCENE_ID world.)
let nextProjectileId = 1
const projectiles: ProjectileSnap[] = []

// Tactical-arena position for the player flagship — module-local rather
// than written to Ship.fleetPos, so the campaign-map fleet position
// survives an engagement intact. UI snapshots read it via
// getCombatPlayerPos().
const combatPlayerPos: { x: number; y: number } = { x: 0, y: 0 }
let combatPlayerHeading = 0   // radians, 0 = +x; rotates toward target

// Campaign-world EntityKey of the enemy that triggered the engagement —
// stored so endCombat('victory') can destroy it (otherwise the same
// pirate re-prompts engagement after the cooldown expires).
let activeCampaignEnemyKey: string | null = null

export function getCombatPlayerPos(): { x: number; y: number } {
  return { x: combatPlayerPos.x, y: combatPlayerPos.y }
}

export function getCombatPlayerHeading(): number {
  return combatPlayerHeading
}

interface CombatState {
  open: boolean
  paused: boolean
  selectedMountIdx: number | null
  // Recent flash banner (e.g. weapon hit)
  lastFlashZh: string
  lastFlashAtMs: number
  // Starsector-shape direct control. WASD drives `inputAxis` in the
  // ship's local frame: forward = W/S along heading, strafe = A/D
  // perpendicular. Each component is clamped to [-1, 1]; the combat
  // tick normalizes diagonals before applying topSpeed.
  inputAxis: { forward: number; strafe: number }
  // When `aimAtMouse` is true (shift held) and `aimMouse` is set,
  // the heading rotates toward the cursor. Otherwise the helm holds
  // its current orientation — the helm never auto-aims at the enemy.
  aimAtMouse: boolean
  aimMouse: { x: number; y: number } | null
  setOpen: (open: boolean) => void
  togglePause: () => void
  setSelectedMount: (idx: number | null) => void
  setInputAxis: (axis: { forward: number; strafe: number }) => void
  setAimAtMouse: (on: boolean) => void
  setAimMouse: (m: { x: number; y: number } | null) => void
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
  inputAxis: { forward: 0, strafe: 0 },
  aimAtMouse: false,
  aimMouse: null,
  setOpen: (open) => set({ open }),
  togglePause: () => set((s) => {
    const next = !s.paused
    useClock.getState().setSpeed(next ? 0 : 1)
    return { paused: next }
  }),
  setSelectedMount: (selectedMountIdx) => set({ selectedMountIdx }),
  setInputAxis: (inputAxis) => set({ inputAxis }),
  setAimAtMouse: (aimAtMouse) => set({ aimAtMouse }),
  setAimMouse: (aimMouse) => set({ aimMouse }),
  flash: (lastFlashZh) => set({ lastFlashZh, lastFlashAtMs: performance.now() }),
  reset: () => set({
    open: false,
    paused: true,
    selectedMountIdx: null,
    lastFlashZh: '',
    lastFlashAtMs: 0,
    inputAxis: { forward: 0, strafe: 0 },
    aimAtMouse: false,
    aimMouse: null,
  }),
  getProjectiles: () => projectiles.slice(),
}))

function shipWorld(): World {
  return getWorld(SHIP_SCENE_ID)
}

function getPlayerShip(): Entity | undefined {
  return shipWorld().queryFirst(Ship)
}

function getEnemyEntities(): Entity[] {
  const out: Entity[] = []
  for (const e of shipWorld().query(EnemyShipState)) out.push(e)
  return out
}

function findPlayer(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

// Compute the formation slot for the i-th enemy in a fleet of `total`
// ships. Slot 0 sits at the formation center (lead ship); the rest fan
// out vertically on alternating sides for visual readability.
function enemySpawnSlot(idx: number, total: number): { x: number; y: number } {
  if (total <= 1 || idx === 0) {
    return { x: ENEMY_FORMATION_CENTER.x, y: ENEMY_FORMATION_CENTER.y }
  }
  const offsetIdx = Math.ceil(idx / 2)
  const sign = idx % 2 === 1 ? -1 : 1
  return {
    x: ENEMY_FORMATION_CENTER.x + (offsetIdx % 2 === 0 ? -40 : 40),
    y: ENEMY_FORMATION_CENTER.y + sign * offsetIdx * ENEMY_FORMATION_SPACING,
  }
}

function spawnEnemyShip(w: World, blueprintId: string, slotIdx: number, totalSlots: number): void {
  const blueprint = getEnemyShip(blueprintId)
  const spawn = enemySpawnSlot(slotIdx, totalSlots)
  w.spawn(
    EnemyShipState({
      shipClassId: blueprint.id,
      nameZh: blueprint.nameZh,
      pos: { x: spawn.x, y: spawn.y },
      vel: { x: 0, y: 0 },
      heading: Math.PI,    // facing -x toward player
      hullCurrent: blueprint.hullMax, hullMax: blueprint.hullMax,
      armorCurrent: blueprint.armorMax, armorMax: blueprint.armorMax,
      fluxMax: blueprint.fluxMax, fluxCurrent: 0, fluxDissipation: blueprint.fluxDissipation,
      hasShield: blueprint.hasShield,
      shieldEfficiency: blueprint.shieldEfficiency,
      shieldUp: blueprint.hasShield,
      topSpeed: blueprint.topSpeed,
      maneuverability: blueprint.maneuverability,
      weapons: blueprint.defaultWeapons.map((id, i) => ({
        weaponId: id,
        size: blueprint.mounts[i].size,
        firingArcRad: (blueprint.mounts[i].firingArcDeg * Math.PI) / 180,
        facingRad: (blueprint.mounts[i].facingDeg * Math.PI) / 180,
        chargeSec: 0,
        ready: false,
      })),
      ai: {
        aggression: blueprint.ai.aggression,
        retreatThreshold: blueprint.ai.retreatThresholdPct,
        maintainRange: blueprint.ai.maintainRange,
      },
    }),
    EntityKey({ key: `enemy-ship-${slotIdx}` }),
  )
}

export function startCombat(
  leadShipId: string,
  escortShipIds: string[] = [],
  campaignEnemyKey?: string | null,
): void {
  const w = shipWorld()

  for (const e of w.query(EnemyShipState)) e.destroy()
  projectiles.length = 0
  activeCampaignEnemyKey = campaignEnemyKey ?? null

  // Tactical-arena position lives in module-local state — Ship.fleetPos
  // stays at its campaign-map value so the player rejoins the campaign
  // (after flee or the next engagement) at the same spot they left.
  combatPlayerPos.x = PLAYER_SPAWN.x
  combatPlayerPos.y = PLAYER_SPAWN.y
  combatPlayerHeading = 0   // facing +x toward enemy spawn

  const ship = getPlayerShip()
  if (ship) {
    const s = ship.get(Ship)!
    // Combat-time mutable state on the singleton: reset flux to a clean
    // baseline and restore armor (Starsector pattern — armor regenerates
    // between encounters). Hull and CR carry over from prior fights.
    ship.set(Ship, {
      ...s,
      fluxCurrent: 0,
      armorCurrent: s.armorMax,
    })
  }

  const fleet = [leadShipId, ...escortShipIds]
  fleet.forEach((id, slotIdx) => spawnEnemyShip(w, id, slotIdx, fleet.length))

  setInCombat(true)
  useClock.getState().setMode('combat')
  useClock.getState().setSpeed(0)
  useCombatStore.getState().reset()
  useCombatStore.getState().setOpen(true)
  const leadName = getEnemyShip(leadShipId).nameZh
  const fleetNote = fleet.length > 1 ? ` · 队伍 ${fleet.length} 艘` : ''
  logEvent(`战斗开始 · 对手: ${leadName}${fleetNote}`)
}

export type CombatOutcome = 'victory' | 'defeat' | 'flee'

// Flee penalties — Starsector "you can't run for free" feel.
// Hull lands the bigger hit; armor depletes (regenerates between
// encounters); CR drains heavily so back-to-back flees stack.
const FLEE_HULL_LOSS_PCT = 0.35
const FLEE_CR_DRAIN = 50

// Defeat: stripped to the survivor floor. Money goes to a small
// rescue-stipend amount; the player has to ground-game back into a
// new ship.
const DEFEAT_SURVIVOR_MONEY = 200

// Ground scenes the rescue transport might drop a defeated player at,
// alongside the POI that scene's port maps to (used to keep ship state
// internally consistent should the player re-acquire a ship later).
const DEFEAT_DROP_OPTIONS: { sceneId: 'vonBraunCity' | 'zumCity'; airportHubId: string; poiId: string }[] = [
  { sceneId: 'vonBraunCity', airportHubId: 'vonBraunCityAirport', poiId: 'vonBraun' },
  { sceneId: 'zumCity',   airportHubId: 'zumCityAirport',   poiId: 'side3' },
]

function destroyCampaignEnemyByKey(key: string): void {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(EnemyAI, EntityKey)) {
    if (e.get(EntityKey)!.key === key) {
      e.destroy()
      return
    }
  }
}

// Public so the engagement modal's flee choice (which closes the modal
// without entering combat) shares one penalty path with in-combat retreat.
export function applyFleePenalty(): void {
  const ship = getPlayerShip()
  if (!ship) return
  const s = ship.get(Ship)!
  const hullLoss = Math.floor(s.hullCurrent * FLEE_HULL_LOSS_PCT)
  ship.set(Ship, {
    ...s,
    hullCurrent: Math.max(1, s.hullCurrent - hullLoss),
    armorCurrent: 0,
  })
  drainCR(FLEE_CR_DRAIN)
  logEvent(`脱离接触 · 船体受创 -${hullLoss} · 战备 -${FLEE_CR_DRAIN}`)
}

function applyDefeatConsequence(): void {
  // Pick a random ground colony (rescue transport drop-off).
  const drop = DEFEAT_DROP_OPTIONS[Math.floor(Math.random() * DEFEAT_DROP_OPTIONS.length)]

  // Reset Ship singleton to factory-fresh state so a re-acquired ship
  // starts clean. The owned-flag flip below means the player can't board
  // it until they re-buy from the dealer.
  const ship = getPlayerShipEntity()
  if (ship) {
    const s = ship.get(Ship)!
    const cls = getShipClass(s.classId)
    ship.set(Ship, {
      ...s,
      hullCurrent: cls.hullMax,
      armorCurrent: cls.armorMax,
      fluxCurrent: 0,
      crCurrent: cls.crMax,
      fuelCurrent: cls.fuelMax,
      suppliesCurrent: cls.suppliesMax,
      dockedAtPoiId: drop.poiId,
      inCombat: false,
    })
  }

  // Strip ship ownership + everything in the player's pockets bar a
  // survivor stipend. Other progression (skills, perks, relationships,
  // ambitions) survives — the run continues.
  const player = findPlayer()
  if (player) {
    player.set(Money, { amount: DEFEAT_SURVIVOR_MONEY })
    const f = player.get(Flags)
    if (f) {
      player.set(Flags, { flags: { ...f.flags, shipOwned: false } })
    }
  }

  // Drop the player at the rescue colony's airport arrival tile if the
  // procgen registry knows it, otherwise the scene's declared spawn tile.
  const placement = getAirportPlacement(drop.airportHubId)
  const arrival = placement
    ? { x: placement.arrivalPx.x, y: placement.arrivalPx.y }
    : { x: 20 * 20, y: 50 * 20 }   // vonBraunCity spawn fallback in tile px (TILE=20)
  migratePlayerToScene(drop.sceneId, arrival)

  emitSim('toast', { textZh: '飞船被毁 · 救援运输船把你丢在了另一颗殖民地' })
  logEvent(`战斗失败 · 飞船与船员尽失 · 流落 ${drop.sceneId === 'vonBraunCity' ? '冯·布劳恩' : '祖姆市'}`)
}

export function endCombat(outcome: CombatOutcome): void {
  const w = shipWorld()
  for (const e of w.query(EnemyShipState)) e.destroy()
  projectiles.length = 0
  beamFlashes.length = 0

  // Reset player weapon charge so a follow-up encounter starts cold.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    e.set(WeaponMount, { ...m, chargeSec: 0, ready: false })
  }

  setInCombat(false)
  useClock.getState().setMode('normal')
  useClock.getState().setSpeed(1)
  useCombatStore.getState().reset()

  const campaignKey = activeCampaignEnemyKey
  activeCampaignEnemyKey = null

  if (outcome === 'victory') {
    if (campaignKey) destroyCampaignEnemyByKey(campaignKey)
    const reward = 800 + Math.floor(Math.random() * 700)
    const player = findPlayer()
    if (player) {
      const m = player.get(Money) ?? { amount: 0 }
      player.set(Money, { amount: m.amount + reward })
    }
    logEvent(`战斗胜利 · 缴获 ¥${reward}`)
  } else if (outcome === 'defeat') {
    applyDefeatConsequence()
  } else {
    applyFleePenalty()
  }
}

// Damage routing on a specific enemy. Shields-up: incoming damage builds
// flux (proportional to shieldEfficiency). Once flux maxes, shields drop
// and the next hit eats armor + hull. Returns {destroyed} so callers can
// clean up the entity when the hit finishes the ship.
function applyDamageToEnemy(
  enemyEnt: Entity,
  weapon: WeaponDef,
): { absorbed: boolean; destroyed: boolean } {
  const e = enemyEnt.get(EnemyShipState)!
  let { fluxCurrent, fluxMax, shieldEfficiency, shieldUp } = e
  let armorCurrent = e.armorCurrent
  let hullCurrent = e.hullCurrent

  const damage = weapon.damage
  if (e.hasShield && shieldUp && fluxCurrent < fluxMax) {
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

// per-active-scene only: there is exactly one player ship; module-local
// flux/shield model mirrors the enemy structure on the same per-encounter
// scope as projectiles[].
const playerShield = {
  fluxCurrent: 0, shieldUp: true, fluxMax: 0, shieldEfficiency: 1,
  hasShield: false,
}

function refreshPlayerFluxFromShip(ship: Entity): void {
  const s = ship.get(Ship)!
  playerShield.fluxMax = s.fluxMax
  playerShield.shieldEfficiency = s.shieldEfficiency
  playerShield.hasShield = s.hasShield
  // Sync fluxCurrent into the trait so the UI can read it.
  ship.set(Ship, { ...s, fluxCurrent: playerShield.fluxCurrent })
}

function applyDamageToPlayer(weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const ship = getPlayerShip()
  if (!ship) return { absorbed: false, destroyed: false }
  const s = ship.get(Ship)!
  const damage = weapon.damage

  if (playerShield.hasShield && playerShield.shieldUp && playerShield.fluxCurrent < playerShield.fluxMax) {
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
// `targetEnemy` is required for player beams (multi-enemy disambiguation);
// enemy beams always resolve against the player.
function fireWeapon(
  ownerSide: 'player' | 'enemy',
  weapon: WeaponDef,
  from: { x: number; y: number },
  to: { x: number; y: number },
  targetEnemy: Entity | null,
): void {
  if (weapon.projectileSpeed === 0) {
    // Instant beam — apply damage immediately.
    beamFlashes.push({
      id: nextBeamId++,
      ownerSide,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      ageMs: 0,
      lifetimeMs: BEAM_FLASH_LIFETIME_MS,
    })
    if (ownerSide === 'player') {
      if (!targetEnemy) return
      const r = applyDamageToEnemy(targetEnemy, weapon)
      useCombatStore.getState().flash(
        r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
      )
      if (r.destroyed) {
        targetEnemy.destroy()
        if (getEnemyEntities().length === 0) endCombat('victory')
      }
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
  const ship = getPlayerShip()
  if (!ship) return
  const playerPos = combatPlayerPos
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

    if (p.ownerSide === 'player') {
      // Player projectile — collide with the closest enemy within hit
      // radius. Each enemy's pos is queried fresh per projectile so a
      // ship that just moved last frame still resolves correctly.
      const enemies = getEnemyEntities()
      let hit: Entity | null = null
      for (const e of enemies) {
        const s = e.get(EnemyShipState)
        if (!s) continue
        if (dist(p, s.pos) < 12) { hit = e; break }
      }
      if (hit) {
        const weapon = getWeapon(p.weaponId)
        const r = applyDamageToEnemy(hit, weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
        )
        projectiles.splice(i, 1)
        if (r.destroyed) {
          hit.destroy()
          if (getEnemyEntities().length === 0) {
            projectiles.length = 0
            endCombat('victory')
            return
          }
        }
      }
    } else {
      // Enemy projectile — collide with player.
      if (dist(p, playerPos) < 12) {
        const weapon = getWeapon(p.weaponId)
        const r = applyDamageToPlayer(weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `敌方${weapon.nameZh} → 命中护盾` : `敌方${weapon.nameZh} → 命中船体`,
        )
        projectiles.splice(i, 1)
        if (r.destroyed) { projectiles.length = 0; endCombat('defeat'); return }
      }
    }
  }
}

export function combatSystem(_world: World, dtMs: number): void {
  const enemies = getEnemyEntities()
  if (enemies.length === 0) return
  const store = useCombatStore.getState()
  if (store.paused) return

  const dtSec = dtMs / 1000
  const w = shipWorld()
  const ship = getPlayerShip()
  if (!ship) return

  refreshPlayerFluxFromShip(ship)

  const shipState = ship.get(Ship)!

  // -- 1. Player ship physics ------------------------------------------------
  // WASD direct control in ship-local frame: forward = W/S along heading,
  // strafe = A/D perpendicular (right-hand: +strafe = starboard). Diagonals
  // normalize so W+D doesn't outrun pure W. Velocity caps at topSpeed.
  // Heading: only updates when shift+mouse aim is active. With no aim
  // signal the helm holds its last heading — there is no auto-face-enemy
  // fallback. Maneuverability caps turn rate.
  const playerPos = combatPlayerPos
  const axis = store.inputAxis
  const inputLen = Math.hypot(axis.forward, axis.strafe)
  if (inputLen > 0) {
    const fwd = axis.forward / Math.max(1, inputLen)
    const stf = axis.strafe / Math.max(1, inputLen)
    const cosH = Math.cos(combatPlayerHeading)
    const sinH = Math.sin(combatPlayerHeading)
    // Forward unit = (cosH, sinH); starboard unit = (-sinH, cosH).
    const vx = (fwd * cosH + stf * -sinH) * shipState.topSpeed
    const vy = (fwd * sinH + stf *  cosH) * shipState.topSpeed
    playerPos.x += vx * dtSec
    playerPos.y += vy * dtSec
  }
  if (store.aimAtMouse && store.aimMouse) {
    const desiredHeading = angleBetween(playerPos, store.aimMouse)
    const turnRate = (Math.PI * 1.5) * Math.max(0.1, shipState.maneuverability)
    const headingDelta = angleDelta(combatPlayerHeading, desiredHeading)
    const turnStep = Math.sign(headingDelta) * Math.min(Math.abs(headingDelta), turnRate * dtSec)
    combatPlayerHeading += turnStep
  }

  // Clamp arena bounds so the player can't drift offscreen.
  playerPos.x = Math.max(20, Math.min(ARENA_W - 20, playerPos.x))
  playerPos.y = Math.max(20, Math.min(ARENA_H - 20, playerPos.y))

  ship.set(Ship, {
    ...shipState,
    fluxCurrent: Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec),
  })
  playerShield.fluxCurrent = Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec)
  if (
    playerShield.hasShield
    && !playerShield.shieldUp
    && playerShield.fluxCurrent < playerShield.fluxMax * 0.5
  ) {
    playerShield.shieldUp = true
  }

  // -- 2. Player weapon charge + auto-fire ----------------------------------
  // Per-mount firing arc lives on the WeaponMount trait now (firingArcRad +
  // facingRad, both relative to ship heading). Each turret picks the closest
  // enemy that falls inside its arc and within range. With multiple enemies
  // in the arena, different mounts can engage different targets in the
  // same tick.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId) continue
    const def = getWeapon(m.weaponId)
    let charge = Math.min(def.chargeSec, m.chargeSec + dtSec)
    let ready = charge >= def.chargeSec
    if (ready) {
      const mountFacing = combatPlayerHeading + m.facingRad
      let target: { ent: Entity; pos: { x: number; y: number } } | null = null
      let bestRange = Infinity
      for (const en of enemies) {
        const enemyState = en.get(EnemyShipState)
        if (!enemyState) continue
        const range = dist(playerPos, enemyState.pos)
        if (range > def.range) continue
        const ang = angleBetween(playerPos, enemyState.pos)
        if (!inArc(ang, mountFacing, m.firingArcRad)) continue
        if (range < bestRange) {
          bestRange = range
          target = { ent: en, pos: enemyState.pos }
        }
      }
      if (target) {
        fireWeapon('player', def, playerPos, target.pos, target.ent)
        charge = 0
        ready = false
      }
    }
    if (ready !== m.ready || charge !== m.chargeSec) {
      e.set(WeaponMount, { ...m, chargeSec: charge, ready })
    }
  }

  // -- 3 + 4. Per-enemy AI + weapon charge + auto-fire ----------------------
  // Each enemy steers and fires independently. Movement: keep its own
  // maintainRange from the player. Firing: each weapon checks its arc
  // against the player.
  for (const enemyEnt of enemies) {
    const e2 = enemyEnt.get(EnemyShipState)
    if (!e2) continue
    const enemyPos = { x: e2.pos.x, y: e2.pos.y }
    const toPlayerAng = angleBetween(enemyPos, playerPos)
    const range = dist(enemyPos, playerPos)
    let moveAng = toPlayerAng
    const maintainRange = e2.ai.maintainRange
    if (range < maintainRange * 0.85) {
      moveAng = toPlayerAng + Math.PI    // back away
    } else if (range > maintainRange * 1.15) {
      moveAng = toPlayerAng                // close in
    } else {
      moveAng = toPlayerAng + Math.PI / 2  // strafe
    }
    const enemyMove = e2.topSpeed * dtSec
    enemyPos.x += Math.cos(moveAng) * enemyMove
    enemyPos.y += Math.sin(moveAng) * enemyMove
    enemyPos.x = Math.max(20, Math.min(ARENA_W - 20, enemyPos.x))
    enemyPos.y = Math.max(20, Math.min(ARENA_H - 20, enemyPos.y))

    // Enemy heading: face the player (enemy hardpoints don't get a free
    // pass on arc — same per-mount facing/firingArc rules apply).
    const enemyHeading = toPlayerAng

    const updatedWeapons = e2.weapons.map((wpn) => {
      const def = getWeapon(wpn.weaponId)
      let charge = Math.min(def.chargeSec, wpn.chargeSec + dtSec * (0.5 + e2.ai.aggression))
      let ready = charge >= def.chargeSec
      if (ready && range <= def.range) {
        const mountFacing = enemyHeading + wpn.facingRad
        const angToPlayer = angleBetween(enemyPos, playerPos)
        if (inArc(angToPlayer, mountFacing, wpn.firingArcRad)) {
          fireWeapon('enemy', def, enemyPos, playerPos, null)
          charge = 0
          ready = false
        }
      }
      return { ...wpn, chargeSec: charge, ready }
    })

    // Flux dissipation + shield recovery for this enemy.
    const enemyFlux = Math.max(0, e2.fluxCurrent - e2.fluxDissipation * dtSec)
    let enemyShieldUp = e2.shieldUp
    if (e2.hasShield && !enemyShieldUp && enemyFlux < e2.fluxMax * 0.5) enemyShieldUp = true

    enemyEnt.set(EnemyShipState, {
      ...e2,
      pos: enemyPos,
      heading: enemyHeading,
      weapons: updatedWeapons,
      fluxCurrent: enemyFlux,
      shieldUp: enemyShieldUp,
    })
  }

  // -- 5. Projectiles + beam-flash decay -----------------------------------
  tickProjectiles(dtSec)
  for (let i = beamFlashes.length - 1; i >= 0; i--) {
    beamFlashes[i].ageMs += dtMs
    if (beamFlashes[i].ageMs >= beamFlashes[i].lifetimeMs) {
      beamFlashes.splice(i, 1)
    }
  }

  // -- 6. Resolution ------------------------------------------------------
  const shipNow = ship.get(Ship)!
  if (shipNow.hullCurrent <= 0) { endCombat('defeat'); return }
  if (getEnemyEntities().length === 0) { endCombat('victory'); return }
}
