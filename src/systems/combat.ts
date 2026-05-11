// Phase 6.0 Starsector-shape tactical combat. Top-down 2D real-time-with-
// pause: ship position/velocity/heading, hardpoint weapons firing in arcs
// + range, projectile entities, flux/shields/armor/hull damage routing.
//
// Tick model (per frame, when clock.mode === 'combat' AND store.paused === false):
//   1. Player ship physics — Newtonian: WASD applies thrust at `accel` along
//      the ship's local frame, no input applies passive `decel` against
//      current velocity, |vel| capped at `topSpeed`. Heading uses bang-bang
//      torque at `angularAccel` toward the shift+mouse aim cursor (with
//      brake-distance check to avoid overshoot), capped at `maxAngVel`. With
//      no aim signal the helm bleeds angVel to 0 via the same torque budget.
//   2. Player weapon charge + auto-fire when target in arc + range
//   3. Per-enemy AI — picks a desired thrust direction (close / strafe / back
//      relative to maintainRange), applies thrust with the same physics as
//      the player; heading torques toward the player's bearing.
//   4. Per-enemy weapon charge + auto-fire
//   5. Projectile motion + collision -> damage application against any enemy
//   6. Flux dissipation (player + each enemy)
//   7. Resolution check (player hull <= 0 -> defeat; no enemies left -> victory)
//
// State lives in:
//   - Ship trait on the player flagship (in playerShipInterior world)
//   - One CombatShipState trait per ship in the engagement (player + enemies; same world)
//     The player's CombatShipState is attached to the existing Ship singleton
//     entity at startCombat and stripped at endCombat. `isPlayer:true` flags it.
//   - Module-local projectile pool (in-memory only, transient)
//   - useCombatStore (UI state: open/paused/selectedMount/flash)

import type { World } from 'koota'
import type { Entity } from 'koota'
import { create } from 'zustand'
import {
  Ship, WeaponMount, CombatShipState, EntityKey, IsPlayer, Money,
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
import { pushCombatLog, useCombatLog } from './combatLog'
import { combatConfig } from '../config'

function logEvent(textZh: string): void {
  emitSim('log', { textZh, atMs: useClock.getState().gameDate.getTime() })
}

const SHIP_SCENE_ID = 'playerShipInterior'

// Tactical arena is a fixed 1000x600 unit box; player spawns left-of-center,
// enemies fan out on the right. Ship positions are in arena units.
export const ARENA_W = 1000
export const ARENA_H = 600
// Arena edge padding (unit). Ships are clamped to [pad, ARENA-pad]; the value
// matches the maximum hull radius at this scale so the sprite never visually
// clips through the arena wall.
const ARENA_EDGE_PAD = 20
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

// Campaign-world EntityKey of the enemy that triggered the engagement —
// stored so endCombat('victory') can destroy it (otherwise the same
// pirate re-prompts engagement after the cooldown expires).
let activeCampaignEnemyKey: string | null = null

// Narrowed tactical auto-pause set — Phase 6.0 (per Design/combat.md +
// Design/post-combat.md): first-contact (handled in startCombat) + the
// flagship hull threshold crossings here. Tracks the lowest threshold
// already triggered so we don't re-pause as hull oscillates inside a
// band. Reset on startCombat.
let flagshipThresholdsHit: number[] = []
function pauseTactical(reasonZh: string, severity: 'warn' | 'crit' = 'crit'): void {
  const store = useCombatStore.getState()
  if (!store.paused) store.togglePause()
  pushCombatLog(reasonZh, severity)
}

// Default player spatial state when no CombatShipState exists yet (combat
// not open) — UI snapshot helpers fall back to these so they never throw.
const PLAYER_FALLBACK_POS = { x: 0, y: 0 }

export function getCombatPlayerPos(): { x: number; y: number } {
  const e = getPlayerCombatShip()
  if (!e) return { ...PLAYER_FALLBACK_POS }
  const cs = e.get(CombatShipState)!
  return { x: cs.pos.x, y: cs.pos.y }
}

export function getCombatPlayerHeading(): number {
  const e = getPlayerCombatShip()
  if (!e) return 0
  return e.get(CombatShipState)!.heading
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

// All CombatShipState entities flagged as the player. There is exactly
// one in a well-formed combat (the Ship singleton with CombatShipState
// attached) — returns undefined when combat isn't open.
function getPlayerCombatShip(): Entity | undefined {
  for (const e of shipWorld().query(CombatShipState)) {
    if (e.get(CombatShipState)!.isPlayer) return e
  }
  return undefined
}

// All non-player CombatShipState entities. Excludes the player's
// CombatShipState (which lives on the Ship singleton during combat).
function getEnemyEntities(): Entity[] {
  const out: Entity[] = []
  for (const e of shipWorld().query(CombatShipState)) {
    if (!e.get(CombatShipState)!.isPlayer) out.push(e)
  }
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
    CombatShipState({
      shipClassId: blueprint.id,
      nameZh: blueprint.nameZh,
      isPlayer: false,
      pos: { x: spawn.x, y: spawn.y },
      vel: { x: 0, y: 0 },
      heading: Math.PI,    // facing -x toward player
      angVel: 0,
      hullCurrent: blueprint.hullMax, hullMax: blueprint.hullMax,
      armorCurrent: blueprint.armorMax, armorMax: blueprint.armorMax,
      fluxMax: blueprint.fluxMax, fluxCurrent: 0, fluxDissipation: blueprint.fluxDissipation,
      hasShield: blueprint.hasShield,
      shieldEfficiency: blueprint.shieldEfficiency,
      shieldUp: blueprint.hasShield,
      topSpeed: blueprint.topSpeed,
      accel: blueprint.accel,
      decel: blueprint.decel,
      angularAccel: blueprint.angularAccel,
      maxAngVel: blueprint.maxAngVel,
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

  // Strip prior combat state. Enemies are transient → destroy. The player's
  // CombatShipState lives on the persistent Ship singleton entity → just
  // remove the trait so the entity (and its long-arc Ship state) survives.
  for (const e of w.query(CombatShipState)) {
    if (e.get(CombatShipState)!.isPlayer) e.remove(CombatShipState)
    else e.destroy()
  }
  projectiles.length = 0
  activeCampaignEnemyKey = campaignEnemyKey ?? null

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
    // Attach a CombatShipState to the player ship — same trait shape as
    // enemies. Spatial fields seed at the player spawn; combat stat
    // fields (hull/armor/flux/weapons) stay zero/empty here because
    // damage routes through the Ship singleton + WeaponMount entities,
    // not this trait. ai is sourced from the player ship class.
    const cls = getShipClass(s.classId)
    ship.add(CombatShipState({
      shipClassId: cls.id,
      nameZh: cls.nameZh,
      isPlayer: true,
      pos: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
      vel: { x: 0, y: 0 },
      heading: 0,    // facing +x toward enemy spawn
      angVel: 0,
      hullCurrent: 0, hullMax: 0,
      armorCurrent: 0, armorMax: 0,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      weapons: [],
      ai: {
        aggression: cls.ai.aggression,
        retreatThreshold: cls.ai.retreatThresholdPct,
        maintainRange: cls.ai.maintainRange,
      },
    }))
  }

  const fleet = [leadShipId, ...escortShipIds]
  fleet.forEach((id, slotIdx) => spawnEnemyShip(w, id, slotIdx, fleet.length))

  setInCombat(true)
  useClock.getState().setMode('combat')
  useClock.getState().setSpeed(0)
  useCombatStore.getState().reset()
  useCombatStore.getState().setOpen(true)
  // Fresh engagement → fresh combat log + threshold tracking. The first
  // entry is the auto-paused first-contact briefing.
  useCombatLog.getState().clear()
  flagshipThresholdsHit = []
  const leadName = getEnemyShip(leadShipId).nameZh
  const fleetNote = fleet.length > 1 ? ` · 队伍 ${fleet.length} 艘` : ''
  logEvent(`战斗开始 · 对手: ${leadName}${fleetNote}`)
  pushCombatLog(`首次接触 · ${leadName}${fleetNote}`, 'crit')
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
  // Same player-vs-enemy split as startCombat: keep the Ship singleton
  // entity alive, just shed its CombatShipState; destroy enemy entities.
  for (const e of w.query(CombatShipState)) {
    if (e.get(CombatShipState)!.isPlayer) e.remove(CombatShipState)
    else e.destroy()
  }
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
    // Phase 6.0 tally minimum — credits + supplies + fuel deltas.
    const creditsRange = combatConfig.tallyCreditsMax - combatConfig.tallyCreditsMin
    const reward = combatConfig.tallyCreditsMin + Math.floor(Math.random() * (creditsRange + 1))
    const supplyGain = combatConfig.tallySuppliesGain
    const fuelGain = combatConfig.tallyFuelGain
    const player = findPlayer()
    let creditsAfter = 0
    if (player) {
      const m = player.get(Money) ?? { amount: 0 }
      creditsAfter = m.amount + reward
      player.set(Money, { amount: creditsAfter })
    }
    // Replenish the flagship's supplies + fuel — capped at max.
    const playerShip = getPlayerShipEntity()
    let suppliesAfter = 0, suppliesMax = 0, fuelAfter = 0, fuelMax = 0
    if (playerShip) {
      const s = playerShip.get(Ship)!
      suppliesMax = s.suppliesMax
      fuelMax = s.fuelMax
      suppliesAfter = Math.min(s.suppliesMax, s.suppliesCurrent + supplyGain)
      fuelAfter = Math.min(s.fuelMax, s.fuelCurrent + fuelGain)
      playerShip.set(Ship, {
        ...s,
        suppliesCurrent: suppliesAfter,
        fuelCurrent: fuelAfter,
      })
    }
    logEvent(`战斗胜利 · 缴获 ¥${reward}`)
    pushCombatLog(`战斗胜利 · 缴获 ¥${reward}`, 'narr')
    emitSim('ui:open-combat-tally', {
      creditsDelta: reward,
      creditsAfter,
      suppliesDelta: supplyGain,
      suppliesAfter,
      suppliesMax,
      fuelDelta: fuelGain,
      fuelAfter,
      fuelMax,
    })
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
  const e = enemyEnt.get(CombatShipState)!
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
    enemyEnt.set(CombatShipState, { ...e, fluxCurrent, shieldUp })
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
  enemyEnt.set(CombatShipState, {
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

// Bang-bang torque controller — drive `angVel` toward a desired heading
// with at most `angularAccel` rad/sec², capped at `maxAngVel`. The
// "brake distance" check (angVel² / 2*angularAccel — angle covered before
// counter-torque can stop the spin) prevents oscillation: when we'd
// otherwise overshoot we apply counter-torque instead. With `desired === null`
// the helm has no aim signal — bleed angVel back to 0 using the same torque.
// Returns the next (heading, angVel) pair.
function steerHeading(
  heading: number,
  angVel: number,
  desired: number | null,
  angularAccel: number,
  maxAngVel: number,
  dt: number,
): { heading: number; angVel: number } {
  let nextAngVel = angVel
  if (desired === null) {
    // Brake angVel toward 0.
    const brake = Math.min(Math.abs(nextAngVel), angularAccel * dt)
    nextAngVel -= Math.sign(nextAngVel) * brake
  } else {
    const err = angleDelta(heading, desired)
    const brakeAngle = (nextAngVel * nextAngVel) / (2 * angularAccel)
    const movingTowardErr = Math.sign(err) === Math.sign(nextAngVel) && nextAngVel !== 0
    if (movingTowardErr && Math.abs(err) <= brakeAngle) {
      // Counter-torque to avoid overshoot.
      nextAngVel -= Math.sign(nextAngVel) * angularAccel * dt
    } else {
      nextAngVel += Math.sign(err) * angularAccel * dt
    }
  }
  if (nextAngVel > maxAngVel) nextAngVel = maxAngVel
  else if (nextAngVel < -maxAngVel) nextAngVel = -maxAngVel
  return { heading: heading + nextAngVel * dt, angVel: nextAngVel }
}

// Newtonian step on a 2D velocity. `thrust` is a unit (or zero) direction
// vector — when non-zero, accelerate vel by `accel * dt` along it; when
// zero, brake vel against its own direction by `decel * dt`. After accel,
// |vel| is clamped to `topSpeed`.
function stepVelocity(
  vel: { x: number; y: number },
  thrust: { x: number; y: number },
  accel: number,
  decel: number,
  topSpeed: number,
  dt: number,
): void {
  const thrustMag = Math.hypot(thrust.x, thrust.y)
  if (thrustMag > 0) {
    const inv = 1 / thrustMag
    vel.x += thrust.x * inv * accel * dt
    vel.y += thrust.y * inv * accel * dt
  } else {
    const speed = Math.hypot(vel.x, vel.y)
    if (speed > 0) {
      const brake = Math.min(speed, decel * dt)
      const k = brake / speed
      vel.x -= vel.x * k
      vel.y -= vel.y * k
    }
  }
  const speed = Math.hypot(vel.x, vel.y)
  if (speed > topSpeed) {
    const k = topSpeed / speed
    vel.x *= k
    vel.y *= k
  }
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
      const enemyName = targetEnemy.get(CombatShipState)?.nameZh ?? '敌舰'
      const r = applyDamageToEnemy(targetEnemy, weapon)
      useCombatStore.getState().flash(
        r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
      )
      if (r.destroyed) {
        pushCombatLog(`击毁敌舰 · ${enemyName}`, 'info')
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
  const playerEnt = getPlayerCombatShip()
  if (!playerEnt) return
  const playerPos = playerEnt.get(CombatShipState)!.pos
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
        const s = e.get(CombatShipState)
        if (!s) continue
        if (dist(p, s.pos) < 12) { hit = e; break }
      }
      if (hit) {
        const weapon = getWeapon(p.weaponId)
        const enemyName = hit.get(CombatShipState)?.nameZh ?? '敌舰'
        const r = applyDamageToEnemy(hit, weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
        )
        projectiles.splice(i, 1)
        if (r.destroyed) {
          pushCombatLog(`击毁敌舰 · ${enemyName}`, 'info')
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
  const playerEnt = getPlayerCombatShip()
  if (!playerEnt) return
  const store = useCombatStore.getState()
  if (store.paused) return

  const dtSec = dtMs / 1000
  const w = shipWorld()
  const ship = getPlayerShip()
  if (!ship) return

  refreshPlayerFluxFromShip(ship)
  const shipState = ship.get(Ship)!

  // -- 1. Per-ship AI directive + physics (unified) -------------------------
  // Each ship — player and enemy — picks its nearest hostile and runs the
  // same maintainRange-style directive: close in if too far, back away if
  // too close, otherwise strafe. The player ship overrides this directive
  // with WASD thrust + shift+mouse aim whenever those inputs are active;
  // releasing input hands the helm back to the AI.
  const allShips: Entity[] = [playerEnt, ...enemies]
  for (const self of allShips) {
    const cs = self.get(CombatShipState)!
    const isPlayer = cs.isPlayer
    const hostiles = isPlayer ? enemies : [playerEnt]
    let nearest: Entity | null = null
    let nearestRange = Infinity
    for (const h of hostiles) {
      const hs = h.get(CombatShipState)!
      const r = dist(cs.pos, hs.pos)
      if (r < nearestRange) { nearestRange = r; nearest = h }
    }

    let thrustWorld = { x: 0, y: 0 }
    let aimAngle: number | null = null
    if (nearest) {
      const targetPos = nearest.get(CombatShipState)!.pos
      const toAng = angleBetween(cs.pos, targetPos)
      const range = nearestRange
      const mr = cs.ai.maintainRange
      let moveAng: number
      if (range < mr * 0.85) moveAng = toAng + Math.PI       // back away
      else if (range > mr * 1.15) moveAng = toAng             // close in
      else moveAng = toAng + Math.PI / 2                      // strafe
      thrustWorld = { x: Math.cos(moveAng), y: Math.sin(moveAng) }
      aimAngle = toAng
    }

    if (isPlayer) {
      // WASD overrides AI thrust whenever any axis is held.
      const axis = store.inputAxis
      const inputLen = Math.hypot(axis.forward, axis.strafe)
      if (inputLen > 0) {
        const fwd = axis.forward / Math.max(1, inputLen)
        const stf = axis.strafe / Math.max(1, inputLen)
        const cosH = Math.cos(cs.heading)
        const sinH = Math.sin(cs.heading)
        // Forward unit = (cosH, sinH); starboard unit = (-sinH, cosH).
        thrustWorld = {
          x: fwd * cosH + stf * -sinH,
          y: fwd * sinH + stf *  cosH,
        }
      }
      // Shift+mouse aim overrides AI aim. Without aim input the AI's
      // "face nearest hostile" directive remains in effect — the helm
      // no longer freezes when the player lets go.
      if (store.aimAtMouse && store.aimMouse) {
        aimAngle = angleBetween(cs.pos, store.aimMouse)
      }
    }

    const vel = { x: cs.vel.x, y: cs.vel.y }
    stepVelocity(vel, thrustWorld, cs.accel, cs.decel, cs.topSpeed, dtSec)
    const pos = { x: cs.pos.x + vel.x * dtSec, y: cs.pos.y + vel.y * dtSec }
    if (pos.x < ARENA_EDGE_PAD) {
      pos.x = ARENA_EDGE_PAD
      if (vel.x < 0) vel.x = 0
    } else if (pos.x > ARENA_W - ARENA_EDGE_PAD) {
      pos.x = ARENA_W - ARENA_EDGE_PAD
      if (vel.x > 0) vel.x = 0
    }
    if (pos.y < ARENA_EDGE_PAD) {
      pos.y = ARENA_EDGE_PAD
      if (vel.y < 0) vel.y = 0
    } else if (pos.y > ARENA_H - ARENA_EDGE_PAD) {
      pos.y = ARENA_H - ARENA_EDGE_PAD
      if (vel.y > 0) vel.y = 0
    }
    const helm = steerHeading(
      cs.heading, cs.angVel, aimAngle,
      cs.angularAccel, cs.maxAngVel, dtSec,
    )
    self.set(CombatShipState, {
      ...cs,
      pos, vel,
      heading: helm.heading,
      angVel: helm.angVel,
    })
  }

  // -- 2. Player flux + shield recovery (Ship-singleton fields) -------------
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

  // Read fresh player pose for weapon-fire arc checks below.
  const playerCsNow = playerEnt.get(CombatShipState)!
  const playerPos = playerCsNow.pos
  const playerHeading = playerCsNow.heading

  // -- 3. Player weapon charge + auto-fire ----------------------------------
  // Each WeaponMount entity picks the closest in-arc, in-range enemy.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId) continue
    const def = getWeapon(m.weaponId)
    let charge = Math.min(def.chargeSec, m.chargeSec + dtSec)
    let ready = charge >= def.chargeSec
    if (ready) {
      const mountFacing = playerHeading + m.facingRad
      let target: { ent: Entity; pos: { x: number; y: number } } | null = null
      let bestRange = Infinity
      for (const en of enemies) {
        const enemyState = en.get(CombatShipState)
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

  // -- 4. Per-enemy weapon charge + auto-fire (inline weapons array) -------
  for (const enemyEnt of enemies) {
    const e2 = enemyEnt.get(CombatShipState)
    if (!e2) continue
    const enemyPos = e2.pos
    const enemyHeading = e2.heading
    const range = dist(enemyPos, playerPos)

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

    const enemyFlux = Math.max(0, e2.fluxCurrent - e2.fluxDissipation * dtSec)
    let enemyShieldUp = e2.shieldUp
    if (e2.hasShield && !enemyShieldUp && enemyFlux < e2.fluxMax * 0.5) enemyShieldUp = true

    enemyEnt.set(CombatShipState, {
      ...e2,
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

  // -- 6. Flagship hull threshold auto-pause (narrowed set, Phase 6.0) ----
  // Crossing 25% or 10% pauses tactical and posts a crit log entry.
  // Each threshold fires at most once per engagement — tracked in
  // flagshipThresholdsHit (reset by startCombat).
  const shipNow = ship.get(Ship)!
  if (shipNow.hullMax > 0) {
    const hullPct = shipNow.hullCurrent / shipNow.hullMax
    for (const pct of combatConfig.flagshipPauseHullPcts) {
      if (hullPct <= pct && !flagshipThresholdsHit.includes(pct)) {
        flagshipThresholdsHit.push(pct)
        pauseTactical(`旗舰船体跌破 ${Math.round(pct * 100)}%`, 'crit')
      }
    }
  }

  // -- 7. Resolution ------------------------------------------------------
  if (shipNow.hullCurrent <= 0) { endCombat('defeat'); return }
  if (getEnemyEntities().length === 0) { endCombat('victory'); return }
}
